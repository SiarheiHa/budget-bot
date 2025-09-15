// startHandler.js
import { mainKeyboard, showMainKeyboard } from "../utils.js";

export function registerStartHandler(bot, deps) {
  const { logger } = deps;

  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/start от пользователя ${chatId}`);

    await showMainKeyboard(
      bot,
      chatId,
      "Привет! 👋 Я бот для учёта бюджета.\n\nВыберите действие из меню ниже:"
    );
  });

  // Обработчик для кнопки "Добавить транзакцию"
  bot.onText(/Добавить транзакцию/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Меню: Добавить транзакцию от пользователя ${chatId}`);

    // Эмулируем команду /add
    await bot.sendMessage(chatId, "/add");
  });

  // Обработчик для кнопки "Показать баланс"
  bot.onText(/Показать баланс/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Меню: Показать баланс от пользователя ${chatId}`);

    // Эмулируем команду /balance
    await bot.sendMessage(chatId, "/balance");
  });
}
