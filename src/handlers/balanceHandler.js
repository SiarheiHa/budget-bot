// balanceHandler.js
import { showMainKeyboard, removeKeyboard } from "../keyboards.js";

export function registerBalanceHandler(bot, { sheets, logger }) {
  bot.onText(/^\/balance$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/balance от пользователя ${chatId}`);

    try {
      await bot.sendMessage(chatId, "Запрашиваю балансы...", removeKeyboard);
      const balances = await sheets.getBalances();

      if (!balances || balances.length === 0) {
        await bot.sendMessage(chatId, "Балансов пока нет 😕");
        await showMainKeyboard(bot, chatId);
        return;
      }

      const text = balances.map((b) => `💰 ${b.name}: ${b.balance}`).join("\n");
      await bot.sendMessage(chatId, `Текущие балансы:\n\n${text}`);
      await showMainKeyboard(bot, chatId);
    } catch (err) {
      logger.error("Ошибка при получении балансов", err);
      await bot.sendMessage(chatId, "Не удалось получить балансы ❌");
      await showMainKeyboard(bot, chatId);
    }
  });
}
