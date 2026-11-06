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

function findCancelled(bot) {
  return bot.sent.find((message) => message.text === MESSAGES.COMMON.CANCELLED);
}

test("cancel: удаляет карточку, /cancel и подтверждение", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });

  await handleCancel(bot, deps, { chat: { id: 1 }, message_id: 20 });

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.sent.length, 1);

  const cancelled = findCancelled(bot);
  assert.ok(cancelled);
  assert.ok(cancelled.options.reply_markup.keyboard);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
  assert.ok(bot.deleted.some((item) => item.messageId === 20));
  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === cancelled.message.message_id
    )
  );
  assert.equal(bot.edits.length, 0);
});

test("cancel: подтверждение удаляется через 1 секунду", async () => {
  const tasks = [];
  const bot = createBot();
  const deps = createDeps(
    { 1: cardState },
    {
      schedule: (fn, delayMs) => {
        tasks.push({ fn, delayMs });
        return { unref() {} };
      },
      cancelMessageTtlMs: 1000,
    }
  );

  await handleCancel(bot, deps, { chat: { id: 1 }, message_id: 20 });

  const cancelled = findCancelled(bot);
  assert.ok(cancelled);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].delayMs, 1000);
  assert.ok(
    !bot.deleted.some(
      (item) => item.messageId === cancelled.message.message_id
    )
  );

  tasks[0].fn();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === cancelled.message.message_id
    )
  );
});

test("cancel: без активного state ничего не делает", async () => {
  const bot = createBot();
  const deps = createDeps();

  await handleCancel(bot, deps, { chat: { id: 1 }, message_id: 20 });

  assert.equal(bot.sent.length, 0);
  assert.equal(bot.edits.length, 0);
  assert.equal(bot.deleted.length, 0);
});

test("cancel: старые сообщения с inline-клавиатурами удаляются", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: legacyState });

  await handleCancel(bot, deps, { chat: { id: 1 } });

  assert.equal(deps.store.has("1"), false);
  assert.equal(bot.edits.length, 0);
  assert.ok(bot.deleted.some((item) => item.messageId === 10));
  assert.ok(bot.deleted.some((item) => item.messageId === 11));
  assert.ok(findCancelled(bot));
});

test("cancel: команда /cancel проходит через onText и удаляется", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });
  registerCancelHandler(bot, deps);

  const message = await emitText(bot, "/cancel");

  assert.equal(deps.store.has("1"), false);
  assert.ok(bot.deleted.some((item) => item.messageId === message.message_id));
  assert.ok(findCancelled(bot));
});

test("cancel: текст кнопки «❌ Отмена» тоже отменяет и удаляется", async () => {
  const bot = createBot();
  const deps = createDeps({ 1: cardState });
  registerCancelHandler(bot, deps);

  const message = await emitText(bot, "❌ Отмена");

  assert.equal(deps.store.has("1"), false);
  assert.ok(bot.deleted.some((item) => item.messageId === message.message_id));
});
