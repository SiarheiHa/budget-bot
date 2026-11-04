import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { sheets } from "./sheets.js";
import { logger } from "./logger.js";
import { registerStartHandler } from "./handlers/startHandler.js";
import { registerBalanceHandler } from "./handlers/balanceHandler.js";
import { registerAddHandler } from "./handlers/addHandler.js";
import { registerCancelHandler } from "./handlers/cancelHandler.js";
import { registerCallbackHandler } from "./handlers/callbackHandler.js";
import { createAmountUiQueue } from "./amountUi.js";
import {
  setUserState,
  getUserState,
  clearUserState,
  updateUserState,
} from "./state.js";

// Создаём экземпляр бота
const bot = new TelegramBot(config.botToken, { polling: true });

bot.on("polling_error", (err) => {
  logger.error(`polling_error: ${err.message}`);
});

// Инициализируем зависимости

const state = {
  set: setUserState,
  get: getUserState,
  del: clearUserState,
  update: updateUserState,
};

const amountUi = createAmountUiQueue({
  leading: false,
  debounceMs: 1000,
});

// Объект с зависимостями для обработчиков
const deps = { sheets, state, config, logger, amountUi };

// Регистрируем все обработчики
function registerHandlers() {
  registerStartHandler(bot, deps);
  registerBalanceHandler(bot, deps);
  registerCancelHandler(bot, deps);
  registerCallbackHandler(bot, deps);
  registerAddHandler(bot, deps);
}

// Инициализация
try {
  registerHandlers();
  logger.info("Все обработчики успешно зарегистрированы");
} catch (error) {
  logger.error("Ошибка при регистрации обработчиков:", error);
  process.exit(1);
}

try {
  const me = await bot.getMe();
  const webhook = await bot.getWebHookInfo();
  logger.info(
    `Бот @${me.username} (id=${me.id}), pid=${process.pid}, webhook=${
      webhook.url || "none"
    }, pending=${webhook.pending_update_count}`
  );
} catch (err) {
  logger.warn(`Не удалось получить информацию о боте: ${err.message}`);
}

export default bot;
