// startHandler.js
import { mainKeyboard } from "../utils.js";

export function registerStartHandler(bot, deps) {
  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    deps.logger.info(`/start от пользователя ${chatId}`);

    await bot.sendMessage(
      chatId,
      "Привет! 👋 Я бот для учёта бюджета.\n\n" +
        "Выберите действие из меню ниже:",
      mainKeyboard
    );
  });

  // Обработчик для текстовых команд из меню
  bot.onText(/Добавить транзакцию/, async (msg) => {
    const chatId = msg.chat.id;
    deps.logger.info(`Меню: Добавить транзакцию от пользователя ${chatId}`);
    // Имитируем команду /add
    await bot.sendMessage(chatId, "/add");
  });

  bot.onText(/Показать баланс/, async (msg) => {
    const chatId = msg.chat.id;
    deps.logger.info(`Меню: Показать баланс от пользователя ${chatId}`);
    // Имитируем команду /balance
    await bot.sendMessage(chatId, "/balance");
  });
}
