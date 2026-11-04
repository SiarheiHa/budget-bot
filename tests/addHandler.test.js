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

test("addHandler: /add загружает данные и показывает календарь", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);

  const state = deps.store.get("1");
  assert.equal(state.step, "date");
  assert.deepEqual(state.categories, ["Еда", "Транспорт"]);
  assert.deepEqual(state.wallets, ["Наличные", "Карта"]);
  assert.ok(state.calendarMessageId);
  assert.match(bot.sent.at(-1).text, /Выберите дату операции/);
  assert.ok(Array.isArray(bot.sent.at(-1).options.reply_markup.inline_keyboard));
});

test("addHandler: полный сценарий сохраняет транзакцию", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  assert.equal(deps.store.get("1").step, "amount");

  await emitMessage(bot, "123,45");
  assert.equal(deps.store.get("1").step, "category");

  await emitMessage(bot, "Еда");
  assert.equal(deps.store.get("1").step, "wallet");

  await emitMessage(bot, "Наличные");
  assert.equal(deps.store.get("1").step, "note");

  await emitMessage(bot, "-");

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
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.ADD_TRANSACTION.SUCCESS)
  );
  assert.ok(
    bot.sent.at(-1).options.reply_markup.keyboard,
    "после успеха возвращается главное меню"
  );
});

test("addHandler: невалидная дата не двигает диалог", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, "не дата");

  assert.equal(deps.store.get("1").step, "date");
  assert.equal(bot.sent.at(-1).text, MESSAGES.ADD_TRANSACTION.DATE_INVALID);
});

test("addHandler: невалидная сумма не двигает диалог", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);

  await emitMessage(bot, "0");
  assert.equal(deps.store.get("1").step, "amount");
  assert.equal(bot.sent.at(-1).text, MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID);

  await emitMessage(bot, "abc");
  assert.equal(deps.store.get("1").step, "amount");
  assert.equal(bot.sent.at(-1).text, MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID);
});

test("addHandler: невалидная категория и кошелёк предлагают список", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerAddHandler(bot, deps);

  await startAdd(bot, deps);
  await emitMessage(bot, DATE);
  await emitMessage(bot, "100");

  await emitMessage(bot, "Не еда");
  assert.equal(deps.store.get("1").step, "category");
  assert.equal(
    bot.sent.at(-1).text,
    MESSAGES.ADD_TRANSACTION.CATEGORY_INVALID
  );

  await emitMessage(bot, "Еда");
  await emitMessage(bot, "Не кошелёк");
  assert.equal(deps.store.get("1").step, "wallet");
  assert.equal(bot.sent.at(-1).text, MESSAGES.ADD_TRANSACTION.WALLET_INVALID);
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
