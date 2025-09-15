// addHandler.js
import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
  showMainKeyboard,
  removeKeyboard,
} from "../utils.js";

export function registerAddHandler(bot, { sheets, state, logger }) {
  // Обработчик команды /add
  bot.onText(/^\/add$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/add от пользователя ${chatId}`);

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
        "Начинаем добавление транзакции...",
        removeKeyboard
      );

      await bot.sendMessage(
        chatId,
        "Введите дату операции (в формате ДД.ММ.ГГГГ):"
      );
    } catch (err) {
      logger.error("Ошибка при получении категорий/кошельков", err);
      await bot.sendMessage(chatId, "Произошла ошибка при инициализации ❌");
      await showMainKeyboard(bot, chatId);
    }
  });

  // Обработчик сообщений для диалога добавления транзакции
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userState = state.get(chatId);

    // Если пользователь не в процессе добавления или это команда - выходим
    if (!userState || (msg.text && msg.text.startsWith("/"))) return;

    const text = msg.text?.trim();
    if (!text) return;

    try {
      if (userState.step === "date") {
        const date = parseDateDDMMYYYY(text);
        if (!date) {
          await bot.sendMessage(
            chatId,
            "Неверный формат даты, попробуйте ещё раз (ДД.ММ.ГГГГ)."
          );
          return;
        }
        userState.data.date = formatDateToDisplay(date);
        userState.step = "amount";
        await bot.sendMessage(chatId, "Введите сумму:");
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (amount === null) {
          await bot.sendMessage(
            chatId,
            "Неверная сумма, попробуйте ещё раз (например: 123.45)."
          );
          return;
        }
        userState.data.amount = amount;
        userState.step = "category";

        // Создаем клавиатуру с категориями из таблицы
        const categoryKeyboard = {
          reply_markup: {
            keyboard: userState.categories.map((cat) => [cat]),
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };

        await bot.sendMessage(chatId, "Выберите категорию:", categoryKeyboard);
      } else if (userState.step === "category") {
        // Проверяем, что выбрана существующая категория
        if (!userState.categories.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите категорию из предложенных вариантов."
          );
          return;
        }

        userState.data.category = text;
        userState.step = "wallet";

        // Создаем клавиатуру с кошельками из таблицы
        const walletKeyboard = {
          reply_markup: {
            keyboard: userState.wallets.map((wallet) => [wallet]),
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };

        await bot.sendMessage(chatId, "Выберите кошелёк:", walletKeyboard);
      } else if (userState.step === "wallet") {
        // Проверяем, что выбран существующий кошелек
        if (!userState.wallets.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите кошелёк из предложенных вариантов."
          );
          return;
        }

        userState.data.wallet = text;
        userState.step = "note";

        // Убираем клавиатуру
        await bot.sendMessage(
          chatId,
          "Введите примечание (или отправьте '-' для пустого примечания):",
          { reply_markup: { remove_keyboard: true } }
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
