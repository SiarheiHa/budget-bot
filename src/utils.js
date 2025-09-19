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

export function parseDateDDMMYYYY(text) {
  if (!text || typeof text !== "string") return null;

  // Получаем текущую дату для использования по умолчанию
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

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
  const cleaned = String(text).trim().replace(/\s+/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : NaN;
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
        await bot.sendMessage(chatId, "❌ Доступ запрещен");
        return;
      }

      return handler(bot, deps, msg, match);
    };
  };
}
