import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAddHandler } from "../src/handlers/addHandler.js";
import { MESSAGES } from "../src/messages.js";
import {
  createBot,
  createDeps,
  emitMessage,
  emitText,
} from "./helpers/fakes.js";

const DATE = "13.09.2025";

async function startAdd(bot) {
  return emitText(bot, "/add");
}

function editedMessageIds(bot) {
  return new Set(bot.edits.map((edit) => edit.form.message_id));
}

function lastReplyKeyboard(bot) {
  return bot.sent.at(-1).options.reply_markup.keyboard;
}

test("addHandler: /add создаёт одну карточку с календарём", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);

  const state = deps.store.get("1");
  assert.equal(state.step, "date");
  assert.deepEqual(state.categories, ["Еда", "Транспорт"]);
  assert.deepEqual(state.wallets, ["Наличные", "Карта"]);
  assert.equal(state.amountDraft, "");
  assert.ok(state.cardMessageId);
  assert.equal(state.calendarMessageId, undefined);
  assert.equal(state.amountMessageId, undefined);

  assert.equal(bot.sent.length, 1);
  const card = bot.sent[0];
  assert.match(card.text, /Новая транзакция/);
  assert.match(card.text, /Выберите дату операции/);
  assert.ok(Array.isArray(card.options.reply_markup.inline_keyboard));
});

test("addHandler: полный сценарий редактирует одну карточку и оставляет один итог", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  const cardId = deps.store.get("1").cardMessageId;

  const dateMessage = await emitMessage(bot, DATE);
  assert.equal(deps.store.get("1").step, "amount");
  assert.ok(
    bot.deleted.some((item) => item.messageId === dateMessage.message_id)
  );

  const amountMessage = await emitMessage(bot, "123,45");
  assert.equal(deps.store.get("1").step, "category");
  assert.ok(
    bot.deleted.some((item) => item.messageId === amountMessage.message_id)
  );
  assert.match(bot.sent.at(-1).text, /Выберите категорию/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Еда"],
    ["Транспорт"],
    ["❌ Отмена"],
  ]);

  const categoryMessage = await emitMessage(bot, "Еда");
  assert.equal(deps.store.get("1").step, "wallet");
  assert.ok(
    bot.deleted.some((item) => item.messageId === categoryMessage.message_id)
  );
  assert.match(bot.sent.at(-1).text, /Выберите кошелёк/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Наличные"],
    ["Карта"],
    ["❌ Отмена"],
  ]);

  const walletMessage = await emitMessage(bot, "Наличные");
  assert.equal(deps.store.get("1").step, "note");
  assert.ok(
    bot.deleted.some((item) => item.messageId === walletMessage.message_id)
  );
  assert.match(bot.sent.at(-1).text, /Введите примечание/);
  assert.equal(bot.sent.at(-1).options.reply_markup.force_reply, true);
  assert.equal(
    bot.sent.at(-1).options.reply_markup.input_field_placeholder,
    "Примечание или -"
  );
  assert.equal(bot.sent.at(-1).options.reply_markup.keyboard, undefined);

  const noteMessage = await emitMessage(bot, "-");

  assert.deepEqual(deps.transactions, [
    {
      date: DATE,
      amount: 123.45,
      category: "Еда",
      wallet: "Наличные",
      note: "",
    },
  ]);
  assert.equal(deps.store.has("1"), false);

  assert.deepEqual([...editedMessageIds(bot)], [cardId]);
  assert.ok(bot.deleted.some((item) => item.messageId === noteMessage.message_id));

  const finalMessage = bot.sent.at(-1);
  const intermediateCards = bot.sent.slice(0, -1);
  assert.equal(intermediateCards.length, 4);
  for (const message of intermediateCards) {
    assert.ok(
      bot.deleted.some(
        (item) => item.messageId === message.message.message_id
      )
    );
  }
  assert.ok(
    !bot.deleted.some(
      (item) => item.messageId === finalMessage.message.message_id
    )
  );
  assert.match(finalMessage.text, /Дата: 13\.09\.2025/);
  assert.match(finalMessage.text, /Сумма: 123,45/);
  assert.match(finalMessage.text, /Категория: Еда/);
  assert.match(finalMessage.text, /Кошелёк: Наличные/);
  assert.match(finalMessage.text, /Примечание: —/);
  assert.match(finalMessage.text, /Запись добавлена в таблицу/);
  assert.ok(finalMessage.options.reply_markup.keyboard);
});

test("addHandler: невалидная дата не двигает диалог и показывает ошибку в карточке", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  const trigger = await startAdd(bot, deps);
  const invalidMessage = await emitMessage(bot, "не дата");

  assert.equal(deps.store.get("1").step, "date");
  assert.match(bot.edits.at(-1).text, /Неверный формат даты/);
  assert.ok(bot.deleted.some((item) => item.messageId === trigger.message_id));
  assert.ok(
    !bot.deleted.some((item) => item.messageId === invalidMessage.message_id)
  );
});

test("addHandler: невалидная сумма не двигает диалог и показывает ошибку в карточке", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);

  await emitMessage(bot, "0");
  assert.equal(deps.store.get("1").step, "amount");
  assert.match(bot.edits.at(-1).text, /Неверная сумма/);

  await emitMessage(bot, "abc");
  assert.equal(deps.store.get("1").step, "amount");
  assert.match(bot.edits.at(-1).text, /Неверная сумма/);
});

test("addHandler: невалидные категория и кошелёк показывают ошибку в карточке", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  await emitMessage(bot, "100");

  await emitMessage(bot, "Не еда");
  assert.equal(deps.store.get("1").step, "category");
  assert.match(bot.sent.at(-1).text, /выберите категорию из предложенных/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Еда"],
    ["Транспорт"],
    ["❌ Отмена"],
  ]);

  await emitMessage(bot, "Еда");
  await emitMessage(bot, "Не кошелёк");
  assert.equal(deps.store.get("1").step, "wallet");
  assert.match(bot.sent.at(-1).text, /выберите кошелёк из предложенных/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Наличные"],
    ["Карта"],
    ["❌ Отмена"],
  ]);
});

test("addHandler: без активного state обычные сообщения игнорируются", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await emitMessage(bot, "просто текст");

  assert.equal(bot.sent.length, 0);
  assert.equal(deps.store.size, 0);
});

test("addHandler: команды и кнопки меню не ломают шаг", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  const before = bot.sent.length;

  await emitMessage(bot, "/cancel");
  await emitMessage(bot, "Добавить транзакцию");
  await emitMessage(bot, "Показать баланс");

  assert.equal(bot.sent.length, before);
  assert.equal(deps.store.get("1").step, "date");
});

test("addHandler: ошибка сохранения очищает state и возвращает меню", async () => {
  const bot = createBot();
  const deps = createDeps(
    {},
    {
      sheets: {
        appendTransaction: async () => {
          throw new Error("sheets down");
        },
      },
    }
  );
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  const cardId = deps.store.get("1").cardMessageId;
  await emitMessage(bot, DATE);
  await emitMessage(bot, "100");
  await emitMessage(bot, "Еда");
  await emitMessage(bot, "Наличные");
  await emitMessage(bot, "-");

  assert.equal(deps.store.has("1"), false);
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.ADD_TRANSACTION.ERROR)
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
  assert.ok(bot.deleted.some((item) => item.messageId === cardId));
});

test("addHandler: повторный /add удаляет старую карточку", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  const oldCardId = deps.store.get("1").cardMessageId;

  await startAdd(bot, deps);

  assert.ok(bot.deleted.some((item) => item.messageId === oldCardId));
  assert.notEqual(deps.store.get("1").cardMessageId, oldCardId);
});

test("addHandler: повторный /add удаляет старую AI-карточку", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      aiStep: "confirm",
      aiMessageId: 42,
      aiDraft: { amount: 100, category: "Еда", wallet: "Наличные" },
    },
  });
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);

  assert.ok(bot.deleted.some((item) => item.messageId === 42));
  assert.equal(editedMessageIds(bot).has(42), false);
  assert.equal(deps.store.get("1").step, "date");
});

const TRANSFER_CATEGORIES = [
  { name: "Еда", type: "expense" },
  { name: "Перевод", type: "transfer" },
];

function createTransferDeps(overrides = {}) {
  return createDeps(
    {},
    {
      ...overrides,
      sheets: {
        getCategories: async () => TRANSFER_CATEGORIES,
        ...(overrides.sheets || {}),
      },
    }
  );
}

test("addHandler: перевод создаёт две транзакции", async () => {
  const bot = createBot();
  const deps = createTransferDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  assert.deepEqual(deps.store.get("1").categoryTypes, {
    Еда: "expense",
    Перевод: "transfer",
  });

  await emitMessage(bot, DATE);
  await emitMessage(bot, "4,59");
  await emitMessage(bot, "Перевод");

  let state = deps.store.get("1");
  assert.equal(state.step, "transferFrom");
  assert.equal(state.data.amount, 4.59);
  assert.equal(state.data.transfer, true);
  assert.match(bot.sent.at(-1).text, /Выберите кошелёк, откуда перевести/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Наличные"],
    ["Карта"],
    ["❌ Отмена"],
  ]);

  await emitMessage(bot, "Наличные");

  state = deps.store.get("1");
  assert.equal(state.step, "transferTo");
  assert.match(bot.sent.at(-1).text, /Выберите кошелёк, куда перевести/);
  assert.deepEqual(lastReplyKeyboard(bot), [["Карта"], ["❌ Отмена"]]);

  await emitMessage(bot, "Карта");
  assert.equal(deps.store.get("1").step, "note");

  await emitMessage(bot, "-");

  assert.deepEqual(deps.transfers, [
    {
      date: DATE,
      amount: 4.59,
      category: "Перевод",
      fromWallet: "Наличные",
      toWallet: "Карта",
      note: "",
    },
  ]);
  assert.deepEqual(deps.transactions, []);
  assert.equal(deps.store.has("1"), false);

  const finalMessage = bot.sent.at(-1);
  assert.match(finalMessage.text, /Откуда: Наличные/);
  assert.match(finalMessage.text, /Куда: Карта/);
  assert.match(finalMessage.text, /Сумма: 4,59/);
  assert.match(finalMessage.text, /Запись добавлена в таблицу/);
});

test("addHandler: отрицательная сумма перевода нормализуется", async () => {
  const bot = createBot();
  const deps = createTransferDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  await emitMessage(bot, "-4,59");
  await emitMessage(bot, "Перевод");

  assert.equal(deps.store.get("1").data.amount, 4.59);

  await emitMessage(bot, "Наличные");
  await emitMessage(bot, "Карта");
  await emitMessage(bot, "-");

  assert.equal(deps.transfers[0].amount, 4.59);
});

test("addHandler: нельзя перевести на тот же кошелёк", async () => {
  const bot = createBot();
  const deps = createTransferDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  await emitMessage(bot, "4,59");
  await emitMessage(bot, "Перевод");
  await emitMessage(bot, "Наличные");

  await emitMessage(bot, "Наличные");

  const state = deps.store.get("1");
  assert.equal(state.step, "transferTo");
  assert.match(bot.sent.at(-1).text, /тот же кошелёк/);
  assert.deepEqual(lastReplyKeyboard(bot), [["Карта"], ["❌ Отмена"]]);
  assert.deepEqual(deps.transfers, []);
});

test("addHandler: при одном кошельке перевод отклоняется", async () => {
  const bot = createBot();
  const deps = createTransferDeps({
    sheets: { getWallets: async () => ["Наличные"] },
  });
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  await emitMessage(bot, "4,59");
  await emitMessage(bot, "Перевод");

  const state = deps.store.get("1");
  assert.equal(state.step, "category");
  assert.match(bot.sent.at(-1).text, /минимум два кошелька/);
  assert.deepEqual(lastReplyKeyboard(bot), [
    ["Еда"],
    ["Перевод"],
    ["❌ Отмена"],
  ]);
  assert.deepEqual(deps.transfers, []);
});

test("addHandler: ошибка загрузки справочников показывает INIT_ERROR", async () => {
  const bot = createBot();
  const deps = createDeps(
    {},
    {
      sheets: {
        getCategories: async () => {
          throw new Error("sheets down");
        },
      },
    }
  );
  registerAddHandler(bot, deps);

  const trigger = await emitText(bot, "/add");

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.sent.length, 1);
  assert.ok(
    bot.sent.some(
      (message) => message.text === MESSAGES.ADD_TRANSACTION.INIT_ERROR
    )
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
  assert.ok(bot.deleted.some((item) => item.messageId === trigger.message_id));
});
