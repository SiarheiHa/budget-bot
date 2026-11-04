import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setUserState,
  getUserState,
  updateUserState,
  clearUserState,
} from "../src/state.js";

test("state: set/get/update/del", () => {
  setUserState("state-basic", { step: "date", data: { a: 1 } });

  assert.equal(getUserState("state-basic").step, "date");

  updateUserState("state-basic", { step: "amount" });
  const updated = getUserState("state-basic");
  assert.equal(updated.step, "amount");
  assert.deepEqual(updated.data, { a: 1 });

  clearUserState("state-basic");
  assert.equal(getUserState("state-basic"), null);
});

test("state: update создаёт запись, если её нет", () => {
  updateUserState("state-new", { step: "wallet" });

  assert.equal(getUserState("state-new").step, "wallet");
  clearUserState("state-new");
});

test("state: TTL удаляет запись", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });

  setUserState("state-ttl", { step: "date" });
  t.mock.timers.tick(15 * 60 * 1000);
  assert.ok(getUserState("state-ttl"), "на границе TTL запись ещё жива");

  t.mock.timers.tick(1);
  assert.equal(getUserState("state-ttl"), null);
});

test("state: update продлевает TTL", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });

  setUserState("state-refresh", { step: "date" });
  t.mock.timers.tick(10 * 60 * 1000);
  updateUserState("state-refresh", { step: "amount" });

  t.mock.timers.tick(10 * 60 * 1000);
  assert.ok(getUserState("state-refresh"), "после update TTL отсчитывается заново");

  clearUserState("state-refresh");
});

test("state: при истечении отправляет уведомление и меню", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });

  const sent = [];
  const bot = {
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
    },
  };
  const keyboards = {
    showMainKeyboard: async (botArg, chatId) => {
      sent.push({ chatId, main: true });
    },
  };

  setUserState("state-expired", { step: "date" });
  t.mock.timers.tick(16 * 60 * 1000);

  const result = getUserState("state-expired", {
    bot,
    chatId: "state-expired",
    messages: { COMMON: { SESSION_EXPIRED: "expired" } },
    keyboards,
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result, null);
  assert.deepEqual(sent, [
    { chatId: "state-expired", text: "expired" },
    { chatId: "state-expired", main: true },
  ]);
});
