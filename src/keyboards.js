import {
  WEEKDAYS,
  buildMonthGrid,
  formatIsoDate,
  formatIsoMonth,
  shiftMonth,
} from "./calendar.js";

export const mainKeyboard = {
  reply_markup: {
    keyboard: [["Добавить транзакцию"], ["Показать баланс"]],
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
      one_time_keyboard: items.length === 0 ? false : true,
    },
  };
}

export function createForceReply() {
  return {
    reply_markup: {
      force_reply: true,
      selective: true,
    },
  };
}

export function createCalendarKeyboard(year, month) {
  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const navigationRow = [
    {
      text: "«",
      callback_data: `cal:nav:${formatIsoMonth(previous.year, previous.month)}`,
    },
    {
      text: "»",
      callback_data: `cal:nav:${formatIsoMonth(next.year, next.month)}`,
    },
  ];

  const weekdayRow = WEEKDAYS.map((label) => ({
    text: label,
    callback_data: "cal:noop",
  }));

  const weekRows = buildMonthGrid(year, month).map((week) =>
    week.map((cell) =>
      cell
        ? {
            text: String(cell.day),
            callback_data: `cal:day:${formatIsoDate(
              cell.year,
              cell.month,
              cell.day
            )}`,
          }
        : { text: " ", callback_data: "cal:noop" }
    )
  );

  return {
    reply_markup: {
      inline_keyboard: [
        navigationRow,
        weekdayRow,
        ...weekRows,
        [
          { text: "Сегодня", callback_data: "cal:today" },
          { text: "Вчера", callback_data: "cal:yesterday" },
        ],
        [{ text: "❌ Отмена", callback_data: "v1:cancel" }],
      ],
    },
  };
}
