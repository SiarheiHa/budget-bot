// Этот модуль управляет состояниями пользователей.
// Суть: когда пользователь вводит команду (/add), мы начинаем "диалог".
// Нужно хранить, на каком шаге он находится (ввод даты, суммы, категории и т.п.).

// Используем Map — это структура данных "ключ → значение"
// В качестве ключа берём userId, в значении будем хранить объект с текущим состоянием.
const userStates = new Map();

/**
 * Установить состояние пользователя
 * @param {number} userId - ID пользователя Telegram
 * @param {object} state - объект с данными состояния
 */
export function setUserState(userId, state) {
  userStates.set(userId, state);
}

/**
 * Получить состояние пользователя
 * @param {number} userId - ID пользователя Telegram
 * @returns {object|null} - объект состояния или null, если нет
 */
export function getUserState(userId) {
  return userStates.get(userId) || null;
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
  userStates.set(userId, { ...current, ...newData });
}
