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
    // Отдельный debug — можно включать/отключать по переменной окружения в будущем
    if (process.env.DEBUG) {
      console.log(`${nowIso()} [DEBUG]`, ...args);
    }
  },
};
