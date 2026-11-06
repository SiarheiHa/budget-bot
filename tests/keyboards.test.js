import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAmountKeyboard,
  createCalendarKeyboard,
  createNoteForceReply,
} from "../src/keyboards.js";

test("createAmountKeyboard: 4 колонки, без 00", () => {
  const rows = createAmountKeyboard().reply_markup.inline_keyboard;
  const buttons = rows.flat().map((button) => button.callback_data);

  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows[0].map((button) => button.callback_data),
    ["v1:amt:d:1", "v1:amt:d:2", "v1:amt:d:3", "v1:amt:back"]
  );
  assert.deepEqual(
    rows[1].map((button) => button.callback_data),
    ["v1:amt:d:4", "v1:amt:d:5", "v1:amt:d:6", "v1:amt:sign"]
  );
  assert.deepEqual(
    rows[2].map((button) => button.callback_data),
    ["v1:amt:d:7", "v1:amt:d:8", "v1:amt:d:9", "v1:amt:sep"]
  );
  assert.deepEqual(
    rows[3].map((button) => button.callback_data),
    ["v1:amt:clear", "v1:amt:d:0", "v1:amt:ok"]
  );
  assert.ok(!buttons.includes("v1:amt:00"));
});

test("createAmountKeyboard: AI-вариант без знака и с футером", () => {
  const rows = createAmountKeyboard({
    prefix: "ai:amt",
    allowSign: false,
    footer: [
      [
        { text: "Назад", callback_data: "ai:back" },
        { text: "Отмена", callback_data: "ai:cancel" },
      ],
    ],
  }).reply_markup.inline_keyboard;

  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows[1].map((button) => button.callback_data),
    ["ai:amt:d:4", "ai:amt:d:5", "ai:amt:d:6"]
  );
  assert.deepEqual(
    rows[4].map((button) => button.callback_data),
    ["ai:back", "ai:cancel"]
  );
});

test("createNoteForceReply: просит клиент открыть ввод", () => {
  assert.deepEqual(createNoteForceReply(), {
    reply_markup: {
      force_reply: true,
      input_field_placeholder: "Примечание или -",
    },
  });
});

test("createCalendarKeyboard: AI-префикс и футер", () => {
  const rows = createCalendarKeyboard(2026, 10, {
    prefix: "ai:cal",
    footer: [[{ text: "Назад", callback_data: "ai:back" }]],
  }).reply_markup.inline_keyboard;

  assert.equal(rows[0][0].callback_data, "ai:cal:nav:2026-09");
  assert.equal(rows[0][1].callback_data, "ai:cal:nav:2026-11");
  assert.equal(rows.at(-2)[0].callback_data, "ai:cal:today");
  assert.equal(rows.at(-1)[0].callback_data, "ai:back");
});
