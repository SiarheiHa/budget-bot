import { mainKeyboard } from "../keyboards.js";
import { handleAddCommand } from "./addHandler.js";
import { handleBalanceCommand } from "./balanceHandler.js";
import { createAccessMiddleware } from "../utils.js";
import { MESSAGES } from "../messages.js";

export function registerStartHandler(bot, deps) {
  const { logger } = deps;
  const withAccess = createAccessMiddleware(bot, deps);

  // Обработчик команды /start
  bot.onText(
    /^\/start$/,
    withAccess(async (bot, deps, msg) => {
      const chatId = msg.chat.id;
      try {
        logger.info(`/start от пользователя ${chatId}`);

        await bot.sendMessage(chatId, MESSAGES.START.WELCOME, mainKeyboard);
      } catch (error) {
        logger.error(`Ошибка в обработчике /start: ${error.message}`, error);
        // Не отправляем сообщение об ошибке пользователю, чтобы не спамить
        // при проблемах с сетью или другими временными ошибками
      }
    })
  );

  // Обработчик для кнопки "Добавить транзакцию"
  bot.onText(
    /Добавить транзакцию/,
    withAccess(async (bot, deps, msg) => {
      const chatId = msg.chat.id;
      try {
        logger.info(`Меню: Добавить транзакцию от пользователя ${chatId}`);
        await handleAddCommand(bot, deps, msg);
      } catch (error) {
        logger.error(
          `Ошибка при добавлении транзакции: ${error.message}`,
          error
        );
        await bot.sendMessage(chatId, MESSAGES.TRANSACTION.ERROR);
      }
    })
  );

  // Обработчик для кнопки "Показать баланс"
  bot.onText(
    /Показать баланс/,
    withAccess(async (bot, deps, msg) => {
      const chatId = msg.chat.id;
      try {
        logger.info(`Меню: Показать баланс от пользователя ${chatId}`);
        await handleBalanceCommand(bot, deps, msg);
      } catch (error) {
        logger.error(`Ошибка при получении баланса: ${error.message}`, error);
        await bot.sendMessage(chatId, MESSAGES.BALANCE.ERROR);
      }
    })
  );
}
