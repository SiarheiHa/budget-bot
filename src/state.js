// Этот модуль управляет состояниями пользователей.
// Суть: когда пользователь вводит команду (/add), мы начинаем "диалог".
// Нужно хранить, на каком шаге он находится (ввод даты, суммы, категории и т.п.).

// Используем Map — это структура данных "ключ → значение"
// В качестве ключа берём userId, в значении будем хранить объект с текущим состоянием.
const userStates = new Map();

const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Установить состояние пользователя
 * @param {number} userId - ID пользователя Telegram
 * @param {object} state - объект с данными состояния
 */
export function setUserState(userId, state) {
  userStates.set(userId, {
    ...state,
    _ts: Date.now(),
  });
}

/**
 * Получить состояние пользователя
 * @param {number} userId - ID пользователя Telegram
 * @param {object} [opts] - опции
 * @param {object} [opts.bot] - экземпляр бота для уведомления
 * @param {number} [opts.chatId] - chatId для уведомления
 * @param {object} [opts.messages] - объект MESSAGES
 * @param {object} [opts.keyboards] - объект с клавиатурами
 * @returns {object|null} - объект состояния или null, если нет
 */
export function getUserState(userId, opts = {}) {
  const entry = userStates.get(userId);
  if (!entry) return null;

  const ts = entry._ts || 0;
  if (Date.now() - ts > STATE_TTL_MS) {
    userStates.delete(userId);

    // Отправляем уведомление пользователю при истечении сессии
    if (opts.bot && opts.chatId && opts.messages) {
      try {
        const { showMainKeyboard } = opts.keyboards || {};
        opts.bot
          .sendMessage(opts.chatId, opts.messages.COMMON.SESSION_EXPIRED)
          .then(() => {
            if (typeof showMainKeyboard === "function") {
              return showMainKeyboard(opts.bot, opts.chatId);
            }
          })
          .catch(() => {});
      } catch {
        // Игнорируем ошибки отправки уведомления
      }
    }

    return null;
  }

  return entry;
}

/**
 * Получить состояние без проверки TTL и без удаления.
 * Нужно обработчикам, которые решают, отдавать ли сообщение другому хендлеру.
 * @param {number} userId
 * @returns {object|null}
 */
export function peekUserState(userId) {
  return userStates.get(userId) || null;
}

/**
 * Проверить, истёк ли TTL у записи состояния.
 * @param {object|null} entry
 * @returns {boolean}
 */
export function isUserStateExpired(entry) {
  if (!entry) return true;
  return Date.now() - (entry._ts || 0) > STATE_TTL_MS;
}

/**
 * Очистить состояние пользователя (после завершения диалога)
 * @param {number} userId - ID пользователя Telegram
 */
export function clearUserState(userId) {
  userStates.delete(userId);
}

/**
 * Обновить состояние пользователя (частично, не затирая всё)
 * @param {number} userId
 * @param {object} newData - данные, которые нужно добавить/обновить
 */
export function updateUserState(userId, newData) {
  const current = userStates.get(userId) || {};
  userStates.set(userId, {
    ...current,
    ...newData,
    _ts: Date.now(),
  });
}
