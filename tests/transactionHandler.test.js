import { test } from "node:test";
import assert from "node:assert/strict";
import { registerCallbackHandler } from "../src/handlers/callbackHandler.js";
import { registerTransactionHandler } from "../src/handlers/transactionHandler.js";
import { MESSAGES } from "../src/messages.js";
import {
  createBot,
  createDeps,
  emitMessage,
  emitText,
} from "./helpers/fakes.js";

const TRANSACTION = {
  row: 12,
  date: "09.11.2026",
  amount: 250,
  category: "Еда",
  wallet: "Наличные",
  note: "кофе",
};

function setup(options = {}) {
  const bot = createBot();
  const deletedRows = [];
  const updates = [];
  const transaction =
    "transaction" in options ? options.transaction : TRANSACTION;
  const deps = createDeps(options.state || {}, {
    sheets: {
      getLastTransaction: async () => transaction,
      getTransaction: async (row) =>
        transaction === null ? null : { ...transaction, row },
      getCategories: async () =>
        options.categories || [
          { name: "Еда", type: "expense" },
          { name: "Перевод", type: "transfer" },
        ],
      deleteTransaction: async (row) => {
        deletedRows.push(row);
      },
      updateTransaction: async (row, data) => {
        updates.push({ row, data });
      },
      getNeighborTransaction: async (row, direction) =>
        options.neighbor ? options.neighbor(row, direction) : null,
      ...(options.sheets || {}),
    },
  });

  registerTransactionHandler(bot, deps);
  registerCallbackHandler(bot, deps);

  return { bot, deps, deletedRows, updates };
}

async function emitCallback(bot, data, messageId = 55) {
  const handler = bot.listeners("callback_query")[0];
  assert.equal(typeof handler, "function");

  await handler({
    id: "q1",
    data,
    message: {
      message_id: messageId,
      chat: { id: 1 },
    },
    from: { id: 1 },
  });
}

function keyboardCallbacks(bot) {
  const message = bot.sent.at(-1);
  return message.options.reply_markup.inline_keyboard
    .flat()
    .map((button) => button.callback_data);
}

test("transactionHandler: /last показывает последнюю транзакцию", async () => {
  const { bot } = setup();

  await emitText(bot, "/last");

  assert.equal(bot.sent.length, 1);
  const message = bot.sent[0];
  assert.match(message.text, /Транзакция 12/);
  assert.match(message.text, /09\.11\.2026/);
  assert.match(message.text, /250/);
  assert.match(message.text, /Еда/);
  assert.ok(keyboardCallbacks(bot).includes("tx:delete:12"));
  assert.ok(keyboardCallbacks(bot).includes("tx:close:12"));
});

test("transactionHandler: кнопка меню открывает карточку", async () => {
  const { bot } = setup();

  await emitText(bot, "Последняя транзакция");

  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /Транзакция 12/);
});

test("transactionHandler: пустая таблица показывает сообщение", async () => {
  const { bot } = setup({ transaction: null });

  await emitText(bot, "/last");

  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].text, MESSAGES.TRANSACTION_VIEW.EMPTY);
  assert.deepEqual(
    bot.sent[0].options.reply_markup.keyboard,
    [[
      "Добавить транзакцию",
    ], ["Показать баланс"], ["Последняя транзакция"]]
  );
});

test("transactionHandler: активный диалог блокирует просмотр", async () => {
  let called = false;
  const { bot } = setup({
    state: { 1: { step: "date" } },
    sheets: {
      getLastTransaction: async () => {
        called = true;
        return TRANSACTION;
      },
    },
  });

  await emitText(bot, "/last");

  assert.equal(called, false);
  assert.equal(bot.sent[0].text, MESSAGES.TRANSACTION_VIEW.BUSY);
});

test("transactionHandler: перевод нельзя удалить", async () => {
  const { bot } = setup({
    transaction: { ...TRANSACTION, category: "Перевод" },
  });

  await emitText(bot, "/last");

  assert.match(
    bot.sent[0].text,
    /Редактирование и удаление переводов пока не поддерживается/
  );
  assert.deepEqual(keyboardCallbacks(bot), [
    "tx:prev:12",
    "tx:next:12",
    "tx:close:12",
  ]);
});

test("transactionHandler: удаление требует подтверждения", async () => {
  const { bot, deletedRows } = setup();
  const confirmId = 55;

  await emitCallback(bot, "tx:delete:12", confirmId);

  assert.equal(deletedRows.length, 0);
  const edit = bot.edits.at(-1);
  assert.match(edit.text, /Удалить эту транзакцию/);
  assert.equal(edit.form.message_id, confirmId);
  assert.deepEqual(
    edit.form.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    ["tx:confirm-delete:12", "tx:cancel-delete:12"]
  );

  await emitCallback(bot, "tx:confirm-delete:12", confirmId);

  assert.deepEqual(deletedRows, [12]);
  assert.equal(bot.edits.at(-1).text, MESSAGES.TRANSACTION_VIEW.DELETED);
  assert.match(bot.sent.at(-1).text, /Что дальше/);
});

test("transactionHandler: отмена удаления возвращает карточку", async () => {
  const { bot, deletedRows } = setup();

  await emitCallback(bot, "tx:cancel-delete:12", 55);

  assert.equal(deletedRows.length, 0);
  const edit = bot.edits.at(-1);
  assert.match(edit.text, /Транзакция 12/);
  assert.equal(edit.form.reply_markup.inline_keyboard.at(-1)[0].callback_data, "tx:close:12");
});

test("transactionHandler: закрытие удаляет карточку", async () => {
  const { bot } = setup();

  await emitCallback(bot, "tx:close:12", 77);

  assert.deepEqual(bot.deleted, [{ chatId: 1, messageId: 77 }]);
  assert.match(bot.sent.at(-1).text, /Что дальше/);
});

test("transactionHandler: устаревшая строка показывает ошибку", async () => {
  const { bot } = setup({ transaction: null });

  await emitCallback(bot, "tx:delete:12", 55);

  assert.equal(bot.deleted.length, 1);
  assert.deepEqual(bot.answers.at(-1).options, {
    text: MESSAGES.TRANSACTION_VIEW.NOT_FOUND,
    show_alert: true,
  });
});

test("transactionHandler: изменение суммы сохраняет и обновляет карточку", async () => {
  const { bot, deps, updates } = setup();

  await emitCallback(bot, "tx:edit:12", 55);

  assert.equal(deps.store.get("1").step, "tx-edit");
  assert.equal(deps.store.get("1").txField, null);
  assert.match(bot.edits.at(-1).text, /Что изменить/);

  await emitCallback(bot, "tx:edit-field:12:amount", 55);
  assert.equal(deps.store.get("1").txField, "amount");
  assert.equal(deps.store.get("1").txAmountDraft, "250");
  assert.match(bot.edits.at(-1).text, /Введите сумму/);
  assert.ok(
    bot.edits
      .at(-1)
      .form.reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === "tx:amt:ok")
  );

  await emitCallback(bot, "tx:amt:clear", 55);
  await emitCallback(bot, "tx:amt:d:3", 55);
  await emitCallback(bot, "tx:amt:d:0", 55);
  await emitCallback(bot, "tx:amt:d:0", 55);
  await emitCallback(bot, "tx:amt:ok", 55);

  assert.deepEqual(updates, [
    { row: 12, data: { ...TRANSACTION, amount: 300 } },
  ]);
  assert.equal(deps.store.has("1"), false);
  assert.match(bot.edits.at(-1).text, /✅ Изменено/);
  assert.match(bot.edits.at(-1).text, /300/);
  assert.ok(
    bot.edits
      .at(-1)
      .form.reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === "tx:close-edited:12")
  );
});

test("transactionHandler: изменённая карточка остаётся после закрытия", async () => {
  const { bot } = setup();

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-field:12:amount", 55);
  await emitCallback(bot, "tx:amt:clear", 55);
  await emitCallback(bot, "tx:amt:d:1", 55);
  await emitCallback(bot, "tx:amt:ok", 55);

  assert.match(bot.edits.at(-1).text, /✅ Изменено/);

  await emitCallback(bot, "tx:close-edited:12", 55);

  assert.equal(bot.deleted.length, 0);
  const markup = bot.edits.at(-1);
  assert.equal(markup.type, "markup");
  assert.deepEqual(markup.replyMarkup, { inline_keyboard: [] });
  assert.equal(markup.form.message_id, 55);
});

test("transactionHandler: неверная сумма оставляет режим редактирования", async () => {
  const { bot, deps, updates } = setup();

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-field:12:amount", 55);

  await emitMessage(bot, "abc");

  assert.equal(updates.length, 0);
  assert.equal(deps.store.get("1").txField, "amount");
  assert.match(bot.edits.at(-1).text, /Неверная сумма/);
});

test("transactionHandler: изменение даты идёт через календарь", async () => {
  const { bot, deps, updates } = setup();

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-field:12:date", 55);

  assert.equal(deps.store.get("1").txField, "date");
  assert.match(bot.edits.at(-1).text, /Ноябрь 2026/);
  assert.ok(
    bot.edits
      .at(-1)
      .form.reply_markup.inline_keyboard.flat()
      .some((button) => button.callback_data === "tx:cal:day:2026-11-10")
  );

  await emitCallback(bot, "tx:cal:day:2026-11-10", 55);

  assert.equal(updates[0].data.date, "10.11.2026");
  assert.match(bot.edits.at(-1).text, /10\.11\.2026/);
});

test("transactionHandler: '-' очищает примечание", async () => {
  const { bot, updates } = setup();

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-field:12:note", 55);

  await emitMessage(bot, "-");

  assert.equal(updates[0].data.note, "");
});

test("transactionHandler: категория выбирается inline-кнопкой", async () => {
  const { bot, deps, updates } = setup({
    categories: [
      { name: "Еда", type: "expense" },
      { name: "Транспорт", type: "expense" },
      { name: "Перевод", type: "transfer" },
    ],
  });

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-field:12:category", 55);

  assert.equal(deps.store.get("1").txField, "category");
  const callbacks = bot.edits
    .at(-1)
    .form.reply_markup.inline_keyboard.flat()
    .map((button) => button.callback_data);
  assert.deepEqual(callbacks.slice(0, 2), [
    "tx:edit-pick:12:category:0",
    "tx:edit-pick:12:category:1",
  ]);

  await emitCallback(bot, "tx:edit-pick:12:category:1", 55);

  assert.equal(updates[0].data.category, "Транспорт");
  assert.equal(deps.store.has("1"), false);
});

test("transactionHandler: отмена редактирования возвращает карточку", async () => {
  const { bot, deps } = setup();

  await emitCallback(bot, "tx:edit:12", 55);
  await emitCallback(bot, "tx:edit-cancel:12", 55);

  assert.equal(deps.store.has("1"), false);
  assert.match(bot.edits.at(-1).text, /Транзакция 12/);
});

test("transactionHandler: перевод нельзя редактировать", async () => {
  const { bot, deps } = setup({
    transaction: { ...TRANSACTION, category: "Перевод" },
  });

  await emitCallback(bot, "tx:edit:12", 55);

  assert.equal(deps.store.has("1"), false);
  assert.deepEqual(bot.answers.at(-1).options, {
    text: MESSAGES.TRANSACTION_VIEW.TRANSFER_LOCKED,
    show_alert: true,
  });
});

test("transactionHandler: удалённая строка не сохраняет правку", async () => {
  const { bot, deps, updates } = setup({ transaction: null });
  deps.state.set("1", {
    step: "tx-edit",
    txRow: 12,
    txField: "amount",
    cardMessageId: 55,
  });

  await emitMessage(bot, "300");

  assert.equal(updates.length, 0);
  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.sent.at(-1).text, MESSAGES.TRANSACTION_VIEW.NOT_FOUND);
});

test("transactionHandler: карточка показывает кнопки навигации", async () => {
  const { bot } = setup();

  await emitText(bot, "/last");

  const callbacks = keyboardCallbacks(bot);
  assert.ok(callbacks.includes("tx:prev:12"));
  assert.ok(callbacks.includes("tx:next:12"));
  assert.deepEqual(
    bot.sent
      .at(-1)
      .options.reply_markup.inline_keyboard[0].map((button) => button.text),
    ["⬅️ Предыдущая", "Следующая ➡️"]
  );
});

test("transactionHandler: предыдущая транзакция открывается в карточке", async () => {
  const { bot } = setup({
    neighbor: (row, direction) =>
      direction === "prev"
        ? { ...TRANSACTION, row: 11, date: "08.11.2026", note: "предыдущая" }
        : null,
  });

  await emitCallback(bot, "tx:prev:12", 55);

  const edit = bot.edits.at(-1);
  assert.match(edit.text, /08\.11\.2026/);
  assert.match(edit.text, /предыдущая/);
  assert.equal(edit.form.message_id, 55);
  assert.ok(
    edit.form.reply_markup.inline_keyboard
      .flat()
      .some((button) => button.callback_data === "tx:prev:11")
  );
});

test("transactionHandler: отсутствие следующей строки показывает alert", async () => {
  const { bot } = setup();

  await emitCallback(bot, "tx:next:12", 55);

  assert.deepEqual(bot.answers.at(-1).options, {
    text: MESSAGES.TRANSACTION_VIEW.NO_NEXT,
    show_alert: true,
  });
});
