// Минималистичный логгер — обёртка над console.
// Делает вывод с таймстампом и уровнем (INFO/WARN/ERROR).
// В будущем можно заменить на winston/пино для продакшн-логирования.

/**
 * Возвращает ISO-строку с текущим временем для логов.
 * Пример: "2025-09-13T12:34:56.789Z"
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Проверяет, включены ли debug-логи.
 * Переменные окружения — строки, поэтому "false" сам по себе truthy.
 * @param {string|undefined|null} value
 * @returns {boolean}
 */
export function isDebugEnabled(value = process.env.DEBUG) {
  if (value === undefined || value === null) return false;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "") return false;

  return !["0", "false", "no", "off"].includes(normalized);
}

export const logger = {
  info: (...args) => {
    console.log(`${nowIso()} [INFO]`, ...args);
  },
  warn: (...args) => {
    console.warn(`${nowIso()} [WARN]`, ...args);
  },
  error: (...args) => {
    console.error(`${nowIso()} [ERROR]`, ...args);
  },
  debug: (...args) => {
    if (isDebugEnabled()) {
      console.log(`${nowIso()} [DEBUG]`, ...args);
    }
  },
};
