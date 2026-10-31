import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerCallbackHandler } from "../src/handlers/callbackHandler.js";

function createBot() {
  const bot = new EventEmitter();
  bot.answers = [];
  bot.edits = [];
  bot.sent = [];

  bot.answerCallbackQuery = async (id, options) => {
    bot.answers.push({ id, options });
  };
  bot.editMessageText = async (text, form) => {
    bot.edits.push({ type: "text", text, form });
  };
  bot.editMessageReplyMarkup = async (replyMarkup, form) => {
    bot.edits.push({ type: "markup", replyMarkup, form });
  };
  bot.sendMessage = async (chatId, text, options) => {
    bot.sent.push({ chatId, text, options });
    return { message_id: 100 + bot.sent.length };
  };

  return bot;
}

function createDeps(initialState = {}) {
  const store = new Map(
    Object.entries(initialState).map(([id, value]) => [String(id), value])
  );

  return {
    config: { allowedUsers: ["1"] },
    logger: { info() {}, warn() {}, error() {} },
    sheets: {},
    state: {
      get: (id) => store.get(String(id)) || null,
      set: (id, value) => store.set(String(id), value),
      update: (id, value) => {
        store.set(String(id), {
          ...(store.get(String(id)) || {}),
          ...value,
        });
      },
      del: (id) => store.delete(String(id)),
    },
    store,
  };
}

async function emitCallback(bot, query) {
  const handler = bot.listeners("callback_query")[0];
  assert.equal(typeof handler, "function");
  await handler(query);
}

test("callback: навигация перерисовывает календарь", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, calendarMessageId: 10 },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q1",
    data: "cal:nav:2026-09",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.edits.length, 1);
  assert.match(bot.edits[0].text, /Сентябрь 2026/);
  assert.equal(bot.edits[0].form.message_id, 10);
  assert.equal(deps.store.get("1").step, "date");
});

test("callback: выбор дня переводит к сумме", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, calendarMessageId: 10 },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q2",
    data: "cal:day:2026-10-31",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  const state = deps.store.get("1");
  assert.equal(state.step, "amount");
  assert.equal(state.data.date, "31.10.2026");
  assert.match(bot.edits[0].text, /31\.10\.2026/);
  assert.match(bot.sent[0].text, /Введите сумму/);
  assert.ok(
    Array.isArray(bot.sent[0].options.reply_markup.inline_keyboard)
  );
  assert.equal(bot.sent[0].options.reply_markup.force_reply, undefined);
  assert.equal(state.amountDraft, "");
  assert.ok(state.amountMessageId);
});

test("callback: устаревшая кнопка даёт alert и не меняет state", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "amount", data: { date: "31.10.2026" }, calendarMessageId: 10 },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q3",
    data: "cal:day:2026-10-31",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /устарела/);
  assert.equal(bot.edits.length, 0);
  assert.equal(deps.store.get("1").step, "amount");
});

test("callback: нет доступа", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, calendarMessageId: 10 },
  });
  deps.config.allowedUsers = ["2"];
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q4",
    data: "cal:nav:2026-09",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /Доступ запрещен/);
  assert.equal(bot.edits.length, 0);
});

test("callback: отмена очищает state и убирает клавиатуры", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      calendarMessageId: 10,
      amountMessageId: 11,
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q5",
    data: "v1:cancel",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.answers.length, 1);
  assert.equal(
    bot.edits.filter((edit) => edit.type === "markup").length,
    2
  );
  assert.ok(bot.sent.some((message) => /Операция отменена/.test(message.text)));
});

test("callback: ввод суммы кнопками и переключение знака", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      amountDraft: "",
      amountMessageId: 10,
      categories: ["Еда"],
      wallets: ["Наличные"],
    },
  });
  registerCallbackHandler(bot, deps);

  const send = (data) =>
    emitCallback(bot, {
      id: data,
      data,
      message: { chat: { id: 1 } },
      from: { id: 1 },
    });

  await send("v1:amt:d:5");
  await send("v1:amt:d:0");
  await send("v1:amt:d:0");
  await send("v1:amt:sep");
  await send("v1:amt:d:5");
  await send("v1:amt:sign");

  assert.equal(deps.store.get("1").amountDraft, "-500,5");
  assert.equal(deps.store.get("1").amountEditSeq, 6);
  assert.equal(bot.answers.length, 6);
  assert.ok(bot.edits.every((edit) => edit.type === "text"));
  assert.match(bot.edits.at(-1).text, /-500,5/);
});

test("callback: подтверждение отрицательной суммы", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      amountDraft: "-500,50",
      amountMessageId: 10,
      categories: ["Еда"],
      wallets: ["Наличные"],
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q6",
    data: "v1:amt:ok",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  const state = deps.store.get("1");
  assert.equal(state.step, "category");
  assert.equal(state.data.amount, -500.5);
  assert.match(bot.edits[0].text, /-500,5/);
  assert.match(bot.sent[0].text, /Выберите категорию/);
});

test("callback: пустая сумма не подтверждается", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      amountDraft: "",
      amountMessageId: 10,
      categories: ["Еда"],
      wallets: ["Наличные"],
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q7",
    data: "v1:amt:ok",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /отличную от нуля/);
  assert.equal(deps.store.get("1").step, "amount");
  assert.equal(bot.edits.length, 0);
  assert.equal(bot.sent.length, 0);
});

test("callback: устаревшая кнопка суммы", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "category",
      data: { date: "31.10.2026", amount: -500 },
      categories: ["Еда"],
      wallets: ["Наличные"],
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q8",
    data: "v1:amt:d:5",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /устарела/);
  assert.equal(deps.store.get("1").step, "category");
  assert.equal(bot.edits.length, 0);
});

test("callback: лимит дробной части", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      amountDraft: "1,23",
      amountMessageId: 10,
      categories: ["Еда"],
      wallets: ["Наличные"],
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q9",
    data: "v1:amt:d:4",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /лимит/);
  assert.equal(deps.store.get("1").amountDraft, "1,23");
  assert.equal(bot.edits.length, 0);
});
