import { mainKeyboard } from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import { safeDeleteMessage, scheduleDeleteMessage } from "../utils.js";

const CANCEL_MESSAGE_TTL_MS = 1000;

export async function handleCancel(bot, deps, msg) {
  const { state, logger, amountUi } = deps;
  const chatId = msg.chat.id;

  const currentState = state.get(chatId);
  if (!currentState) return;

  try {
    logger.info(`Отмена операции от пользователя ${chatId}`);
    state.del(chatId);
    if (amountUi) {
      await amountUi.abort(chatId);
    }

    const messageIds = new Set(
      [
        currentState.cardMessageId,
        currentState.aiMessageId,
        currentState.calendarMessageId,
        currentState.amountMessageId,
        msg.message_id,
      ].filter(Boolean)
    );

    for (const messageId of messageIds) {
      await safeDeleteMessage(bot, logger, chatId, messageId);
    }

    const cancelled = await bot.sendMessage(
      chatId,
      MESSAGES.COMMON.CANCELLED,
      mainKeyboard
    );

    scheduleDeleteMessage(
      bot,
      logger,
      chatId,
      cancelled.message_id,
      deps.cancelMessageTtlMs ?? CANCEL_MESSAGE_TTL_MS,
      deps.schedule
    );
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
