import { test } from "node:test";
import assert from "node:assert/strict";
import { createAmountKeyboard } from "../src/keyboards.js";

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
