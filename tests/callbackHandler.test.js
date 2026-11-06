import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerCallbackHandler } from "../src/handlers/callbackHandler.js";
import { createAmountUiQueue } from "../src/amountUi.js";
import { MESSAGES } from "../src/messages.js";

function createBot() {
  const bot = new EventEmitter();
  bot.answers = [];
  bot.edits = [];
  bot.sent = [];
  bot.deleted = [];

  bot.answerCallbackQuery = async (id, options) => {
    bot.answers.push({ id, options });
  };
  bot.editMessageText = async (text, form) => {
    bot.edits.push({ type: "text", text, form });
  };
  bot.editMessageReplyMarkup = async (replyMarkup, form) => {
    bot.edits.push({ type: "markup", replyMarkup, form });
  };
  bot.deleteMessage = async (chatId, messageId) => {
    bot.deleted.push({ chatId, messageId });
  };
  bot.sendMessage = async (chatId, text, options) => {
    const message = {
      message_id: 100 + bot.sent.length,
      chat: { id: chatId },
      text,
    };
    bot.sent.push({ chatId, text, options, message });
    return message;
  };

  return bot;
}

function createDeps(initialState = {}) {
  const store = new Map(
    Object.entries(initialState).map(([id, value]) => [String(id), value])
  );

  return {
    config: { allowedUsers: ["1"] },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    sheets: {},
    amountUi: createAmountUiQueue({ minIntervalMs: 0 }),
    schedule: (fn) => fn(),
    cancelMessageTtlMs: 0,
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

async function emitCallback(bot, deps, data, options = {}) {
  const handler = bot.listeners("callback_query")[0];
  assert.equal(typeof handler, "function");

  const current = deps.store.get("1");
  await handler({
    id: options.id ?? data,
    data,
    message: {
      message_id: options.messageId ?? current?.cardMessageId,
      chat: { id: 1 },
    },
    from: { id: 1 },
  });
}

function amountState(overrides = {}) {
  return {
    step: "amount",
    data: { date: "31.10.2026" },
    amountDraft: "",
    cardMessageId: 10,
    categories: ["Еда", "Транспорт"],
    wallets: ["Наличные", "Карта"],
    ...overrides,
  };
}

test("callback: навигация перерисовывает карточку с календарём", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, cardMessageId: 10 },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "cal:nav:2026-09");

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.edits.length, 1);
  assert.match(bot.edits[0].text, /Сентябрь 2026/);
  assert.equal(bot.edits[0].form.message_id, 10);
  assert.equal(deps.store.get("1").step, "date");
});

test("callback: выбор дня переводит к сумме в той же карточке", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, cardMessageId: 10 },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "cal:day:2026-10-31");

  const state = deps.store.get("1");
  assert.equal(state.step, "amount");
  assert.equal(state.data.date, "31.10.2026");
  assert.equal(state.amountDraft, "");
  assert.equal(state.cardMessageId, 10);

  assert.equal(bot.edits.length, 1);
  assert.equal(bot.edits[0].form.message_id, 10);
  assert.match(bot.edits[0].text, /31\.10\.2026/);
  assert.match(bot.edits[0].text, /Введите сумму/);
  assert.ok(Array.isArray(bot.edits[0].form.reply_markup.inline_keyboard));
  assert.equal(bot.sent.length, 0);
});

test("callback: устаревшая кнопка даты даёт alert и не меняет state", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: {
      step: "amount",
      data: { date: "31.10.2026" },
      cardMessageId: 10,
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "cal:day:2026-10-31");

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /устарела/);
  assert.equal(bot.edits.length, 0);
  assert.equal(deps.store.get("1").step, "amount");
});

test("callback: нет доступа", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: { step: "date", data: {}, cardMessageId: 10 },
  });
  deps.config.allowedUsers = ["2"];
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "cal:nav:2026-09");

  assert.equal(bot.answers.length, 1);
  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /Доступ запрещен/);
  assert.equal(bot.edits.length, 0);
});

test("callback: отмена удаляет карточку и оставляет одно сообщение", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: amountState({ cardMessageId: 10 }),
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "v1:cancel");

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.answers.length, 1);
  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].text, MESSAGES.COMMON.CANCELLED);
  assert.ok(bot.sent[0].options.reply_markup.keyboard);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === bot.sent[0].message.message_id
    )
  );
});

test("callback: ввод суммы кнопками и переключение знака", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: amountState() });
  registerCallbackHandler(bot, deps);

  const send = (data) => emitCallback(bot, deps, data);

  await send("v1:amt:d:5");
  await send("v1:amt:d:0");
  await send("v1:amt:d:0");
  await send("v1:amt:sep");
  await send("v1:amt:d:5");
  await send("v1:amt:sign");
  await deps.amountUi.whenIdle("1");

  assert.equal(deps.store.get("1").amountDraft, "-500,5");
  assert.equal(bot.answers.length, 6);
  assert.ok(bot.edits.every((edit) => edit.type === "text"));
  assert.ok(bot.edits.every((edit) => edit.form.message_id === 10));
  assert.match(bot.edits.at(-1).text, /-500,5/);
});

test("callback: подтверждение отрицательной суммы переводит к категории", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: amountState({ amountDraft: "-500,50" }),
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "v1:amt:ok");

  const state = deps.store.get("1");
  assert.equal(state.step, "category");
  assert.equal(state.data.amount, -500.5);
  assert.equal(state.amountDraft, "");

  const card = bot.sent.at(-1);
  assert.match(card.text, /-500,5/);
  assert.match(card.text, /Выберите категорию/);
  assert.deepEqual(card.options.reply_markup.keyboard, [
    ["Еда"],
    ["Транспорт"],
    ["❌ Отмена"],
  ]);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
});

test("callback: пустая сумма не подтверждается", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: amountState() });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "v1:amt:ok");

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /отличную от нуля/);
  assert.equal(deps.store.get("1").step, "amount");
  assert.equal(bot.edits.length, 0);
  assert.equal(bot.sent.length, 0);
});

test("callback: устаревшая кнопка суммы", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: amountState({
      step: "category",
      data: { date: "31.10.2026", amount: -500 },
      amountDraft: undefined,
    }),
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "v1:amt:d:5");

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /устарела/);
  assert.equal(deps.store.get("1").step, "category");
  assert.equal(bot.edits.length, 0);
});

test("callback: лимит дробной части", async () => {
  const bot = createBot();
  const deps = createDeps({
    1: amountState({ amountDraft: "1,23" }),
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, deps, "v1:amt:d:4");

  assert.equal(bot.answers[0].options.show_alert, true);
  assert.match(bot.answers[0].options.text, /лимит/);
  assert.equal(deps.store.get("1").amountDraft, "1,23");
  assert.equal(bot.edits.length, 0);
});

test("callback: одновременные нажатия не теряют цифры", async () => {
  const bot = createBot();
  let releaseAnswers;
  const answersGate = new Promise((resolve) => {
    releaseAnswers = resolve;
  });
  bot.answerCallbackQuery = async (id, options) => {
    bot.answers.push({ id, options });
    await answersGate;
  };

  const deps = createDeps({ 1: amountState() });
  registerCallbackHandler(bot, deps);

  const first = emitCallback(bot, deps, "v1:amt:d:1", { id: "q1" });
  const second = emitCallback(bot, deps, "v1:amt:d:2", { id: "q2" });

  releaseAnswers();
  await Promise.all([first, second]);
  await deps.amountUi.whenIdle("1");

  assert.equal(deps.store.get("1").amountDraft, "12");
  assert.match(bot.edits.at(-1).text, /12/);
});

test("callback: Готово во время in-flight переводит к категории", async () => {
  const bot = createBot();
  const originalEdit = bot.editMessageText;
  let releaseEdit;
  const editGate = new Promise((resolve) => {
    releaseEdit = resolve;
  });
  let firstEdit = true;
  bot.editMessageText = async (text, form) => {
    if (firstEdit) {
      firstEdit = false;
      await editGate;
    }
    return originalEdit(text, form);
  };

  const deps = createDeps({ 1: amountState() });
  registerCallbackHandler(bot, deps);

  const send = (data) => emitCallback(bot, deps, data);

  await send("v1:amt:d:1");
  const confirm = send("v1:amt:ok");

  releaseEdit();
  await confirm;
  await deps.amountUi.whenIdle("1");

  const state = deps.store.get("1");
  assert.equal(state.step, "category");
  assert.equal(state.data.amount, 1);

  const card = bot.sent.at(-1);
  assert.match(card.text, /Сумма: 1/);
  assert.match(card.text, /Выберите категорию/);
  assert.deepEqual(card.options.reply_markup.keyboard, [
    ["Еда"],
    ["Транспорт"],
    ["❌ Отмена"],
  ]);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
});

test("callback: отмена во время in-flight удаляет карточку", async () => {
  const bot = createBot();
  const originalEdit = bot.editMessageText;
  let releaseEdit;
  const editGate = new Promise((resolve) => {
    releaseEdit = resolve;
  });
  let firstEdit = true;
  bot.editMessageText = async (text, form) => {
    if (firstEdit) {
      firstEdit = false;
      await editGate;
    }
    return originalEdit(text, form);
  };

  const deps = createDeps({ 1: amountState() });
  registerCallbackHandler(bot, deps);

  const send = (data) => emitCallback(bot, deps, data);

  await send("v1:amt:d:1");
  const cancel = send("v1:cancel");

  releaseEdit();
  await cancel;
  await deps.amountUi.whenIdle("1");

  assert.equal(deps.store.has("1"), false);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
  const cancelled = bot.sent.find(
    (message) => message.text === MESSAGES.COMMON.CANCELLED
  );
  assert.ok(cancelled);
  assert.ok(
    bot.deleted.some((item) => item.messageId === cancelled.message.message_id)
  );
});
