import { mainKeyboard, removeKeyboard } from "../keyboards.js";
import { createAccessMiddleware } from "../utils.js";
import { MESSAGES } from "../messages.js";

// Добавляем экспорт функции для обработки команды /balance
export async function handleBalanceCommand(bot, deps, msg) {
  const { sheets, logger } = deps;

  const chatId = msg.chat.id;
  logger.info(`/balance от пользователя ${chatId}`);

  try {
    await bot.sendMessage(chatId, MESSAGES.BALANCE.LOADING, removeKeyboard);
    const balances = await sheets.getBalances();

    if (!balances || balances.length === 0) {
      await bot.sendMessage(chatId, MESSAGES.BALANCE.NO_DATA, mainKeyboard);
      return;
    }

    const text = balances
      .map((b) => `💰 ${b.name}: ${b.balance} ${b.currency}`)
      .join("\n");
    await bot.sendMessage(chatId, MESSAGES.BALANCE.TITLE + text, mainKeyboard);
  } catch (err) {
    logger.error(
      `Ошибка при получении балансов для пользователя ${chatId}: ${err.message}`,
      err
    );
    await bot.sendMessage(chatId, MESSAGES.BALANCE.ERROR, mainKeyboard);
  }
}

export function registerBalanceHandler(bot, deps) {
  const withAccess = createAccessMiddleware(bot, deps);
  bot.onText(
    /^\/balance$/,
    withAccess(async (bot, deps, msg) => {
      await handleBalanceCommand(bot, deps, msg);
    })
  );
}
