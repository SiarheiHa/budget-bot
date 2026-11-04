import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAiHandler } from "../src/handlers/aiHandler.js";
import { registerCallbackHandler } from "../src/handlers/callbackHandler.js";
import { MESSAGES } from "../src/messages.js";
import { createBot, createDeps, emitMessage } from "./helpers/fakes.js";

const DATE = new Date(2026, 10, 4); // Nov 4 2026

const DRAFT = {
  type: "expense",
  amount: 250,
  category: "Еда",
  wallet: "Наличные",
  date: DATE,
  dateText: null,
  note: "кофе",
};

const AI_CONFIG = { aiParsingEnabled: true };

function aiResult(draft = DRAFT) {
  return { ok: true, draft };
}

function setup({ config, ai, sheets, initialState } = {}) {
  const bot = createBot();
  const deps = createDeps(initialState, {
    config: { ...AI_CONFIG, ...(config || {}) },
    ai: ai || { parse: async () => aiResult() },
    ...(sheets ? { sheets } : {}),
  });
  registerAiHandler(bot, deps);
  return { bot, deps };
}

async function emitCallback(bot, query) {
  const handler = bot.listeners("callback_query")[0];
  assert.equal(typeof handler, "function");
  await handler(query);
}

test("aiHandler: свободный текст создаёт черновик и сводку", async () => {
  const calls = [];
  const { bot, deps } = setup({
    ai: {
      parse: async (text, options) => {
        calls.push({ text, options });
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "кофе 250");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "кофе 250");
  assert.deepEqual(calls[0].options.categories, ["Еда", "Транспорт"]);
  assert.deepEqual(calls[0].options.wallets, ["Наличные", "Карта"]);
  assert.equal(bot.chatActions[0].action, "typing");

  const state = deps.store.get("1");
  assert.equal(state.aiStep, "confirm");
  assert.deepEqual(state.aiDraft, DRAFT);
  assert.ok(state.aiMessageId);

  const summary = bot.sent.at(-1);
  assert.match(summary.text, /Проверьте данные/);
  assert.match(summary.text, /250/);
  assert.match(summary.text, /04.11.2026/);
  assert.ok(summary.options.reply_markup.inline_keyboard);
});

test("aiHandler: неизвестные категория и кошелёк запрашиваются по шагам", async () => {
  const { bot, deps } = setup({
    ai: {
      parse: async () =>
        aiResult({ ...DRAFT, category: null, wallet: null }),
    },
  });

  await emitMessage(bot, "кофе 250");
  assert.equal(deps.store.get("1").aiStep, "category");
  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.SELECT_CATEGORY);

  await emitMessage(bot, "Не еда");
  assert.equal(deps.store.get("1").aiStep, "category");
  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.SELECT_CATEGORY);

  await emitMessage(bot, "Еда");
  assert.equal(deps.store.get("1").aiStep, "wallet");
  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.SELECT_WALLET);

  await emitMessage(bot, "Карта");
  const state = deps.store.get("1");
  assert.equal(state.aiStep, "confirm");
  assert.equal(state.aiDraft.category, "Еда");
  assert.equal(state.aiDraft.wallet, "Карта");
});

test("aiHandler: не транзакция даёт подсказку", async () => {
  const { bot } = setup({
    ai: { parse: async () => ({ ok: false, reason: "not_transaction" }) },
  });

  await emitMessage(bot, "привет");

  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.NOT_RECOGNIZED);
});

test("aiHandler: ошибка AI даёт понятное сообщение", async () => {
  const { bot } = setup({
    ai: { parse: async () => ({ ok: false, reason: "timeout" }) },
  });

  await emitMessage(bot, "кофе 250");

  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.ERROR);
});

test("aiHandler: не вмешивается в активный диалог /add", async () => {
  let parsed = false;
  const { bot } = setup({
    initialState: { 1: { step: "date", data: {} } },
    ai: {
      parse: async () => {
        parsed = true;
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "кофе 250");

  assert.equal(parsed, false);
  assert.equal(bot.sent.length, 0);
});

test("aiHandler: команды, меню и отмена игнорируются", async () => {
  let parsed = false;
  const { bot } = setup({
    ai: {
      parse: async () => {
        parsed = true;
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "/add");
  await emitMessage(bot, "Добавить транзакцию");
  await emitMessage(bot, "Показать баланс");
  await emitMessage(bot, "❌ Отмена");

  assert.equal(parsed, false);
  assert.equal(bot.sent.length, 0);
  assert.equal(bot.chatActions.length, 0);
});

test("aiHandler: недоступный пользователь игнорируется", async () => {
  let parsed = false;
  const { bot } = setup({
    config: { allowedUsers: ["2"] },
    ai: {
      parse: async () => {
        parsed = true;
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "кофе 250");

  assert.equal(parsed, false);
  assert.equal(bot.sent.length, 0);
});

test("aiHandler: пока запрос в полёте, второй текст не парсится", async () => {
  let resolveParse;
  let calls = 0;
  const pending = new Promise((resolve) => {
    resolveParse = resolve;
  });

  const { bot } = setup({
    ai: {
      parse: async () => {
        calls += 1;
        return pending;
      },
    },
  });

  const first = emitMessage(bot, "кофе 250");
  await emitMessage(bot, "чай 100");
  resolveParse(aiResult());
  await first;

  assert.equal(calls, 1);
});

test("aiHandler: пока черновик не подтверждён, новый текст не парсится", async () => {
  let parsed = false;
  const { bot, deps } = setup({
    ai: {
      parse: async () => {
        parsed = true;
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "кофе 250");
  parsed = false;

  await emitMessage(bot, "чай 100");

  assert.equal(parsed, false);
  assert.equal(bot.sent.at(-1).text, MESSAGES.AI.PENDING_CONFIRMATION);
  assert.equal(deps.store.get("1").aiStep, "confirm");
});

test("aiHandler: подтверждение сохраняет транзакцию и очищает state", async () => {
  const { bot, deps } = setup({
    initialState: {
      1: {
        aiStep: "confirm",
        aiDraft: DRAFT,
        categories: ["Еда"],
        wallets: ["Наличные"],
        aiMessageId: 10,
      },
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q1",
    data: "ai:confirm",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.deepEqual(deps.transactions, [
    {
      date: "04.11.2026",
      amount: 250,
      category: "Еда",
      wallet: "Наличные",
      note: "кофе",
    },
  ]);
  assert.equal(deps.store.has("1"), false);
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.ADD_TRANSACTION.SUCCESS)
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
  assert.equal(bot.answers.length, 1);
});

test("aiHandler: устаревшее подтверждение даёт alert", async () => {
  const { bot, deps } = setup();
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q1",
    data: "ai:confirm",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(bot.answers[0].options.text, MESSAGES.AI.STALE);
  assert.equal(bot.answers[0].options.show_alert, true);
});

test("aiHandler: «Изменить» открывает предзаполненный /add", async () => {
  const { bot, deps } = setup({
    initialState: {
      1: {
        aiStep: "confirm",
        aiDraft: DRAFT,
        categories: ["Еда"],
        wallets: ["Наличные"],
        aiMessageId: 10,
      },
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q1",
    data: "ai:edit",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  const state = deps.store.get("1");
  assert.equal(state.step, "date");
  assert.equal(state.data.date, "04.11.2026");
  assert.equal(state.data.category, "Еда");
  assert.equal(state.data.wallet, "Наличные");
  assert.equal(state.data.note, "кофе");
  assert.equal(state.amountDraft, "250");
  assert.ok(bot.edits.some((edit) => edit.type === "markup"));
  assert.match(bot.sent.at(-1).text, /Выберите дату операции/);
});

test("aiHandler: отмена убирает клавиатуру и очищает state", async () => {
  const { bot, deps } = setup({
    initialState: {
      1: {
        aiStep: "confirm",
        aiDraft: DRAFT,
        categories: ["Еда"],
        wallets: ["Наличные"],
        aiMessageId: 10,
      },
    },
  });
  registerCallbackHandler(bot, deps);

  await emitCallback(bot, {
    id: "q1",
    data: "ai:cancel",
    message: { chat: { id: 1 } },
    from: { id: 1 },
  });

  assert.equal(deps.store.has("1"), false);
  assert.ok(bot.edits.some((edit) => edit.type === "markup"));
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.COMMON.CANCELLED)
  );
});

test("aiHandler: при выключенном AI свободный текст игнорируется", async () => {
  let parsed = false;
  const { bot } = setup({
    config: { aiParsingEnabled: false },
    ai: {
      parse: async () => {
        parsed = true;
        return aiResult();
      },
    },
  });

  await emitMessage(bot, "кофе 250");

  assert.equal(parsed, false);
  assert.equal(bot.sent.length, 0);
});
