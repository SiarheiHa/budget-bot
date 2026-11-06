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

async function startAdd(bot, deps) {
  await emitText(bot, "/add");
  return deps.store.get("1");
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
  assert.deepEqual(lastReplyKeyboard(bot), [["❌ Отмена"]]);

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

  await startAdd(bot, deps);
  await emitMessage(bot, "не дата");

  assert.equal(deps.store.get("1").step, "date");
  assert.match(bot.edits.at(-1).text, /Неверный формат даты/);
  assert.equal(bot.deleted.length, 0);
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

  await emitText(bot, "/add");

  assert.equal(deps.store.has("1"), false);
  assert.ok(
    bot.sent.some(
      (message) => message.text === MESSAGES.ADD_TRANSACTION.INIT_ERROR
    )
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
});
