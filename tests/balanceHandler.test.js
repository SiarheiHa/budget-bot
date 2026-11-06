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
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
});

test("balance: пустой список показывает NO_DATA", async () => {
  const bot = createBot();
  const deps = createDeps({}, { sheets: { getBalances: async () => [] } });

  await handleBalanceCommand(bot, deps, { chat: { id: 1 } });

  assert.equal(bot.sent.length, 2);
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.BALANCE.NO_DATA)
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
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
  assert.ok(
    bot.sent.some((message) => message.text === MESSAGES.BALANCE.ERROR)
  );
  assert.ok(bot.sent.at(-1).options.reply_markup.keyboard);
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
