// Обработчик команды /start
// Здесь мы просто приветствуем пользователя и объясняем, что бот умеет.
// Логика максимально простая: чисто отправка текста.

export function registerStartHandler(bot, { logger }) {
  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/start от пользователя ${chatId}`);

    await bot.sendMessage(
      chatId,
      "Привет! 👋 Я бот для учёта бюджета.\n\n" +
        "Доступные команды:\n" +
        "• /add — добавить расход/доход\n" +
        "• /balance — показать балансы\n"
    );
  });
}
