import {
  applyAmountAction,
  formatAmountDraft,
  formatAmountValue,
  parseAmountCallback,
} from "../amount.js";
import {
  buildCalendarText,
  parseCalendarCallback,
  resolveCalendarDate,
} from "../calendar.js";
import {
  createAmountKeyboard,
  createCalendarKeyboard,
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
  checkAccess,
  createAccessMiddleware,
  formatDateToDisplay,
  parseAmount,
  parseDateDDMMYYYY,
  removeInlineKeyboard,
  safeDeleteMessage,
} from "../utils.js";

const TX_AMOUNT_PREFIX = "tx:amt";
const TX_CALENDAR_PREFIX = "tx:cal";

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

function editedCardKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function editedCards(deps) {
  if (!deps.txEditedCards) deps.txEditedCards = new Set();
  return deps.txEditedCards;
}

function markEditedCard(deps, chatId, messageId) {
  if (!messageId) return;
  editedCards(deps).add(editedCardKey(chatId, messageId));
}

function isEditedCard(deps, chatId, messageId) {
  if (!messageId) return false;
  return editedCards(deps).has(editedCardKey(chatId, messageId));
}

function clearEditedCard(deps, chatId, messageId) {
  if (!messageId) return;
  editedCards(deps).delete(editedCardKey(chatId, messageId));
}

function cardRenderOptions(deps, chatId, messageId) {
  const edited = isEditedCard(deps, chatId, messageId);
  return edited
    ? { edited: true, prefix: MESSAGES.TRANSACTION_VIEW.UPDATED }
    : { edited: false };
}

function formatTransactionText(transaction, { title = true } = {}) {
  const amount = Number.isFinite(transaction.amount)
    ? formatAmountValue(transaction.amount)
    : MESSAGES.AI.UNKNOWN;

  const lines = [];
  if (title) {
    lines.push(
      `${MESSAGES.TRANSACTION_VIEW.TITLE} ${transaction.row}`,
      ""
    );
  }
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

function buildView(transaction, transfer, { edited = false } = {}) {
  let text = formatTransactionText(transaction);
  if (transfer) {
    text += `\n\n${MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED}`;
  }

  const keyboard = createTransactionKeyboard({
    row: transaction.row,
    canEdit: !transfer,
    canDelete: !transfer,
    nav: true,
    edited,
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
  { prefix = "", edited = false } = {}
) {
  const transfer = await isTransfer(deps, transaction);
  const { text, keyboard } = buildView(transaction, transfer, { edited });
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

function amountToDraft(amount) {
  return Number.isFinite(amount) ? String(amount).replace(".", ",") : "";
}

function getCalendarParts(transaction) {
  const date = parseDateDDMMYYYY(transaction.date) || new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function withError(error, text) {
  return error ? `${error}\n\n${text}` : text;
}

async function renderAmountEditor(
  bot,
  deps,
  chatId,
  row,
  messageId,
  { error = "" } = {}
) {
  const state = deps.state.get(chatId);
  if (!state || state.step !== "tx-edit" || state.txField !== "amount") {
    return;
  }

  const text = withError(
    error,
    [
      MESSAGES.ADD_TRANSACTION.AMOUNT_PROMPT,
      "",
      `${MESSAGES.ADD_TRANSACTION.AMOUNT_SELECTED} ${formatAmountDraft(
        state.txAmountDraft || ""
      )}`,
    ].join("\n")
  );

  const keyboard = createAmountKeyboard({
    prefix: TX_AMOUNT_PREFIX,
    allowSign: false,
    footer: [
      [
        { text: "Назад", callback_data: `tx:edit:${row}` },
        { text: "❌ Отмена", callback_data: `tx:edit-cancel:${row}` },
      ],
    ],
  });

  await editOrSend(bot, deps.logger, chatId, messageId, text, keyboard);
}

async function renderDateEditor(
  bot,
  deps,
  chatId,
  row,
  messageId,
  year,
  month,
  { error = "" } = {}
) {
  const text = withError(
    error,
    [
      MESSAGES.ADD_TRANSACTION.DATE_PROMPT,
      "",
      buildCalendarText(year, month),
    ].join("\n")
  );

  const keyboard = createCalendarKeyboard(year, month, {
    prefix: TX_CALENDAR_PREFIX,
    footer: [
      [
        { text: "Назад", callback_data: `tx:edit:${row}` },
        { text: "❌ Отмена", callback_data: `tx:edit-cancel:${row}` },
      ],
    ],
  });

  await editOrSend(bot, deps.logger, chatId, messageId, text, keyboard);
}

async function showEditPrompt(
  bot,
  deps,
  chatId,
  transaction,
  field,
  messageId,
  { error = "" } = {}
) {
  if (!EDITABLE_FIELDS.has(field)) return {};

  const row = transaction.row;

  if (field === "amount") {
    deps.state.set(chatId, {
      step: "tx-edit",
      txRow: row,
      txField: field,
      txAmountDraft: amountToDraft(transaction.amount),
      cardMessageId: messageId,
    });
    await renderAmountEditor(bot, deps, chatId, row, messageId, { error });
    return {};
  }

  if (field === "date") {
    const { year, month } = getCalendarParts(transaction);
    deps.state.set(chatId, {
      step: "tx-edit",
      txRow: row,
      txField: field,
      txCalendarYear: year,
      txCalendarMonth: month,
      cardMessageId: messageId,
    });
    await renderDateEditor(
      bot,
      deps,
      chatId,
      row,
      messageId,
      year,
      month,
      { error }
    );
    return {};
  }

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
    : withError(error, MESSAGES.TRANSACTION_VIEW.EDIT_NOTE_PROMPT);
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
    markEditedCard(deps, chatId, messageId);
    await renderTransaction(
      bot,
      deps,
      chatId,
      updated,
      messageId,
      { prefix: MESSAGES.TRANSACTION_VIEW.UPDATED, edited: true }
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
    clearEditedCard(deps, chatId, messageId);
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
  if (!checkAccess(chatId, deps.config)) return false;

  const peeked = deps.state.peek
    ? deps.state.peek(chatId)
    : deps.state.get(chatId);
  if (!peeked || peeked.step !== "tx-edit") return false;

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
      await showEditPrompt(
        bot,
        deps,
        chatId,
        transaction,
        field,
        cardMessageId,
        { error: MESSAGES.TRANSACTION_VIEW.EDIT_DATE_INVALID }
      );
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
      await showEditPrompt(
        bot,
        deps,
        chatId,
        transaction,
        field,
        cardMessageId,
        { error: MESSAGES.TRANSACTION_VIEW.EDIT_AMOUNT_INVALID }
      );
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

async function handleTransactionAmountAction(bot, deps, chatId, data) {
  const action = parseAmountCallback(data, TX_AMOUNT_PREFIX);
  if (!action) return null;

  const state = deps.state.get(chatId);
  if (!state || state.step !== "tx-edit" || state.txField !== "amount") {
    return {};
  }

  if (action.type === "confirm") {
    const amount = parseAmount(state.txAmountDraft || "");
    if (Number.isNaN(amount) || amount === 0) {
      return { alert: MESSAGES.ADD_TRANSACTION.AMOUNT_EMPTY };
    }

    const transaction = await getTransaction(deps, state.txRow);
    if (!transaction) {
      deps.state.del(chatId);
      return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
    }

    return saveField(
      bot,
      deps,
      chatId,
      transaction,
      "amount",
      amount,
      state.cardMessageId
    );
  }

  const currentDraft = state.txAmountDraft || "";
  const nextDraft = applyAmountAction(currentDraft, action);
  if (nextDraft === currentDraft) {
    return action.type === "digit"
      ? { alert: MESSAGES.ADD_TRANSACTION.AMOUNT_LIMIT }
      : {};
  }

  deps.state.update(chatId, { txAmountDraft: nextDraft });
  await renderAmountEditor(
    bot,
    deps,
    chatId,
    state.txRow,
    state.cardMessageId
  );
  return {};
}

async function handleTransactionCalendarAction(bot, deps, chatId, data) {
  const action = parseCalendarCallback(data, TX_CALENDAR_PREFIX);
  if (!action) return null;
  if (action.type === "noop") return {};

  const state = deps.state.get(chatId);
  if (!state || state.step !== "tx-edit" || state.txField !== "date") {
    return {};
  }

  if (action.type === "nav") {
    deps.state.update(chatId, {
      txCalendarYear: action.year,
      txCalendarMonth: action.month,
    });
    await renderDateEditor(
      bot,
      deps,
      chatId,
      state.txRow,
      state.cardMessageId,
      action.year,
      action.month
    );
    return {};
  }

  const transaction = await getTransaction(deps, state.txRow);
  if (!transaction) {
    deps.state.del(chatId);
    return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
  }

  const date = resolveCalendarDate(action);
  return saveField(
    bot,
    deps,
    chatId,
    transaction,
    "date",
    formatDateToDisplay(date),
    state.cardMessageId
  );
}

export async function handleTransactionCallback(
  bot,
  deps,
  chatId,
  data,
  messageId
) {
  if (data.startsWith(`${TX_AMOUNT_PREFIX}:`)) {
    return handleTransactionAmountAction(bot, deps, chatId, data);
  }

  if (data.startsWith(`${TX_CALENDAR_PREFIX}:`)) {
    return handleTransactionCalendarAction(bot, deps, chatId, data);
  }

  const { logger } = deps;
  const parts = data.split(":");
  if (parts[0] !== "tx") return {};

  const [, action, rawRow, field, rawIndex] = parts;
  const row = Number(rawRow);
  if (!Number.isInteger(row) || row < 2) return {};

  if (action === "close" || action === "close-edited") {
    deps.state.del(chatId);
    const edited =
      action === "close-edited" ||
      isEditedCard(deps, chatId, messageId);
    clearEditedCard(deps, chatId, messageId);

    if (edited) {
      await removeInlineKeyboard(bot, logger, chatId, messageId);
      return {};
    }

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

    await renderTransaction(
      bot,
      deps,
      chatId,
      transaction,
      messageId,
      cardRenderOptions(deps, chatId, messageId)
    );
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
    await renderTransaction(
      bot,
      deps,
      chatId,
      transaction,
      messageId,
      cardRenderOptions(deps, chatId, messageId)
    );
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
    await renderTransaction(
      bot,
      deps,
      chatId,
      transaction,
      messageId,
      cardRenderOptions(deps, chatId, messageId)
    );
    return {};
  }

  if (
    action === "prev" ||
    action === "next" ||
    action === "prev-edited" ||
    action === "next-edited"
  ) {
    deps.state.del(chatId);
    const direction = action.startsWith("prev") ? "prev" : "next";
    const neighbor = await deps.sheets.getNeighborTransaction(row, direction);
    if (!neighbor) {
      return {
        alert:
          direction === "prev"
            ? MESSAGES.TRANSACTION_VIEW.NO_PREVIOUS
            : MESSAGES.TRANSACTION_VIEW.NO_NEXT,
      };
    }

    const edited =
      action.endsWith("-edited") ||
      isEditedCard(deps, chatId, messageId);
    if (edited) {
      clearEditedCard(deps, chatId, messageId);
      await removeInlineKeyboard(bot, logger, chatId, messageId);
      await renderTransaction(bot, deps, chatId, neighbor);
      return {};
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

    return showEditPrompt(
      bot,
      deps,
      chatId,
      transaction,
      field,
      messageId
    );
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
