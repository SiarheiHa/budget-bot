// Утилиты для парсинга, форматирования и валидации.
// Комментарии на русском — что делает каждая функция и зачем она нужна.

/**
 * Парсит строку в формате "ДД.ММ.ГГГГ" и возвращает объект Date.
 * Если строка невалидна — возвращает null.
 * @param {string} text - строка вида "13.09.2025"
 * @returns {Date|null}
 */
export function parseDateDDMMYYYY(text) {
  if (!text || typeof text !== "string") return null;
  const parts = text.trim().split(".");
  if (parts.length !== 3) return null;

  const dd = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const yyyy = parseInt(parts[2], 10);

  if (
    Number.isNaN(dd) ||
    Number.isNaN(mm) ||
    Number.isNaN(yyyy) ||
    yyyy < 1900 ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  const date = new Date(yyyy, mm - 1, dd);
  if (
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
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
 * Приводит Date к строке формата ISO "YYYY-MM-DD",
 * который удобно хранить в Google Sheets (и совместимо с формулами).
 * @param {Date|string} d - Date или строка (второе используется редко)
 * @returns {string} - "2025-09-13"
 */
export function formatDateToISO(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

/**
 * Форматирует число в денежный вид для вывода пользователю.
 * Пример: 1234.5 -> "1 234,50"
 * @param {number} n
 * @returns {string}
 */
export function formatCurrency(n) {
  if (typeof n !== "number" || isNaN(n)) return "0,00";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Простая валидация короткого текстового поля (примечание, категория и т.д.)
 * Обрезает пробелы и возвращает пустую строку, если input не валидный.
 * @param {string} s
 * @param {number} [maxLen=200]
 * @returns {string}
 */
export function sanitizeText(s, maxLen = 200) {
  if (!s && s !== 0) return "";
  let t = String(s).trim();
  if (t.length > maxLen) t = t.slice(0, maxLen);
  return t;
}

export const mainKeyboard = {
  reply_markup: {
    keyboard: [["Добавить транзакцию (/add)"], ["Показать баланс (/balance)"]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

export const removeKeyboard = {
  reply_markup: {
    remove_keyboard: true,
  },
};

export function showMainKeyboard(bot, chatId, text = "Выберите действие:") {
  return bot.sendMessage(chatId, text, mainKeyboard);
}
