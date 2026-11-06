import { MESSAGES } from "./messages.js";

// Утилиты для парсинга, форматирования и валидации.

/**
 * Парсит строку с датой в различных форматах и возвращает объект Date.
 * Поддерживает форматы:
 * - "ДД[разделитель]ММ[разделитель]ГГГГ" (полная дата)
 * - "ДД[разделитель]ММ" (текущий год)
 * - "ДД" (текущий месяц и год)
 *
 * Поддерживает разделители: точка, запятая, слеш, тире, пробел.
 * Для короткого формата года (две цифры) автоматически определяет век:
 * - 00-49 → 2000-2049
 * - 50-99 → 1950-1999
 *
 * Если строка невалидна — возвращает null.
 *
 * @param {string} text - строка с датой в одном из форматов:
 *   "13.09.2025", "13/09/2025", "13 09 2025", "13-09-2025",
 *   "13.09.25", "13.09", "13"
 * @returns {Date|null}
 */

export function parseDateDDMMYYYY(text, now = new Date()) {
  if (!text || typeof text !== "string") return null;

  // Получаем текущую дату для использования по умолчанию
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Заменяем все возможные разделители на точку для единообразной обработки
  const normalizedText = text
    .trim()
    .replace(/[,/\\\s-]/g, ".")
    .replace(/\.+/g, ".");

  const parts = normalizedText.split(".").filter((part) => part !== "");

  // Обрабатываем разные форматы ввода
  let day, month, year;

  if (parts.length === 1) {
    // Только день - используем текущий месяц и год
    day = parseInt(parts[0], 10);
    month = currentMonth;
    year = currentYear;
  } else if (parts.length === 2) {
    // День и месяц - используем текущий год
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = currentYear;
  } else if (parts.length === 3) {
    // Полная дата
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);

    // Обрабатываем короткий формат года (две цифры)
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
  } else {
    return null;
  }

  // Проверяем валидность компонентов даты
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  // Проверяем валидность даты
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

const MONTH_NAMES = new Map([
  ["январь", 1],
  ["января", 1],
  ["янв", 1],
  ["февраль", 2],
  ["февраля", 2],
  ["фев", 2],
  ["март", 3],
  ["марта", 3],
  ["мар", 3],
  ["апрель", 4],
  ["апреля", 4],
  ["апр", 4],
  ["май", 5],
  ["мая", 5],
  ["июнь", 6],
  ["июня", 6],
  ["июн", 6],
  ["июль", 7],
  ["июля", 7],
  ["июл", 7],
  ["август", 8],
  ["августа", 8],
  ["авг", 8],
  ["сентябрь", 9],
  ["сентября", 9],
  ["сен", 9],
  ["сент", 9],
  ["октябрь", 10],
  ["октября", 10],
  ["окт", 10],
  ["ноябрь", 11],
  ["ноября", 11],
  ["ноя", 11],
  ["декабрь", 12],
  ["декабря", 12],
  ["дек", 12],
]);

function monthFromToken(token) {
  const clean = token.toLowerCase().replace(/\./g, "");
  if (MONTH_NAMES.has(clean)) return MONTH_NAMES.get(clean);
  if (clean.length < 3) return null;

  for (const [name, month] of MONTH_NAMES) {
    if (name.startsWith(clean)) return month;
  }

  return null;
}

function createValidDate(day, month, year) {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Парсит естественное обозначение даты: "сегодня", "вчера", "9 октября",
 * "9-го октября 2025", "3.10", "03/10/2026", "2026-10-03".
 * Если год не указан — берётся год из `now`.
 * @param {string} text
 * @param {Date} [now]
 * @returns {Date|null}
 */
export function parseNaturalDate(text, now = new Date()) {
  if (!text || typeof text !== "string") return null;

  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ");

  if (!normalized) return null;

  if (normalized === "сегодня") return startOfDay(now);
  if (normalized === "вчера") return shiftDays(now, -1);
  if (normalized === "позавчера") return shiftDays(now, -2);

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    return createValidDate(
      Number(isoMatch[3]),
      Number(isoMatch[2]),
      Number(isoMatch[1])
    );
  }

  const dayMonthMatch =
    /^(\d{1,2})(?:\s*-?\s*го)?\s+([а-яё.]+)(?:\s+(\d{4}))?(?:\s+(?:года|г))?$/.exec(
      normalized
    );
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = monthFromToken(dayMonthMatch[2]);
    const year = dayMonthMatch[3]
      ? Number(dayMonthMatch[3])
      : now.getFullYear();

    return month ? createValidDate(day, month, year) : null;
  }

  const monthDayMatch =
    /^([а-яё.]+)\s+(\d{1,2})(?:\s+(\d{4}))?(?:\s+(?:года|г))?$/.exec(
      normalized
    );
  if (monthDayMatch) {
    const month = monthFromToken(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3]
      ? Number(monthDayMatch[3])
      : now.getFullYear();

    return month ? createValidDate(day, month, year) : null;
  }

  return parseDateDDMMYYYY(normalized, now);
}

/**
 * Форматирует Date в строку "ДД.ММ.ГГГГ" для отображения пользователю
 * и сохранения в таблице
 * @param {Date} date - объект Date
 * @returns {string} - отформатированная дата
 */
export function formatDateToDisplay(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Парсит сумму из строки — принимает запятую или точку, убирает пробелы.
 * Возвращает число (float) или NaN если не удалось распарсить.
 * @param {string|number} text
 * @returns {number}
 */
export function parseAmount(text) {
  if (text === null || text === undefined) return NaN;
  if (typeof text === "number") return text;
  const cleaned = String(text)
    .trim()
    .replace(/\s+/g, "")
    .replace(/−/g, "-")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

export function normalizeCategoryType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "доход" || normalized === "income") return "income";
  if (normalized === "расход" || normalized === "expense") return "expense";
  if (normalized === "перевод" || normalized === "transfer") return "transfer";
  return null;
}

// функция проверки доступа
export function checkAccess(chatId, config) {
  // если список пуст и надо разрешить всем, то раскоментировать строку ниже
  // if (config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(chatId.toString());
}

/**
 * Фабрика для создания middleware проверки доступа.
 * Создает и возвращает декоратор для обработчиков команд, который проверяет,
 * имеет ли пользователь право на доступ к боту, прежде чем выполнить основной обработчик.
 *
 * @param {TelegramBot} bot - Экземпляр Telegram бота для отправки сообщений
 * @param {Object} deps - Зависимости, содержащие конфигурацию и логгер
 * @param {Object} deps.config - Конфигурация приложения с настройками доступа
 * @param {Object} deps.logger - Логгер для записи событий
 *
 * @returns {Function} Декоратор функции-обработчика, который:
 *   - Проверяет ID чата пользователя против списка разрешенных пользователей
 *   - Если доступ запрещен: логирует предупреждение и отправляет сообщение об отказе
 *   - Если доступ разрешен: выполняет переданный обработчик команды
 *
 * @example
 * // Создание middleware с доступом
 * const withAccess = createAccessMiddleware(bot, deps);
 *
 * // Использование middleware для обработчика команды
 * bot.onText(/\/start/, withAccess(async (bot, deps, msg, match) => {
 *   // Логика обработки команды для авторизованных пользователей
 * }));
 */

export function createAccessMiddleware(bot, deps) {
  return (handler) => {
    return async (msg, match) => {
      const { config, logger } = deps;
      const chatId = msg.chat.id;

      if (!checkAccess(chatId, config)) {
        logger.warn(`Доступ запрещен для пользователя: ${chatId}`);
        await bot.sendMessage(chatId, MESSAGES.COMMON.ACCESS_DENIED);
        return;
      }

      return handler(bot, deps, msg, match);
    };
  };
}

export async function safeDeleteMessage(bot, logger, chatId, messageId) {
  if (!messageId) return;

  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (err) {
    logger?.warn?.(`Не удалось удалить сообщение: ${err.message}`);
  }
}

export function scheduleDeleteMessage(
  bot,
  logger,
  chatId,
  messageId,
  delayMs = 1000,
  schedule = setTimeout
) {
  if (!messageId) return;

  const timer = schedule(() => {
    void safeDeleteMessage(bot, logger, chatId, messageId);
  }, delayMs);
  timer?.unref?.();
}

export async function removeInlineKeyboard(bot, logger, chatId, messageId) {
  if (!messageId) return;

  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );
  } catch (err) {
    logger?.warn?.(`Не удалось убрать inline-клавиатуру: ${err.message}`);
  }
}
