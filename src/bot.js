import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { sheets } from "./sheets.js";
import { logger } from "./logger.js";
import { registerStartHandler } from "./handlers/startHandler.js";
import { registerBalanceHandler } from "./handlers/balanceHandler.js";
import { registerAddHandler } from "./handlers/addHandler.js";
import { registerCancelHandler } from "./handlers/cancelHandler.js";
import {
  setUserState,
  getUserState,
  clearUserState,
  updateUserState,
} from "./state.js";

// Создаём экземпляр бота
const bot = new TelegramBot(config.botToken, { polling: true });

// Инициализируем зависимости

const state = {
  set: setUserState,
  get: getUserState,
  del: clearUserState,
  update: updateUserState,
};

// Объект с зависимостями для обработчиков
const deps = { sheets, state, config, logger };

// Регистрируем все обработчики
function registerHandlers() {
  registerStartHandler(bot, deps);
  registerBalanceHandler(bot, deps);
  registerCancelHandler(bot, deps);
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

export default bot;
