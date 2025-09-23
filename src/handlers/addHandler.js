import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
  createAccessMiddleware,
} from "../utils.js";

import { createCancelableKeyboard, showMainKeyboard } from "../keyboards.js";

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
      "Начинаем добавление транзакции...\n\n" +
        "Введите дату операции (в формате ДД.ММ.ГГГГ) или нажмите '❌ Отмена' для отмены:",
      createCancelableKeyboard([])
    );
  } catch (err) {
    logger.error("Ошибка при получении категорий/кошельков", err);
    await bot.sendMessage(chatId, "Произошла ошибка при инициализации ❌");
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
            "Неверный формат даты, попробуйте ещё раз (ДД.ММ.ГГГГ) или нажмите '❌ Отмена':",
            createCancelableKeyboard([])
          );
          return;
        }
        userState.data.date = formatDateToDisplay(date);
        userState.step = "amount";
        await bot.sendMessage(
          chatId,
          "Введите сумму или нажмите '❌ Отмена':",
          createCancelableKeyboard([])
        );
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (amount === null) {
          await bot.sendMessage(
            chatId,
            "Неверная сумма, попробуйте ещё раз (например: 123.45) или нажмите '❌ Отмена':",
            createCancelableKeyboard([])
          );
          return;
        }
        userState.data.amount = amount;
        userState.step = "category";

        // Создаем клавиатуру с категориями из таблицы и кнопкой отмены
        await bot.sendMessage(
          chatId,
          "Выберите категорию или нажмите '❌ Отмена':",
          createCancelableKeyboard(userState.categories)
        );
      } else if (userState.step === "category") {
        // Проверяем, что выбрана существующая категория
        if (!userState.categories.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите категорию из предложенных вариантов или нажмите '❌ Отмена':",
            createCancelableKeyboard(userState.categories)
          );
          return;
        }

        userState.data.category = text;
        userState.step = "wallet";

        // Создаем клавиатуру с кошельками из таблицы и кнопкой отмены
        await bot.sendMessage(
          chatId,
          "Выберите кошелёк или нажмите '❌ Отмена':",
          createCancelableKeyboard(userState.wallets)
        );
      } else if (userState.step === "wallet") {
        // Проверяем, что выбран существующий кошелек
        if (!userState.wallets.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите кошелёк из предложенных вариантов или нажмите '❌ Отмена':",
            createCancelableKeyboard(userState.wallets)
          );
          return;
        }

        userState.data.wallet = text;
        userState.step = "note";

        // Убираем клавиатуру
        await bot.sendMessage(
          chatId,
          "Введите примечание (или отправьте '-' для пустого примечания) или нажмите '❌ Отмена':",
          createCancelableKeyboard([])
        );
      } else if (userState.step === "note") {
        // Если пользователь отправил "-", сохраняем пустую строку
        userState.data.note = text === "-" ? "" : text;

        // Всё собрано — сохраняем
        await sheets.appendTransaction(userState.data);
        logger.info("Добавлена транзакция", userState.data);

        await bot.sendMessage(chatId, "✅ Запись добавлена в таблицу!");

        // Чистим state и возвращаем основную клавиатуру
        state.del(chatId);
        await showMainKeyboard(bot, chatId, "Что дальше?");
      }
    } catch (err) {
      logger.error("Ошибка в сценарии /add", err);
      await bot.sendMessage(chatId, "Произошла ошибка при добавлении ❌");

      // Чистим state и возвращаем основную клавиатуру даже при ошибке
      state.del(chatId);
      await showMainKeyboard(bot, chatId, "Что дальше?");
    }
  });
}
