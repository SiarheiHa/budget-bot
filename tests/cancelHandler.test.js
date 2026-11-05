import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleCancel,
  registerCancelHandler,
} from "../src/handlers/cancelHandler.js";
import { MESSAGES } from "../src/messages.js";
import { createBot, createDeps, emitText } from "./helpers/fakes.js";

const cardState = {
  step: "amount",
  data: { date: "13.09.2025" },
  cardMessageId: 10,
};

const legacyState = {
  step: "amount",
  data: { date: "13.09.2025" },
  calendarMessageId: 10,
  amountMessageId: 11,
};

test("cancel: удаляет карточку и оставляет одно сообщение с меню", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });

  await handleCancel(bot, deps, { chat: { id: 1 } });

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.sent.length, 1);
  assert.equal(bot.sent[0].text, MESSAGES.COMMON.CANCELLED);
  assert.ok(bot.sent[0].options.reply_markup.keyboard);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
});

test("cancel: без активного state ничего не делает", async () => {
  const bot = createBot();
  const deps = createDeps();

  await handleCancel(bot, deps, { chat: { id: 1 } });

  assert.equal(bot.sent.length, 0);
  assert.equal(bot.edits.length, 0);
  assert.equal(bot.deleted.length, 0);
});

test("cancel: старые inline-клавиатуры по-прежнему убираются", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: legacyState });

  await handleCancel(bot, deps, { chat: { id: 1 } });

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.edits.filter((edit) => edit.type === "markup").length, 2);
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.COMMON.CANCELLED)
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
});

test("cancel: команда /cancel проходит через onText", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });
  registerCancelHandler(bot, deps);

  await emitText(bot, "/cancel");

  assert.equal(deps.store.has("1"), false);
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.COMMON.CANCELLED)
  );
});

test("cancel: текст кнопки «❌ Отмена» тоже отменяет", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });
  registerCancelHandler(bot, deps);

  await emitText(bot, "❌ Отмена");

  assert.equal(deps.store.has("1"), false);
});
