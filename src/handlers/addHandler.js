import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
  createAccessMiddleware,
} from "../utils.js";

import { buildCalendarText } from "../calendar.js";
import {
  createCancelableKeyboard,
  createCalendarKeyboard,
  showMainKeyboard,
  createForceReply,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";

export async function startAmountStep(bot, deps, chatId) {
  await bot.sendMessage(
    chatId,
    MESSAGES.ADD_TRANSACTION.AMOUNT_PROMPT + "\n\nДля отмены: /cancel",
    createForceReply()
  );
}

export async function showCalendarStep(bot, deps, chatId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const sent = await bot.sendMessage(
    chatId,
    MESSAGES.ADD_TRANSACTION.DATE_PROMPT +
      "\n\n" +
      buildCalendarText(year, month),
    createCalendarKeyboard(year, month)
  );

  deps.state.update(chatId, { calendarMessageId: sent.message_id });
}

export async function completeDateStep(bot, deps, chatId, userState, date) {
  const { logger } = deps;
  const display = formatDateToDisplay(date);

  deps.state.update(chatId, {
    step: "amount",
    data: {
      ...userState.data,
      date: display,
    },
  });

  if (userState.calendarMessageId) {
    try {
      await bot.editMessageText(
        `${MESSAGES.ADD_TRANSACTION.DATE_SELECTED} ${display}`,
        {
          chat_id: chatId,
          message_id: userState.calendarMessageId,
          reply_markup: { inline_keyboard: [] },
        }
      );
    } catch (err) {
      logger.warn(`Не удалось обновить сообщение календаря: ${err.message}`);
    }
  }

  await startAmountStep(bot, deps, chatId);
}

// Добавляем экспорт функции для обработки команды /add
export async function handleAddCommand(bot, deps, msg) {
  const { sheets, state, logger } = deps;
  const chatId = msg.chat.id;
  logger.info(`/add от пользователя ${chatId}`);
  // console.log(state.get(chatId));

  try {
    // Получаем категории и кошельки из таблицы
    const [categories, wallets] = await Promise.all([
      sheets.getCategories(),
      sheets.getWallets(),
    ]);

    const existingState = state.get(chatId);
    if (existingState && existingState.calendarMessageId) {
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: chatId,
            message_id: existingState.calendarMessageId,
          }
        );
      } catch (err) {
        logger.warn(
          `Не удалось убрать старую клавиатуру календаря: ${err.message}`
        );
      }
    }

    // Сохраняем в состоянии для последующего использования
    state.set(chatId, {
      step: "date",
      data: {},
      categories,
      wallets,
    });

    await showCalendarStep(bot, deps, chatId);
  } catch (err) {
    logger.error("Ошибка при получении категорий/кошельков", err);
    await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.INIT_ERROR);
    await showMainKeyboard(bot, chatId);
  }
}

export function registerAddHandler(bot, deps) {
  // Обработчик команды /add
  const { sheets, state, logger } = deps;
  const withAccess = createAccessMiddleware(bot, deps);
  bot.onText(
    /^\/add$/,
    withAccess(async (msg) => {
      await handleAddCommand(bot, deps, msg);
    })
  );

  // Обработчик сообщений для диалога добавления транзакции
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const { MESSAGES } = await import("../messages.js");
    const { showMainKeyboard } = await import("../keyboards.js");
    const userState = state.get(chatId, {
      bot,
      chatId,
      messages: { COMMON: MESSAGES.COMMON },
      keyboards: { showMainKeyboard },
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
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.DATE_INVALID
          );
          return;
        }
        await completeDateStep(bot, deps, chatId, userState, date);
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (amount === null || Number.isNaN(amount)) {
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID,
            createCancelableKeyboard([])
          );
          return;
        }
        state.update(chatId, {
          step: "category",
          data: {
            ...userState.data,
            amount: amount,
          },
        });

        // Создаем клавиатуру с категориями из таблицы и кнопкой отмены
        await bot.sendMessage(
          chatId,
          MESSAGES.ADD_TRANSACTION.CATEGORY_PROMPT,
          createCancelableKeyboard(userState.categories)
        );
      } else if (userState.step === "category") {
        // Проверяем, что выбрана существующая категория
        if (!userState.categories.includes(text)) {
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.CATEGORY_INVALID,
            createCancelableKeyboard(userState.categories)
          );
          return;
        }

        state.update(chatId, {
          step: "wallet",
          data: {
            ...userState.data,
            category: text,
          },
        });

        // Создаем клавиатуру с кошельками из таблицы и кнопкой отмены
        await bot.sendMessage(
          chatId,
          MESSAGES.ADD_TRANSACTION.WALLET_PROMPT,
          createCancelableKeyboard(userState.wallets)
        );
      } else if (userState.step === "wallet") {
        // Проверяем, что выбран существующий кошелек
        if (!userState.wallets.includes(text)) {
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.WALLET_INVALID,
            createCancelableKeyboard(userState.wallets)
          );
          return;
        }

        state.update(chatId, {
          step: "note",
          data: {
            ...userState.data,
            wallet: text,
          },
        });

        // Убираем клавиатуру
        await bot.sendMessage(
          chatId,
          MESSAGES.ADD_TRANSACTION.NOTE_PROMPT,
          createCancelableKeyboard([])
        );
      } else if (userState.step === "note") {
        // Если пользователь отправил "-", сохраняем пустую строку
        const note = text === "-" ? "" : text;

        // Создаем полные данные транзакции
        const transactionData = {
          ...userState.data,
          note: note,
        };

        // Всё собрано — сохраняем
        await sheets.appendTransaction(transactionData);
        logger.info("Добавлена транзакция", transactionData);

        await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.SUCCESS);

        // Чистим state и возвращаем основную клавиатуру
        state.del(chatId);
        await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
      }
    } catch (err) {
      logger.error("Ошибка в сценарии /add", err);
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.ERROR);

      // Чистим state и возвращаем основную клавиатуру даже при ошибке
      state.del(chatId);
      await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    }
  });
}
