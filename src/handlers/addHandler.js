import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
  createAccessMiddleware,
  removeInlineKeyboard,
  safeDeleteMessage,
} from "../utils.js";

import { formatAmountDraft, formatAmountValue } from "../amount.js";
import { buildCalendarText } from "../calendar.js";
import {
  createAmountKeyboard,
  createCancelableKeyboard,
  createCalendarKeyboard,
  createNoteForceReply,
  mainKeyboard,
  showMainKeyboard,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";

function getErrorDescription(err) {
  return err?.response?.body?.description || err?.message || "";
}

function isNotModifiedError(err) {
  return getErrorDescription(err).includes("message is not modified");
}

function isMessageNotFoundError(err) {
  const description = getErrorDescription(err);
  return (
    description.includes("message to edit not found") ||
    description.includes("message not found")
  );
}

function buildAddCardText(data, options = {}) {
  const lines = [];

  if (options.title !== false) {
    lines.push(MESSAGES.ADD_TRANSACTION.CARD_TITLE, "");
  }

  const amountText =
    options.amountText ??
    (Number.isFinite(data.amount) ? formatAmountValue(data.amount) : "—");

  lines.push(
    `${MESSAGES.AI.DATE_LABEL}: ${data.date || "—"}`,
    `${MESSAGES.AI.AMOUNT_LABEL}: ${amountText}`,
    `${MESSAGES.AI.CATEGORY_LABEL}: ${data.category || "—"}`
  );

  if (data.transfer) {
    lines.push(
      `${MESSAGES.ADD_TRANSACTION.TRANSFER_FROM_LABEL}: ${
        data.transferFrom || "—"
      }`,
      `${MESSAGES.ADD_TRANSACTION.TRANSFER_TO_LABEL}: ${
        data.transferTo || "—"
      }`
    );
  } else {
    lines.push(`${MESSAGES.AI.WALLET_LABEL}: ${data.wallet || "—"}`);
  }

  lines.push(`${MESSAGES.AI.NOTE_LABEL}: ${data.note || "—"}`);

  if (options.prompt) {
    lines.push("", options.prompt);
  }

  if (options.error) {
    lines.push("", options.error);
  }

  return lines.join("\n");
}

async function renderCardMessage(bot, deps, chatId, text, replyMarkup) {
  const current = deps.state.get(chatId);

  if (current?.cardMessageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: current.cardMessageId,
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      if (isNotModifiedError(err)) return;
      if (!isMessageNotFoundError(err)) {
        deps.logger?.warn?.(
          `Не удалось обновить карточку транзакции: ${err.message}`
        );
        return;
      }
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  deps.state.update(chatId, { cardMessageId: sent.message_id });
}

async function sendCardWithReplyMarkup(
  bot,
  deps,
  chatId,
  text,
  replyMarkup
) {
  const current = deps.state.get(chatId);
  const previousMessageId = current?.cardMessageId;

  const sent = await bot.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  deps.state.update(chatId, { cardMessageId: sent.message_id });

  if (previousMessageId) {
    await safeDeleteMessage(bot, deps.logger, chatId, previousMessageId);
  }
}

export async function showCalendarStep(bot, deps, chatId, options = {}) {
  const now = new Date();
  const year = options.year ?? now.getFullYear();
  const month = options.month ?? now.getMonth() + 1;
  const userState = deps.state.get(chatId);
  const data = userState?.data || {};

  const text = buildAddCardText(data, {
    prompt:
      MESSAGES.ADD_TRANSACTION.DATE_PROMPT +
      "\n" +
      buildCalendarText(year, month),
    error: options.error,
  });

  await renderCardMessage(
    bot,
    deps,
    chatId,
    text,
    createCalendarKeyboard(year, month).reply_markup
  );
}

export async function renderAmountStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "amount") return;

  const draft = userState.amountDraft || "";
  const text = buildAddCardText(userState.data, {
    amountText: formatAmountDraft(draft) || "—",
    prompt: MESSAGES.ADD_TRANSACTION.AMOUNT_PROMPT,
    error,
  });

  await renderCardMessage(
    bot,
    deps,
    chatId,
    text,
    createAmountKeyboard().reply_markup
  );
}

export async function startAmountStep(bot, deps, chatId) {
  await renderAmountStep(bot, deps, chatId);
}

export async function showCategoryStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "category") return;

  const text = buildAddCardText(userState.data, {
    prompt: MESSAGES.ADD_TRANSACTION.CATEGORY_PROMPT,
    error,
  });

  await sendCardWithReplyMarkup(
    bot,
    deps,
    chatId,
    text,
    createCancelableKeyboard(userState.categories).reply_markup
  );
}

export async function showWalletStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "wallet") return;

  const text = buildAddCardText(userState.data, {
    prompt: MESSAGES.ADD_TRANSACTION.WALLET_PROMPT,
    error,
  });

  await sendCardWithReplyMarkup(
    bot,
    deps,
    chatId,
    text,
    createCancelableKeyboard(userState.wallets).reply_markup
  );
}

export async function showTransferFromStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "transferFrom") return;

  const text = buildAddCardText(userState.data, {
    prompt: MESSAGES.ADD_TRANSACTION.TRANSFER_FROM_PROMPT,
    error,
  });

  await sendCardWithReplyMarkup(
    bot,
    deps,
    chatId,
    text,
    createCancelableKeyboard(userState.wallets).reply_markup
  );
}

export async function showTransferToStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "transferTo") return;

  const targets = (userState.wallets || []).filter(
    (wallet) => wallet !== userState.data.transferFrom
  );
  const text = buildAddCardText(userState.data, {
    prompt: MESSAGES.ADD_TRANSACTION.TRANSFER_TO_PROMPT,
    error,
  });

  await sendCardWithReplyMarkup(
    bot,
    deps,
    chatId,
    text,
    createCancelableKeyboard(targets).reply_markup
  );
}

export async function showNoteStep(bot, deps, chatId, error) {
  const userState = deps.state.get(chatId);
  if (!userState || userState.step !== "note") return;

  const text = buildAddCardText(userState.data, {
    prompt: MESSAGES.ADD_TRANSACTION.NOTE_PROMPT,
    error,
  });

  await sendCardWithReplyMarkup(
    bot,
    deps,
    chatId,
    text,
    createNoteForceReply().reply_markup
  );
}

export async function completeDateStep(bot, deps, chatId, userState, date) {
  const display = formatDateToDisplay(date);

  deps.state.update(chatId, {
    step: "amount",
    data: {
      ...userState.data,
      date: display,
    },
    amountDraft: "",
  });

  await renderAmountStep(bot, deps, chatId);
}

export async function completeAmountStep(bot, deps, chatId, userState, amount) {
  deps.state.update(chatId, {
    step: "category",
    data: {
      ...userState.data,
      amount,
    },
    amountDraft: "",
  });

  if (deps.amountUi) {
    await deps.amountUi.abort(chatId);
  }

  await showCategoryStep(bot, deps, chatId);
}

async function selectCategory(bot, deps, chatId, userState, category) {
  const type = userState.categoryTypes?.[category];

  if (type === "transfer") {
    if ((userState.wallets || []).length < 2) {
      await showCategoryStep(
        bot,
        deps,
        chatId,
        MESSAGES.ADD_TRANSACTION.TRANSFER_NOT_ENOUGH_WALLETS
      );
      return;
    }

    deps.state.update(chatId, {
      step: "transferFrom",
      data: {
        ...userState.data,
        category,
        amount: Math.abs(userState.data.amount),
        transfer: true,
        transferFrom: undefined,
        transferTo: undefined,
      },
    });

    await showTransferFromStep(bot, deps, chatId);
    return;
  }

  deps.state.update(chatId, {
    step: "wallet",
    data: {
      ...userState.data,
      category,
    },
  });

  await showWalletStep(bot, deps, chatId);
}

async function selectWallet(bot, deps, chatId, userState, wallet) {
  deps.state.update(chatId, {
    step: "note",
    data: {
      ...userState.data,
      wallet,
    },
  });

  await showNoteStep(bot, deps, chatId);
}

async function selectTransferFrom(bot, deps, chatId, userState, wallet) {
  deps.state.update(chatId, {
    step: "transferTo",
    data: {
      ...userState.data,
      transferFrom: wallet,
    },
  });

  await showTransferToStep(bot, deps, chatId);
}

async function selectTransferTo(bot, deps, chatId, userState, wallet) {
  deps.state.update(chatId, {
    step: "note",
    data: {
      ...userState.data,
      transferTo: wallet,
    },
  });

  await showNoteStep(bot, deps, chatId);
}

async function sendFinalMessage(bot, deps, chatId, text, cardMessageId) {
  await bot.sendMessage(chatId, text, mainKeyboard);
  await safeDeleteMessage(bot, deps.logger, chatId, cardMessageId);
}

export async function completeNoteStep(
  bot,
  deps,
  chatId,
  userState,
  note,
  userMessageId
) {
  const { sheets, logger } = deps;
  const transactionData = {
    ...userState.data,
    note,
  };
  const isTransfer =
    transactionData.transfer === true &&
    Boolean(transactionData.transferFrom) &&
    Boolean(transactionData.transferTo);

  try {
    if (isTransfer) {
      await sheets.appendTransfer({
        date: transactionData.date,
        amount: transactionData.amount,
        category: transactionData.category,
        fromWallet: transactionData.transferFrom,
        toWallet: transactionData.transferTo,
        note,
      });
    } else {
      await sheets.appendTransaction(transactionData);
    }
    logger.info(
      isTransfer ? "Добавлен перевод" : "Добавлена транзакция",
      transactionData
    );

    await safeDeleteMessage(bot, logger, chatId, userMessageId);

    const summary = buildAddCardText(transactionData, { title: false });
    deps.state.del(chatId);
    await sendFinalMessage(
      bot,
      deps,
      chatId,
      `${summary}\n\n${MESSAGES.ADD_TRANSACTION.SUCCESS}`,
      userState.cardMessageId
    );
  } catch (err) {
    logger.error("Ошибка в сценарии /add", err);
    if (deps.amountUi) {
      await deps.amountUi.abort(chatId);
    }
    deps.state.del(chatId);
    await sendFinalMessage(
      bot,
      deps,
      chatId,
      MESSAGES.ADD_TRANSACTION.ERROR,
      userState.cardMessageId
    );
  }
}

// Добавляем экспорт функции для обработки команды /add
export async function handleAddCommand(bot, deps, msg) {
  const { sheets, state, logger } = deps;
  const chatId = msg.chat.id;
  logger.info(`/add от пользователя ${chatId}`);

  try {
    await safeDeleteMessage(bot, logger, chatId, msg.message_id);

    // Получаем категории и кошельки из таблицы
    const [categoryRows, wallets] = await Promise.all([
      sheets.getCategories(),
      sheets.getWallets(),
    ]);
    const categories = categoryRows.map((category) => category.name);
    const categoryTypes = Object.fromEntries(
      categoryRows.map((category) => [category.name, category.type])
    );

    const existingState = state.get(chatId);
    if (deps.amountUi) {
      await deps.amountUi.abort(chatId);
    }
    if (existingState) {
      if (existingState.cardMessageId) {
        await safeDeleteMessage(
          bot,
          logger,
          chatId,
          existingState.cardMessageId
        );
      }
      await removeInlineKeyboard(
        bot,
        logger,
        chatId,
        existingState.calendarMessageId
      );
      await removeInlineKeyboard(
        bot,
        logger,
        chatId,
        existingState.amountMessageId
      );
      await removeInlineKeyboard(bot, logger, chatId, existingState.aiMessageId);
    }

    // Сохраняем в состоянии для последующего использования
    state.set(chatId, {
      step: "date",
      data: {},
      categories,
      categoryTypes,
      wallets,
      amountDraft: "",
    });

    await showCalendarStep(bot, deps, chatId);
  } catch (err) {
    logger.error("Ошибка при получении категорий/кошельков", err);
    await bot.sendMessage(
      chatId,
      MESSAGES.ADD_TRANSACTION.INIT_ERROR,
      mainKeyboard
    );
  }
}

export function registerAddHandler(bot, deps) {
  // Обработчик команды /add
  const { state, logger } = deps;
  const withAccess = createAccessMiddleware(bot, deps);
  bot.onText(
    /^\/add$/,
    withAccess(async (bot, deps, msg) => {
      await handleAddCommand(bot, deps, msg);
    })
  );

  // Обработчик сообщений для диалога добавления транзакции
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const { MESSAGES } = await import("../messages.js");
    const userState = state.get(chatId, {
      bot,
      chatId,
      messages: { COMMON: MESSAGES.COMMON },
      keyboards: { mainKeyboard },
    });

    // Если пользователь не в процессе добавления или это команда - выходим
    if (!userState || (msg.text && msg.text.startsWith("/"))) return;

    const text = msg.text?.trim();
    if (!text) return;

    // Проверка на отмену
    if (text === "❌ Отмена") return;

    // Кнопки главного меню обрабатываются своими хендлерами
    if (text === "Добавить транзакцию" || text === "Показать баланс") return;

    try {
      if (userState.step === "date") {
        const date = parseDateDDMMYYYY(text);
        if (!date) {
          await showCalendarStep(bot, deps, chatId, {
            error: MESSAGES.ADD_TRANSACTION.DATE_INVALID,
          });
          return;
        }
        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await completeDateStep(bot, deps, chatId, userState, date);
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (Number.isNaN(amount) || amount === 0) {
          await renderAmountStep(
            bot,
            deps,
            chatId,
            MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID
          );
          return;
        }

        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await completeAmountStep(bot, deps, chatId, userState, amount);
      } else if (userState.step === "category") {
        // Проверяем, что выбрана существующая категория
        if (!userState.categories.includes(text)) {
          await showCategoryStep(
            bot,
            deps,
            chatId,
            MESSAGES.ADD_TRANSACTION.CATEGORY_INVALID
          );
          return;
        }

        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await selectCategory(bot, deps, chatId, userState, text);
      } else if (userState.step === "wallet") {
        // Проверяем, что выбран существующий кошелек
        if (!userState.wallets.includes(text)) {
          await showWalletStep(
            bot,
            deps,
            chatId,
            MESSAGES.ADD_TRANSACTION.WALLET_INVALID
          );
          return;
        }

        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await selectWallet(bot, deps, chatId, userState, text);
      } else if (userState.step === "transferFrom") {
        if (!userState.wallets.includes(text)) {
          await showTransferFromStep(
            bot,
            deps,
            chatId,
            MESSAGES.ADD_TRANSACTION.WALLET_INVALID
          );
          return;
        }

        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await selectTransferFrom(bot, deps, chatId, userState, text);
      } else if (userState.step === "transferTo") {
        const targets = userState.wallets.filter(
          (wallet) => wallet !== userState.data.transferFrom
        );

        if (!targets.includes(text)) {
          await showTransferToStep(
            bot,
            deps,
            chatId,
            text === userState.data.transferFrom
              ? MESSAGES.ADD_TRANSACTION.TRANSFER_SAME_WALLET
              : MESSAGES.ADD_TRANSACTION.WALLET_INVALID
          );
          return;
        }

        await safeDeleteMessage(bot, logger, chatId, msg.message_id);
        await selectTransferTo(bot, deps, chatId, userState, text);
      } else if (userState.step === "note") {
        // Если пользователь отправил "-", сохраняем пустую строку
        const note = text === "-" ? "" : text;
        await completeNoteStep(
          bot,
          deps,
          chatId,
          userState,
          note,
          msg.message_id
        );
      }
    } catch (err) {
      logger.error("Ошибка в сценарии /add", err);
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.ERROR);

      // Чистим state и возвращаем основную клавиатуру даже при ошибке
      if (deps.amountUi) {
        await deps.amountUi.abort(chatId);
      }
      state.del(chatId);
      await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    }
  });
}
