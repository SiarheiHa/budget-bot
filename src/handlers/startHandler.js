import { mainKeyboard, showMainKeyboard } from "../keyboards.js";

export function registerStartHandler(bot, deps) {
  const { logger } = deps;

  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/start от пользователя ${chatId}`);

    await bot.sendMessage(
      chatId,
      "Привет! 👋 Я бот для учёта бюджета.\n\n" +
        "Выберите действие из меню ниже:\n\n" +
        "ℹ️ Вы можете отменить операцию в любой момент, нажав '❌ Отмена' или отправив /cancel",
      mainKeyboard
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
