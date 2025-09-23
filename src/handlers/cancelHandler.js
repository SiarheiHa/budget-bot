import { showMainKeyboard } from "../keyboards.js";
import { MESSAGES } from "../messages.js";

async function handleCancel(bot, deps, msg) {
  const { state, logger } = deps;
  const chatId = msg.chat.id;

  if (!state.get(chatId)) return;

  try {
    logger.info(`Отмена операции от пользователя ${chatId}`);
    state.del(chatId);

    await bot.sendMessage(chatId, MESSAGES.COMMON.CANCELLED);
    await showMainKeyboard(bot, chatId);
  } catch (error) {
    logger.error(
      `Ошибка при обработке отмены для пользователя ${chatId}: ${error.message}`,
      error
    );
  }
}

export function registerCancelHandler(bot, deps) {
  // Обработчик команды /cancel - без проверки доступа
  bot.onText(/^\/cancel$/, async (msg) => {
    await handleCancel(bot, deps, msg);
  });

  // Обработчик текста "Отмена" - без проверки доступа
  bot.onText(/❌ Отмена/, async (msg) => {
    await handleCancel(bot, deps, msg);
  });
}
