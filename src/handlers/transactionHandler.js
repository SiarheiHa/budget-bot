import { formatAmountValue } from "../amount.js";
import {
  createTransactionDeleteKeyboard,
  createTransactionEditMenuKeyboard,
  createTransactionEditPickKeyboard,
  createTransactionEditPromptKeyboard,
  createTransactionKeyboard,
  mainKeyboard,
  showMainKeyboard,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import {
  createAccessMiddleware,
  formatDateToDisplay,
  parseAmount,
  parseDateDDMMYYYY,
  safeDeleteMessage,
} from "../utils.js";

const EDITABLE_TEXT_FIELDS = new Set(["date", "amount", "note"]);
const EDITABLE_FIELDS = new Set([
  "date",
  "amount",
  "category",
  "wallet",
  "note",
]);
const MENU_TEXTS = new Set([
  "Добавить транзакцию",
  "Показать баланс",
  "Последняя транзакция",
]);

function formatTransactionText(transaction, { title = true } = {}) {
  const amount = Number.isFinite(transaction.amount)
    ? formatAmountValue(transaction.amount)
    : MESSAGES.AI.UNKNOWN;

  const lines = [];
  if (title) lines.push(MESSAGES.TRANSACTION_VIEW.TITLE, "");
  lines.push(
    `${MESSAGES.AI.DATE_LABEL}: ${transaction.date || MESSAGES.AI.UNKNOWN}`,
    `${MESSAGES.AI.AMOUNT_LABEL}: ${amount || MESSAGES.AI.UNKNOWN}`,
    `${MESSAGES.AI.CATEGORY_LABEL}: ${
      transaction.category || MESSAGES.AI.UNKNOWN
    }`,
    `${MESSAGES.AI.WALLET_LABEL}: ${
      transaction.wallet || MESSAGES.AI.UNKNOWN
    }`,
    `${MESSAGES.AI.NOTE_LABEL}: ${
      transaction.note || MESSAGES.AI.NO_NOTE
    }`
  );

  return lines.join("\n");
}

async function isTransfer(deps, transaction) {
  try {
    const categories = await deps.sheets.getCategories();
    return (
      categories.find((category) => category.name === transaction.category)
        ?.type === "transfer"
    );
  } catch (error) {
    deps.logger.warn(
      `Не удалось определить тип категории: ${error.message}`
    );
    return false;
  }
}

function buildView(transaction, transfer) {
  let text = formatTransactionText(transaction);
  if (transfer) {
    text += `\n\n${MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED}`;
  }

  const keyboard = createTransactionKeyboard({
    row: transaction.row,
    canEdit: !transfer,
    canDelete: !transfer,
    nav: true,
  });

  return { text, keyboard };
}

async function editOrSend(bot, logger, chatId, messageId, text, keyboard) {
  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...keyboard,
      });
      return messageId;
    } catch (error) {
      logger.warn(`Не удалось обновить карточку транзакции: ${error.message}`);
    }
  }

  const message = await bot.sendMessage(chatId, text, keyboard);
  return message?.message_id;
}

async function renderTransaction(
  bot,
  deps,
  chatId,
  transaction,
  messageId,
  { prefix = "" } = {}
) {
  const transfer = await isTransfer(deps, transaction);
  const { text, keyboard } = buildView(transaction, transfer);
  const fullText = prefix ? `${prefix}\n\n${text}` : text;
  return editOrSend(
    bot,
    deps.logger,
    chatId,
    messageId,
    fullText,
    keyboard
  );
}

async function getEditCategories(deps) {
  const categories = await deps.sheets.getCategories();
  return categories
    .filter(
      (category) =>
        category.type === "income" || category.type === "expense"
    )
    .map((category) => category.name);
}

function promptForField(field, error = "") {
  const prompts = {
    amount: MESSAGES.TRANSACTION_VIEW.EDIT_AMOUNT_PROMPT,
    date: MESSAGES.TRANSACTION_VIEW.EDIT_DATE_PROMPT,
    note: MESSAGES.TRANSACTION_VIEW.EDIT_NOTE_PROMPT,
  };

  return error ? `${error}\n\n${prompts[field]}` : prompts[field];
}

async function showEditPrompt(
  bot,
  deps,
  chatId,
  row,
  field,
  messageId,
  { error = "" } = {}
) {
  if (!EDITABLE_FIELDS.has(field)) return {};

  const items =
    field === "category"
      ? await getEditCategories(deps)
      : field === "wallet"
        ? await deps.sheets.getWallets()
        : null;

  if (items && items.length === 0) {
    return {
      alert:
        field === "category"
          ? MESSAGES.TRANSACTION_VIEW.EDIT_NO_CATEGORIES
          : MESSAGES.TRANSACTION_VIEW.EDIT_NO_WALLETS,
    };
  }

  deps.state.set(chatId, {
    step: "tx-edit",
    txRow: row,
    txField: field,
    cardMessageId: messageId,
  });

  const text = items
    ? field === "category"
      ? MESSAGES.TRANSACTION_VIEW.EDIT_CATEGORY_PROMPT
      : MESSAGES.TRANSACTION_VIEW.EDIT_WALLET_PROMPT
    : promptForField(field, error);
  const keyboard = items
    ? createTransactionEditPickKeyboard(row, field, items)
    : createTransactionEditPromptKeyboard(row);

  await editOrSend(bot, deps.logger, chatId, messageId, text, keyboard);
  return {};
}

async function showEditMenu(bot, deps, chatId, transaction, messageId) {
  deps.state.set(chatId, {
    step: "tx-edit",
    txRow: transaction.row,
    txField: null,
    cardMessageId: messageId,
  });

  await editOrSend(
    bot,
    deps.logger,
    chatId,
    messageId,
    `${formatTransactionText(transaction)}\n\n${
      MESSAGES.TRANSACTION_VIEW.EDIT_TITLE
    }`,
    createTransactionEditMenuKeyboard(transaction.row)
  );
  return {};
}

async function getTransaction(deps, row) {
  return deps.sheets.getTransaction(row);
}

async function saveField(
  bot,
  deps,
  chatId,
  transaction,
  field,
  value,
  messageId
) {
  const updated = { ...transaction, [field]: value };

  try {
    await deps.sheets.updateTransaction(transaction.row, updated);
    deps.state.del(chatId);
    await renderTransaction(
      bot,
      deps,
      chatId,
      updated,
      messageId,
      { prefix: MESSAGES.TRANSACTION_VIEW.UPDATED }
    );
    return {};
  } catch (error) {
    deps.logger.error(
      `Ошибка при изменении транзакции row=${transaction.row}: ${error.message}`,
      error
    );
    deps.state.del(chatId);
    await renderTransaction(bot, deps, chatId, transaction, messageId);
    return { alert: MESSAGES.TRANSACTION_VIEW.EDIT_ERROR };
  }
}

function hasActiveFlow(deps, chatId) {
  return Boolean(deps.state.get(chatId));
}

export async function handleLastTransactionCommand(bot, deps, msg) {
  const chatId = msg.chat.id;
  const { logger } = deps;

  if (hasActiveFlow(deps, chatId)) {
    await bot.sendMessage(chatId, MESSAGES.TRANSACTION_VIEW.BUSY, mainKeyboard);
    return;
  }

  try {
    const transaction = await deps.sheets.getLastTransaction();
    if (!transaction) {
      await bot.sendMessage(
        chatId,
        MESSAGES.TRANSACTION_VIEW.EMPTY,
        mainKeyboard
      );
      return;
    }

    await renderTransaction(bot, deps, chatId, transaction);
  } catch (error) {
    logger.error(
      `Ошибка при получении последней транзакции: ${error.message}`,
      error
    );
    await bot.sendMessage(
      chatId,
      MESSAGES.TRANSACTION_VIEW.FETCH_ERROR,
      mainKeyboard
    );
  }
}

async function confirmDelete(bot, deps, chatId, messageId, row) {
  const { logger } = deps;

  try {
    const transaction = await getTransaction(deps, row);
    if (!transaction) {
      return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
    }
    if (await isTransfer(deps, transaction)) {
      return { alert: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED };
    }

    await deps.sheets.deleteTransaction(row);
    deps.state.del(chatId);
    await editOrSend(
      bot,
      logger,
      chatId,
      messageId,
      MESSAGES.TRANSACTION_VIEW.DELETED,
      { reply_markup: { inline_keyboard: [] } }
    );
    await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    return {};
  } catch (error) {
    logger.error(
      `Ошибка при удалении транзакции row=${row}: ${error.message}`,
      error
    );
    return { alert: MESSAGES.TRANSACTION_VIEW.DELETE_ERROR };
  }
}

export async function handleTransactionText(bot, deps, msg) {
  const chatId = msg.chat.id;
  const state = deps.state.get(chatId);
  if (!state || state.step !== "tx-edit") return false;

  const text = msg.text?.trim();
  if (!text || text.startsWith("/") || MENU_TEXTS.has(text)) return true;
  if (!EDITABLE_TEXT_FIELDS.has(state.txField)) return true;

  const { txRow: row, txField: field, cardMessageId } = state;
  const transaction = await getTransaction(deps, row);
  await safeDeleteMessage(bot, deps.logger, chatId, msg.message_id);

  if (!transaction) {
    deps.state.del(chatId);
    await bot.sendMessage(
      chatId,
      MESSAGES.TRANSACTION_VIEW.NOT_FOUND,
      mainKeyboard
    );
    return true;
  }

  if (field === "date") {
    const date = parseDateDDMMYYYY(text);
    if (!date) {
      await showEditPrompt(bot, deps, chatId, row, field, cardMessageId, {
        error: MESSAGES.TRANSACTION_VIEW.EDIT_DATE_INVALID,
      });
      return true;
    }

    return saveField(
      bot,
      deps,
      chatId,
      transaction,
      field,
      formatDateToDisplay(date),
      cardMessageId
    );
  }

  if (field === "amount") {
    const amount = parseAmount(text);
    if (Number.isNaN(amount) || amount === 0) {
      await showEditPrompt(bot, deps, chatId, row, field, cardMessageId, {
        error: MESSAGES.TRANSACTION_VIEW.EDIT_AMOUNT_INVALID,
      });
      return true;
    }

    return saveField(
      bot,
      deps,
      chatId,
      transaction,
      field,
      amount,
      cardMessageId
    );
  }

  const note = text === "-" ? "" : text;
  return saveField(
    bot,
    deps,
    chatId,
    transaction,
    field,
    note,
    cardMessageId
  );
}

export async function handleTransactionCallback(
  bot,
  deps,
  chatId,
  data,
  messageId
) {
  const { logger } = deps;
  const parts = data.split(":");
  if (parts[0] !== "tx") return {};

  const [, action, rawRow, field, rawIndex] = parts;
  const row = Number(rawRow);
  if (!Number.isInteger(row)) return {};

  if (action === "close") {
    deps.state.del(chatId);
    await safeDeleteMessage(bot, logger, chatId, messageId);
    await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    return {};
  }

  if (action === "confirm-delete") {
    return confirmDelete(bot, deps, chatId, messageId, row);
  }

  if (action === "edit-cancel") {
    deps.state.del(chatId);
    const transaction = await getTransaction(deps, row);
    if (!transaction) {
      await safeDeleteMessage(bot, logger, chatId, messageId);
      return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
    }

    await renderTransaction(bot, deps, chatId, transaction, messageId);
    return {};
  }

  const transaction = await getTransaction(deps, row);
  if (!transaction) {
    deps.state.del(chatId);
    await safeDeleteMessage(bot, logger, chatId, messageId);
    return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
  }

  if (action === "view") {
    deps.state.del(chatId);
    await renderTransaction(bot, deps, chatId, transaction, messageId);
    return {};
  }

  if (action === "delete") {
    if (await isTransfer(deps, transaction)) {
      return { alert: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED };
    }

    await editOrSend(
      bot,
      logger,
      chatId,
      messageId,
      `${MESSAGES.TRANSACTION_VIEW.DELETE_CONFIRM}\n\n${formatTransactionText(
        transaction,
        { title: false }
      )}`,
      createTransactionDeleteKeyboard(row)
    );
    return {};
  }

  if (action === "cancel-delete") {
    deps.state.del(chatId);
    await renderTransaction(bot, deps, chatId, transaction, messageId);
    return {};
  }

  if (action === "prev" || action === "next") {
    deps.state.del(chatId);
    const neighbor = await deps.sheets.getNeighborTransaction(row, action);
    if (!neighbor) {
      return {
        alert:
          action === "prev"
            ? MESSAGES.TRANSACTION_VIEW.NO_PREVIOUS
            : MESSAGES.TRANSACTION_VIEW.NO_NEXT,
      };
    }

    await renderTransaction(bot, deps, chatId, neighbor, messageId);
    return {};
  }

  if (action === "edit") {
    if (await isTransfer(deps, transaction)) {
      return { alert: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED };
    }

    return showEditMenu(bot, deps, chatId, transaction, messageId);
  }

  if (action === "edit-field") {
    if (await isTransfer(deps, transaction)) {
      return { alert: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED };
    }

    return showEditPrompt(bot, deps, chatId, row, field, messageId);
  }

  if (action === "edit-pick") {
    if (await isTransfer(deps, transaction)) {
      return { alert: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED };
    }

    const items =
      field === "category"
        ? await getEditCategories(deps)
        : field === "wallet"
          ? await deps.sheets.getWallets()
          : null;
    const index = Number(rawIndex);
    if (!items || !Number.isInteger(index) || !items[index]) return {};

    return saveField(
      bot,
      deps,
      chatId,
      transaction,
      field,
      items[index],
      messageId
    );
  }

  return {};
}

export function registerTransactionHandler(bot, deps) {
  const withAccess = createAccessMiddleware(bot, deps);
  const handler = withAccess(async (bot, deps, msg) => {
    await handleLastTransactionCommand(bot, deps, msg);
  });

  bot.onText(/^\/last$/, handler);
  bot.onText(/^Последняя транзакция$/, handler);
  bot.on("message", async (msg) => {
    try {
      await handleTransactionText(bot, deps, msg);
    } catch (error) {
      deps.logger.error(
        `Ошибка при изменении транзакции: ${error.message}`,
        error
      );
    }
  });
}
