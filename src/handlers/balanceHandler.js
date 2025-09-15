// Обработчик команды /balance
// Тянет данные из Google Sheets через sheets.getBalances()
// Форматирует в читаемый текст и отправляет пользователю.

export function registerBalanceHandler(bot, { sheets, logger }) {
  bot.onText(/^\/balance$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/balance от пользователя ${chatId}`);

    try {
      const balances = await sheets.getBalances();

      if (!balances || balances.length === 0) {
        await bot.sendMessage(chatId, "Балансов пока нет 😕");
        return;
      }

      // balances ожидаем в виде [{ name: "Кошелек", balance: 123 }]
      const text = balances.map((b) => `💰 ${b.name}: ${b.balance}`).join("\n");

      await bot.sendMessage(chatId, `Текущие балансы:\n\n${text}`);
    } catch (err) {
      logger.error("Ошибка при получении балансов", err);
      await bot.sendMessage(chatId, "Не удалось получить балансы ❌");
    }
  });
}
