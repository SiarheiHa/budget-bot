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

export function createCancelableKeyboard(items) {
  return {
    reply_markup: {
      keyboard: [...items.map((item) => [item]), ["❌ Отмена"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}
