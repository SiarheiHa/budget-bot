import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendDigit,
  appendDoubleZero,
  appendSeparator,
  backspace,
  clearDraft,
  toggleSign,
  applyAmountAction,
  parseAmountCallback,
  formatAmountDraft,
  formatAmountValue,
  MAX_INTEGER_DIGITS,
  MAX_DECIMAL_DIGITS,
} from "../src/amount.js";

test("amount: цифры и ведущие нули", () => {
  assert.equal(appendDigit("", "5"), "5");
  assert.equal(appendDigit("5", "0"), "50");
  assert.equal(appendDigit("0", "5"), "5");
  assert.equal(appendDigit("0", "0"), "0");
  assert.equal(appendDigit("1", "2"), "12");
});

test("amount: двойной ноль", () => {
  assert.equal(appendDoubleZero(""), "0");
  assert.equal(appendDoubleZero("1"), "100");
  assert.equal(appendDoubleZero("1,5"), "1,50");
  assert.equal(appendDoubleZero("1,50"), "1,50");
});

test("amount: разделитель дробной части", () => {
  assert.equal(appendSeparator(""), "0,");
  assert.equal(appendSeparator("12"), "12,");
  assert.equal(appendSeparator("12,"), "12,");
  assert.equal(appendDigit(appendSeparator("12"), "5"), "12,5");
});

test("amount: не больше двух знаков после запятой", () => {
  let draft = appendSeparator("1");
  draft = appendDigit(draft, "2");
  draft = appendDigit(draft, "3");
  const limited = appendDigit(draft, "4");
  assert.equal(draft, "1,23");
  assert.equal(limited, "1,23");
  assert.equal(MAX_DECIMAL_DIGITS, 2);
});

test("amount: ограничение длины целой части", () => {
  const draft = "1".repeat(MAX_INTEGER_DIGITS);
  assert.equal(appendDigit(draft, "1"), draft);
});

test("amount: переключение знака", () => {
  assert.equal(toggleSign(""), "-");
  assert.equal(toggleSign("-"), "");
  assert.equal(toggleSign("500"), "-500");
  assert.equal(toggleSign("-500"), "500");
  assert.equal(toggleSign("-500,50"), "500,50");
});

test("amount: backspace и очистка", () => {
  assert.equal(backspace(""), "");
  assert.equal(backspace("-"), "");
  assert.equal(backspace("-500"), "-50");
  assert.equal(backspace("500,"), "500");
  assert.equal(clearDraft(), "");
});

test("amount: applyAmountAction", () => {
  assert.equal(applyAmountAction("", { type: "digit", value: "7" }), "7");
  assert.equal(applyAmountAction("7", { type: "doubleZero" }), "700");
  assert.equal(applyAmountAction("7", { type: "separator" }), "7,");
  assert.equal(applyAmountAction("7,5", { type: "sign" }), "-7,5");
  assert.equal(applyAmountAction("-7,5", { type: "backspace" }), "-7,");
  assert.equal(applyAmountAction("-7,5", { type: "clear" }), "");
  assert.equal(applyAmountAction("7", { type: "unknown" }), "7");
});

test("amount: parseAmountCallback", () => {
  assert.deepEqual(parseAmountCallback("v1:amt:d:5"), {
    type: "digit",
    value: "5",
  });
  assert.deepEqual(parseAmountCallback("v1:amt:00"), { type: "doubleZero" });
  assert.deepEqual(parseAmountCallback("v1:amt:sep"), { type: "separator" });
  assert.deepEqual(parseAmountCallback("v1:amt:back"), { type: "backspace" });
  assert.deepEqual(parseAmountCallback("v1:amt:clear"), { type: "clear" });
  assert.deepEqual(parseAmountCallback("v1:amt:sign"), { type: "sign" });
  assert.deepEqual(parseAmountCallback("v1:amt:ok"), { type: "confirm" });
  assert.equal(parseAmountCallback("cal:today"), null);
  assert.equal(parseAmountCallback("v1:amt:d:55"), null);
  assert.equal(parseAmountCallback(null), null);
});

test("amount: форматирование черновика", () => {
  assert.equal(formatAmountDraft(""), "0");
  assert.equal(formatAmountDraft("-"), "-0");
  assert.equal(formatAmountDraft("0,"), "0,");
  assert.equal(formatAmountDraft("1000"), "1 000");
  assert.equal(formatAmountDraft("-1250,50"), "-1 250,50");
});

test("amount: форматирование значения", () => {
  assert.equal(formatAmountValue(500), "500");
  assert.equal(formatAmountValue(-500), "-500");
  assert.equal(formatAmountValue(1250.5), "1 250,5");
  assert.equal(formatAmountValue(NaN), "");
});
