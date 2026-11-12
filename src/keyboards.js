import {
  WEEKDAYS,
  buildMonthGrid,
  formatIsoDate,
  formatIsoMonth,
  shiftMonth,
} from "./calendar.js";

export const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["Добавить транзакцию"],
      ["Показать баланс"],
      ["Последняя транзакция"],
    ],
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

export function createNoteForceReply() {
  return {
    reply_markup: {
      force_reply: true,
      input_field_placeholder: "Примечание или -",
    },
  };
}

export function createAmountKeyboard(options = {}) {
  const prefix = options.prefix || "v1:amt";
  const allowSign = options.allowSign !== false;
  const footer = options.footer || [];
  const digit = (value) => ({
    text: value,
    callback_data: `${prefix}:d:${value}`,
  });
  const digitRows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
  ].map((row) => row.map(digit));
  const utilityRow = [
    ...(allowSign ? [{ text: "±", callback_data: `${prefix}:sign` }] : []),
    { text: "Сброс", callback_data: `${prefix}:clear` },
    { text: "✅ Готово", callback_data: `${prefix}:ok` },
  ];

  return {
    reply_markup: {
      inline_keyboard: [
        ...digitRows,
        [
          { text: ",", callback_data: `${prefix}:sep` },
          digit("0"),
          { text: "⌫", callback_data: `${prefix}:back` },
        ],
        utilityRow,
        ...footer,
      ],
    },
  };
}

export function createAiConfirmKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Сохранить", callback_data: "ai:confirm" }],
        [
          { text: "✏️ Изменить", callback_data: "ai:edit" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    },
  };
}

export function createAiCardKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Сумма", callback_data: "ai:field:amount" },
          { text: "Дата", callback_data: "ai:field:date" },
        ],
        [
          { text: "Категория", callback_data: "ai:field:category" },
          { text: "Кошелёк", callback_data: "ai:field:wallet" },
        ],
        [{ text: "Примечание", callback_data: "ai:field:note" }],
        [
          { text: "✅ Сохранить", callback_data: "ai:confirm" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    },
  };
}

export function createAiPickKeyboard(field, items = []) {
  const rows = items.map((item, index) => [
    {
      text: item,
      callback_data: `ai:pick:${field}:${index}`,
    },
  ]);

  return {
    reply_markup: {
      inline_keyboard: [
        ...rows,
        [
          { text: "Назад", callback_data: "ai:back" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    },
  };
}

export function createAiNoteKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Назад", callback_data: "ai:back" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    },
  };
}

export function createCalendarKeyboard(year, month, options = {}) {
  const prefix = options.prefix || "cal";
  const footer = options.footer || [
    [{ text: "❌ Отмена", callback_data: "v1:cancel" }],
  ];
  const previous = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const navigationRow = [
    {
      text: "«",
      callback_data: `${prefix}:nav:${formatIsoMonth(
        previous.year,
        previous.month
      )}`,
    },
    {
      text: "»",
      callback_data: `${prefix}:nav:${formatIsoMonth(next.year, next.month)}`,
    },
  ];

  const weekdayRow = WEEKDAYS.map((label) => ({
    text: label,
    callback_data: `${prefix}:noop`,
  }));

  const weekRows = buildMonthGrid(year, month).map((week) =>
    week.map((cell) =>
      cell
        ? {
            text: String(cell.day),
            callback_data: `${prefix}:day:${formatIsoDate(
              cell.year,
              cell.month,
              cell.day
            )}`,
          }
        : { text: " ", callback_data: `${prefix}:noop` }
    )
  );

  return {
    reply_markup: {
      inline_keyboard: [
        navigationRow,
        weekdayRow,
        ...weekRows,
        [
          { text: "Сегодня", callback_data: `${prefix}:today` },
          { text: "Вчера", callback_data: `${prefix}:yesterday` },
        ],
        ...footer,
      ],
    },
  };
}

export function createTransactionKeyboard({
  row,
  canEdit = false,
  canDelete = true,
  nav = false,
  edited = false,
} = {}) {
  const rows = [];

  if (nav) {
    rows.push([
      {
        text: "⬅️ Предыдущая",
        callback_data: `tx:${edited ? "prev-edited" : "prev"}:${row}`,
      },
      {
        text: "Следующая ➡️",
        callback_data: `tx:${edited ? "next-edited" : "next"}:${row}`,
      },
    ]);
  }

  const actions = [];
  if (canEdit) {
    actions.push({ text: "✏️ Изменить", callback_data: `tx:edit:${row}` });
  }
  if (canDelete) {
    actions.push({ text: "🗑 Удалить", callback_data: `tx:delete:${row}` });
  }
  if (actions.length > 0) rows.push(actions);

  rows.push([
    {
      text: "❌ Закрыть",
      callback_data: `tx:${edited ? "close-edited" : "close"}:${row}`,
    },
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

export function createTransactionEditMenuKeyboard(row) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💰 Сумма", callback_data: `tx:edit-field:${row}:amount` },
          { text: "📅 Дата", callback_data: `tx:edit-field:${row}:date` },
        ],
        [
          {
            text: "📂 Категория",
            callback_data: `tx:edit-field:${row}:category`,
          },
          {
            text: "👛 Кошелёк",
            callback_data: `tx:edit-field:${row}:wallet`,
          },
        ],
        [
          {
            text: "📝 Примечание",
            callback_data: `tx:edit-field:${row}:note`,
          },
        ],
        [
          { text: "Назад", callback_data: `tx:view:${row}` },
          { text: "❌ Отмена", callback_data: `tx:edit-cancel:${row}` },
        ],
      ],
    },
  };
}

export function createTransactionEditPromptKeyboard(row) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Назад", callback_data: `tx:edit:${row}` },
          { text: "❌ Отмена", callback_data: `tx:edit-cancel:${row}` },
        ],
      ],
    },
  };
}

export function createTransactionEditPickKeyboard(row, field, items = []) {
  const rows = items.map((item, index) => [
    {
      text: item,
      callback_data: `tx:edit-pick:${row}:${field}:${index}`,
    },
  ]);

  return {
    reply_markup: {
      inline_keyboard: [
        ...rows,
        [
          { text: "Назад", callback_data: `tx:edit:${row}` },
          { text: "❌ Отмена", callback_data: `tx:edit-cancel:${row}` },
        ],
      ],
    },
  };
}

export function createTransactionDeleteKeyboard(row) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Удалить", callback_data: `tx:confirm-delete:${row}` },
          { text: "❌ Отмена", callback_data: `tx:cancel-delete:${row}` },
        ],
      ],
    },
  };
}
