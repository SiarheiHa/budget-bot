import { EventEmitter } from "node:events";
import { createAmountUiQueue } from "../../src/amountUi.js";

export function createBot() {
  const bot = new EventEmitter();
  bot.answers = [];
  bot.edits = [];
  bot.sent = [];
  bot.deleted = [];
  bot.textHandlers = [];
  bot.chatActions = [];

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
  bot.sendChatAction = async (chatId, action) => {
    bot.chatActions.push({ chatId, action });
  };
  bot.onText = (regexp, handler) => {
    bot.textHandlers.push({ regexp, handler });
    return bot;
  };

  return bot;
}

export function createDeps(initialState = {}, overrides = {}) {
  const store = new Map(
    Object.entries(initialState).map(([id, value]) => [
      String(id),
      { ...value, _ts: Date.now() },
    ])
  );
  const transactions = [];

  return {
    config: {
      allowedUsers: ["1"],
      aiParsingEnabled: false,
      ...(overrides.config || {}),
    },
    logger: overrides.logger || {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    sheets: {
      getCategories: async () => [
        { name: "Еда", type: "expense" },
        { name: "Транспорт", type: "expense" },
      ],
      getWallets: async () => ["Наличные", "Карта"],
      getBalances: async () => [
        { name: "Наличные", balance: 100, currency: "RUB" },
      ],
      appendTransaction: async (transaction) => {
        transactions.push(transaction);
      },
      ...(overrides.sheets || {}),
    },
    ai: overrides.ai || {
      parse: async () => ({ ok: false, reason: "not_transaction" }),
    },
    aiInFlight: overrides.aiInFlight || new Set(),
    amountUi:
      overrides.amountUi || createAmountUiQueue({ minIntervalMs: 0 }),
    state: {
      get: (id) => store.get(String(id)) || null,
      peek: (id) => store.get(String(id)) || null,
      set: (id, value) =>
        store.set(String(id), { ...value, _ts: Date.now() }),
      update: (id, value) => {
        store.set(String(id), {
          ...(store.get(String(id)) || {}),
          ...value,
          _ts: Date.now(),
        });
      },
      del: (id) => store.delete(String(id)),
    },
    store,
    transactions,
  };
}

let nextMessageId = 1;

export function buildMessage(text, chatId = 1) {
  return {
    message_id: nextMessageId++,
    chat: { id: chatId },
    from: { id: chatId },
    text,
  };
}

export async function emitText(bot, text, chatId = 1) {
  const entry = bot.textHandlers.find(({ regexp }) => regexp.test(text));
  if (!entry) return false;

  await entry.handler(buildMessage(text, chatId), entry.regexp.exec(text));
  return true;
}

export async function emitMessage(bot, text, chatId = 1) {
  const message = buildMessage(text, chatId);
  for (const listener of bot.listeners("message")) {
    await listener(message);
  }
  return message;
}
