import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
  createAccessMiddleware,
} from "../utils.js";

import { createCancelableKeyboard, showMainKeyboard } from "../keyboards.js";
import { MESSAGES } from "../messages.js";

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

    // Сохраняем в состоянии для последующего использования
    state.set(chatId, {
      step: "date",
      data: {},
      categories,
      wallets,
    });

    await bot.sendMessage(
      chatId,
      MESSAGES.ADD_TRANSACTION.START,
      createCancelableKeyboard([])
    );
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
    const userState = state.get(chatId);

    // Если пользователь не в процессе добавления или это команда - выходим
    if (!userState || (msg.text && msg.text.startsWith("/"))) return;

    const text = msg.text?.trim();
    if (!text) return;

    // Проверка на отмену
    if (text === "❌ Отмена") return;

    try {
      if (userState.step === "date") {
        const date = parseDateDDMMYYYY(text);
        if (!date) {
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.DATE_INVALID,
            createCancelableKeyboard([])
          );
          return;
        }
        userState.data.date = formatDateToDisplay(date);
        userState.step = "amount";
        await bot.sendMessage(
          chatId,
          MESSAGES.ADD_TRANSACTION.AMOUNT_PROMPT,
          createCancelableKeyboard([])
        );
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (amount === null) {
          await bot.sendMessage(
            chatId,
            MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID,
            createCancelableKeyboard([])
          );
          return;
        }
        userState.data.amount = amount;
        userState.step = "category";

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

        userState.data.category = text;
        userState.step = "wallet";

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

        userState.data.wallet = text;
        userState.step = "note";

        // Убираем клавиатуру
        await bot.sendMessage(
          chatId,
          MESSAGES.ADD_TRANSACTION.NOTE_PROMPT,
          createCancelableKeyboard([])
        );
      } else if (userState.step === "note") {
        // Если пользователь отправил "-", сохраняем пустую строку
        userState.data.note = text === "-" ? "" : text;

        // Всё собрано — сохраняем
        await sheets.appendTransaction(userState.data);
        logger.info("Добавлена транзакция", userState.data);

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
