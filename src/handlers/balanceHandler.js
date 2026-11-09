import { mainKeyboard, removeKeyboard } from "../keyboards.js";
import { createAccessMiddleware, safeDeleteMessage } from "../utils.js";
import { formatBalanceValue } from "../amount.js";
import { MESSAGES } from "../messages.js";

async function finishLoadingMessage(bot, logger, chatId, messageId, text) {
  if (messageId) {
    await safeDeleteMessage(bot, logger, chatId, messageId);
  }

  await bot.sendMessage(chatId, text, mainKeyboard);
}

// Добавляем экспорт функции для обработки команды /balance
export async function handleBalanceCommand(bot, deps, msg) {
  const { sheets, logger } = deps;

  const chatId = msg.chat.id;
  logger.info(`/balance от пользователя ${chatId}`);

  let loadingMessage = null;

  try {
    loadingMessage = await bot.sendMessage(
      chatId,
      MESSAGES.BALANCE.LOADING,
      removeKeyboard
    );
    const balances = await sheets.getBalances();

    if (!balances || balances.length === 0) {
      await finishLoadingMessage(
        bot,
        logger,
        chatId,
        loadingMessage?.message_id,
        MESSAGES.BALANCE.NO_DATA
      );
      return;
    }

    const text = balances
      .map(
        (b) =>
          `💰 ${b.name}: ${formatBalanceValue(b.balance)} ${b.currency}`
      )
      .join("\n");
    await finishLoadingMessage(
      bot,
      logger,
      chatId,
      loadingMessage?.message_id,
      MESSAGES.BALANCE.TITLE + text
    );
  } catch (err) {
    logger.error(
      `Ошибка при получении балансов для пользователя ${chatId}: ${err.message}`,
      err
    );
    await finishLoadingMessage(
      bot,
      logger,
      chatId,
      loadingMessage?.message_id,
      MESSAGES.BALANCE.ERROR
    );
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
