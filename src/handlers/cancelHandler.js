// cancelHandler.js
import { showMainKeyboard } from "../utils.js";

export function registerCancelHandler(bot, { state, logger }) {
  // Обработчик команды /cancel
  bot.onText(/^\/cancel$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/cancel от пользователя ${chatId}`);

    // Очищаем состояние
    state.del(chatId);

    await bot.sendMessage(chatId, "❌ Операция отменена.");
    await showMainKeyboard(bot, chatId);
  });

  // Обработчик текста "Отмена"
  bot.onText(/❌ Отмена/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Отмена операции от пользователя ${chatId}`);

    // Очищаем состояние
    state.del(chatId);

    await bot.sendMessage(chatId, "❌ Операция отменена.");
    await showMainKeyboard(bot, chatId);
  });
}
