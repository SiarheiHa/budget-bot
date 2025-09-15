// Обработчик команды /add
// Реализует пошаговый диалог: бот задаёт вопросы, а ответы сохраняются в state.
// В конце — вызывает sheets.appendTransaction().

import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
} from "../utils.js";

export function registerAddHandler(bot, { sheets, state, logger }) {
  bot.onText(/^\/add$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/add от пользователя ${chatId}`);

    // Создаём состояние для пользователя
    state.set(chatId, { step: "date", data: {} });

    await bot.sendMessage(
      chatId,
      "Введите дату операции (в формате ДД.ММ.ГГГГ):"
    );
  });

  // Универсальный обработчик для всех сообщений — маршрутизируем по state
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // Если пользователь не в процессе добавления — выходим
    const userState = state.get(chatId);
    if (!userState) return;

    const text = msg.text?.trim();
    if (!text) return;

    // Пошаговый сценарий
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
        await bot.sendMessage(chatId, "Введите категорию:");
      } else if (userState.step === "category") {
        userState.data.category = text;
        userState.step = "wallet";
        await bot.sendMessage(chatId, "Введите кошелёк:");
      } else if (userState.step === "wallet") {
        userState.data.wallet = text;
        userState.step = "note";
        await bot.sendMessage(
          chatId,
          "Введите примечание (или оставьте пустым):"
        );
      } else if (userState.step === "note") {
        userState.data.note = text;

        // Всё собрано — сохраняем
        await sheets.appendTransaction(userState.data);
        logger.info("Добавлена транзакция", userState.data);

        await bot.sendMessage(chatId, "✅ Запись добавлена в таблицу!");

        // Чистим state
        state.del(chatId);
      }
    } catch (err) {
      logger.error("Ошибка в сценарии /add", err);
      await bot.sendMessage(chatId, "Произошла ошибка при добавлении ❌");
      state.del(chatId);
    }
  });
}
