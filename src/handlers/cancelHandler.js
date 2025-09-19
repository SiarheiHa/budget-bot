import { showMainKeyboard } from "../keyboards.js";
import { createAccessMiddleware } from "../utils.js";

export function registerCancelHandler(bot, deps) {
  const { state, logger } = deps;
  const withAccess = createAccessMiddleware(bot, deps);

  // Обработчик команды /cancel
  bot.onText(
    /^\/cancel$/,
    withAccess(async (msg) => {
      const chatId = msg.chat.id;
      logger.info(`/cancel от пользователя ${chatId}`);

      // Очищаем состояние
      state.del(chatId);

      await bot.sendMessage(chatId, "❌ Операция отменена.");
      await showMainKeyboard(bot, chatId);
    })
  );

  // Обработчик текста "Отмена"
  bot.onText(
    /❌ Отмена/,
    withAccess(async (msg) => {
      const chatId = msg.chat.id;
      logger.info(`Отмена операции от пользователя ${chatId}`);

      // Очищаем состояние
      state.del(chatId);

      await bot.sendMessage(chatId, "❌ Операция отменена.");
      await showMainKeyboard(bot, chatId);
    })
  );
}
