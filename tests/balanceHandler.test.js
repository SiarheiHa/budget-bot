import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleBalanceCommand,
  registerBalanceHandler,
} from "../src/handlers/balanceHandler.js";
import { MESSAGES } from "../src/messages.js";
import { createBot, createDeps, emitText } from "./helpers/fakes.js";

test("balance: выводит балансы и возвращает меню", async () => {
  const bot = createBot();
  const deps = createDeps();

  await handleBalanceCommand(bot, deps, { chat: { id: 1 } });

  assert.equal(bot.sent.length, 2);
  assert.equal(bot.sent[0].text, MESSAGES.BALANCE.LOADING);
  assert.match(bot.sent[1].text, /Наличные: 100 RUB/);
  assert.ok(bot.sent[1].options.reply_markup.keyboard);
  assert.equal(bot.edits.length, 0);
  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === bot.sent[0].message.message_id
    )
  );
});

test("balance: пустой список показывает NO_DATA", async () => {
  const bot = createBot();
  const deps = createDeps({}, { sheets: { getBalances: async () => [] } });

  await handleBalanceCommand(bot, deps, { chat: { id: 1 } });

  assert.equal(bot.sent.length, 2);
  assert.equal(bot.sent[1].text, MESSAGES.BALANCE.NO_DATA);
  assert.ok(bot.sent[1].options.reply_markup.keyboard);
  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === bot.sent[0].message.message_id
    )
  );
});

test("balance: ошибка Sheets показывает ERROR и возвращает меню", async () => {
  const bot = createBot();
  const deps = createDeps(
    {},
    {
      sheets: {
        getBalances: async () => {
          throw new Error("sheets down");
        },
      },
    }
  );

  await handleBalanceCommand(bot, deps, { chat: { id: 1 } });

  assert.equal(bot.sent.length, 2);
  assert.equal(bot.sent[1].text, MESSAGES.BALANCE.ERROR);
  assert.ok(bot.sent[1].options.reply_markup.keyboard);
  assert.ok(
    bot.deleted.some(
      (item) => item.messageId === bot.sent[0].message.message_id
    )
  );
});

test("balance: команда /balance проходит через onText", async () => {
  const bot = createBot();
  const deps = createDeps();
  registerBalanceHandler(bot, deps);

  await emitText(bot, "/balance");

  assert.equal(bot.sent.length, 2);
  assert.equal(bot.sent[0].text, MESSAGES.BALANCE.LOADING);
  assert.match(bot.sent[1].text, /Наличные: 100 RUB/);
});
