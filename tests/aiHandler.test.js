import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAiHandler } from "../src/handlers/aiHandler.js";
import { registerCallbackHandler } from "../src/handlers/callbackHandler.js";
import { MESSAGES } from "../src/messages.js";
import { createBot, createDeps, emitMessage } from "./helpers/fakes.js";

const DATE = new Date(2026, 10, 4);
const AI_CONFIG = { aiParsingEnabled: true };
const AI_MESSAGE_ID = 10;

const DRAFT = {
  type: "expense",
  amount: 250,
  category: "Еда",
  wallet: "Наличные",
  date: DATE,
  dateText: null,
  note: "кофе",
};

const AI_CATEGORIES = [
  { name: "Еда", type: "expense" },
  { name: "Зарплата", type: "income" },
];

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

function setupWithCallbacks(options) {
  const result = setup(options);
  registerCallbackHandler(result.bot, result.deps);
  return result;
}

async function emitCallback(bot, deps, data, messageId) {
  const handler = bot.listeners("callback_query")[0];
  assert.equal(typeof handler, "function");

  const current = deps.store.get("1");
  await handler({
    id: "q1",
    data,
    message: {
      message_id: messageId ?? current?.aiMessageId,
      chat: { id: 1 },
    },
    from: { id: 1 },
  });
}

function confirmState(overrides = {}) {
  return {
    1: {
      aiStep: "confirm",
      aiEditField: null,
      aiDraft: DRAFT,
      categories: AI_CATEGORIES,
      wallets: ["Наличные", "Карта"],
      aiMessageId: AI_MESSAGE_ID,
      ...overrides,
    },
  };
}

test("aiHandler: свободный текст создаёт сводку", async () => {
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
  assert.match(summary.text, /Тип: Расход/);
  assert.match(summary.text, /Сумма: 250/);
  assert.match(summary.text, /04.11.2026/);
  assert.ok(summary.options.reply_markup.inline_keyboard);
});

test("aiHandler: неизвестные поля показываются в карточке", async () => {
  const { bot, deps } = setup({
    ai: {
      parse: async () =>
        aiResult({ ...DRAFT, category: null, wallet: null, type: null }),
    },
  });

  await emitMessage(bot, "кофе 250");

  const state = deps.store.get("1");
  assert.equal(state.aiStep, "edit");
  assert.equal(state.aiEditField, null);
  assert.equal(state.aiDraft.category, null);
  assert.equal(state.aiDraft.wallet, null);

  const card = bot.sent.at(-1);
  assert.match(card.text, /Категория: не выбрана/);
  assert.match(card.text, /Кошелёк: не выбран/);
  assert.ok(
    card.options.reply_markup.inline_keyboard.some((row) =>
      row.some((button) => button.callback_data === "ai:field:category")
    )
  );
});

test("aiHandler: карточка позволяет выбрать категорию и кошелёк", async () => {
  const { bot, deps } = setupWithCallbacks({
    sheets: { getCategories: async () => AI_CATEGORIES },
    ai: {
      parse: async () =>
        aiResult({ ...DRAFT, category: null, wallet: null, type: null }),
    },
  });

  await emitMessage(bot, "кофе 250");

  await emitCallback(bot, deps, "ai:field:category");
  assert.equal(deps.store.get("1").aiEditField, "category");
  assert.equal(bot.edits.at(-1).text, MESSAGES.AI.SELECT_CATEGORY);

  await emitCallback(bot, deps, "ai:pick:category:1");
  assert.equal(deps.store.get("1").aiDraft.category, "Зарплата");
  assert.equal(deps.store.get("1").aiDraft.type, "income");
  assert.equal(deps.store.get("1").aiEditField, null);

  await emitCallback(bot, deps, "ai:field:wallet");
  await emitCallback(bot, deps, "ai:pick:wallet:1");
  assert.equal(deps.store.get("1").aiDraft.wallet, "Карта");
  assert.match(bot.edits.at(-1).text, /Тип: Доход/);
});

test("aiHandler: «Изменить» открывает карточку без запуска /add", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });
  const sentBefore = bot.sent.length;

  await emitCallback(bot, deps, "ai:edit");

  const state = deps.store.get("1");
  assert.equal(state.aiStep, "edit");
  assert.equal(state.aiEditField, null);
  assert.equal(state.step, undefined);
  assert.equal(bot.sent.length, sentBefore);
  assert.match(bot.edits.at(-1).text, /Тип: Расход/);
  assert.ok(bot.edits.at(-1).form.reply_markup.inline_keyboard);
});

test("aiHandler: сумма редактируется клавиатурой и сохраняется", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit");
  await emitCallback(bot, deps, "ai:field:amount");
  assert.equal(deps.store.get("1").aiAmountDraft, "250");

  await emitCallback(bot, deps, "ai:amt:clear");
  await emitCallback(bot, deps, "ai:amt:d:3");
  await emitCallback(bot, deps, "ai:amt:d:0");
  await emitCallback(bot, deps, "ai:amt:d:0");
  await deps.amountUi.whenIdle(1);

  await emitCallback(bot, deps, "ai:amt:ok");
  assert.equal(deps.store.get("1").aiDraft.amount, 300);
  assert.equal(deps.store.get("1").aiEditField, null);
  assert.match(bot.edits.at(-1).text, /Сумма: 300/);

  await emitCallback(bot, deps, "ai:confirm");
  assert.equal(deps.transactions[0].amount, 300);
  assert.equal(deps.store.has("1"), false);
});

test("aiHandler: сумма и примечание вводятся текстом", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit");
  await emitCallback(bot, deps, "ai:field:amount");
  await emitMessage(bot, "300");
  assert.equal(deps.store.get("1").aiDraft.amount, 300);

  await emitCallback(bot, deps, "ai:field:note");
  assert.equal(bot.edits.at(-1).text, MESSAGES.AI.NOTE_PROMPT);
  await emitMessage(bot, "обед");
  assert.equal(deps.store.get("1").aiDraft.note, "обед");
});

test("aiHandler: дата редактируется календарём", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit");
  await emitCallback(bot, deps, "ai:field:date");
  assert.equal(deps.store.get("1").aiEditField, "date");

  await emitCallback(bot, deps, "ai:cal:nav:2026-12");
  assert.match(bot.edits.at(-1).text, /Декабрь 2026/);

  await emitCallback(bot, deps, "ai:cal:day:2026-11-09");
  const date = deps.store.get("1").aiDraft.date;
  assert.deepEqual(
    [date.getFullYear(), date.getMonth() + 1, date.getDate()],
    [2026, 11, 9]
  );
  assert.equal(deps.store.get("1").aiEditField, null);
});

test("aiHandler: «Назад» откатывает незавершённую сумму", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit");
  await emitCallback(bot, deps, "ai:field:amount");
  await emitCallback(bot, deps, "ai:amt:clear");
  await emitCallback(bot, deps, "ai:amt:d:9");
  await emitCallback(bot, deps, "ai:back");

  assert.equal(deps.store.get("1").aiDraft.amount, 250);
  assert.equal(deps.store.get("1").aiEditField, null);
  assert.match(bot.edits.at(-1).text, /Сумма: 250/);
});

test("aiHandler: незаполненные поля блокируют сохранение", async () => {
  const { bot, deps } = setupWithCallbacks({
    ai: {
      parse: async () =>
        aiResult({ ...DRAFT, category: null, wallet: null, type: null }),
    },
  });

  await emitMessage(bot, "кофе 250");
  await emitCallback(bot, deps, "ai:confirm");

  assert.equal(bot.answers.at(-1).options.text, MESSAGES.AI.SELECT_REQUIRED);
  assert.equal(bot.answers.at(-1).options.show_alert, true);
  assert.equal(deps.transactions.length, 0);
  assert.ok(deps.store.has("1"));
});

test("aiHandler: тип берётся из категории и меняется при выборе", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit");
  await emitCallback(bot, deps, "ai:field:category");
  await emitCallback(bot, deps, "ai:pick:category:1");

  assert.equal(deps.store.get("1").aiDraft.category, "Зарплата");
  assert.equal(deps.store.get("1").aiDraft.type, "income");
  assert.match(bot.edits.at(-1).text, /Тип: Доход/);
});

test("aiHandler: категории-переводы не участвуют в AI", async () => {
  const calls = [];
  const { bot } = setup({
    sheets: {
      getCategories: async () => [
        { name: "Еда", type: "expense" },
        { name: "Перевод", type: "transfer" },
      ],
    },
    ai: {
      parse: async (text, options) => {
        calls.push(options);
        return aiResult({ ...DRAFT, category: null, type: null });
      },
    },
  });

  await emitMessage(bot, "кофе 250");

  assert.deepEqual(calls[0].categories, ["Еда"]);
});

test("aiHandler: устаревшая кнопка даёт alert", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:edit", AI_MESSAGE_ID - 1);

  assert.equal(bot.answers.at(-1).options.text, MESSAGES.AI.STALE);
  assert.equal(bot.answers.at(-1).options.show_alert, true);
  assert.equal(deps.store.get("1").aiStep, "confirm");
});

test("aiHandler: подтверждение сохраняет транзакцию и очищает state", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:confirm");

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
});

test("aiHandler: устаревшее подтверждение даёт alert", async () => {
  const { bot, deps } = setupWithCallbacks();

  await emitCallback(bot, deps, "ai:confirm", AI_MESSAGE_ID);

  assert.equal(bot.answers[0].options.text, MESSAGES.AI.STALE);
  assert.equal(bot.answers[0].options.show_alert, true);
});

test("aiHandler: отмена убирает клавиатуру и очищает state", async () => {
  const { bot, deps } = setupWithCallbacks({
    initialState: confirmState(),
  });

  await emitCallback(bot, deps, "ai:cancel");

  assert.equal(deps.store.has("1"), false);
  assert.ok(bot.edits.some((edit) => edit.type === "markup"));
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.COMMON.CANCELLED)
  );
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
