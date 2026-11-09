import { formatAmountValue } from "../amount.js";
import {
  createTransactionDeleteKeyboard,
  createTransactionKeyboard,
  mainKeyboard,
  showMainKeyboard,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import { createAccessMiddleware, safeDeleteMessage } from "../utils.js";

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
    canEdit: false,
    canDelete: !transfer,
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

async function renderTransaction(bot, deps, chatId, transaction, messageId) {
  const transfer = await isTransfer(deps, transaction);
  const { text, keyboard } = buildView(transaction, transfer);
  return editOrSend(bot, deps.logger, chatId, messageId, text, keyboard);
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

async function getTransaction(deps, row) {
  return deps.sheets.getTransaction(row);
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

export async function handleTransactionCallback(
  bot,
  deps,
  chatId,
  data,
  messageId
) {
  const { logger } = deps;
  const match = /^tx:([a-z-]+):(\d+)$/.exec(data);
  if (!match) return {};

  const [, action, rawRow] = match;
  const row = Number(rawRow);

  if (action === "close") {
    await safeDeleteMessage(bot, logger, chatId, messageId);
    await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    return {};
  }

  if (action === "confirm-delete") {
    return confirmDelete(bot, deps, chatId, messageId, row);
  }

  const transaction = await getTransaction(deps, row);
  if (!transaction) {
    await safeDeleteMessage(bot, logger, chatId, messageId);
    return { alert: MESSAGES.TRANSACTION_VIEW.NOT_FOUND };
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
    await renderTransaction(bot, deps, chatId, transaction, messageId);
    return {};
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
}
