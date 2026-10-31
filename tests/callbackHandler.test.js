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
  assert.equal(bot.sent[0].options.reply_markup.force_reply, true);
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

test("callback: отмена очищает state и убирает клавиатуру", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, calendarMessageId: 10 },
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
  assert.ok(bot.edits.some((edit) => edit.type === "markup"));
  assert.ok(bot.sent.some((message) => /Операция отменена/.test(message.text)));
});
