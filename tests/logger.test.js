import { test } from "node:test";
import assert from "node:assert/strict";
import { isDebugEnabled } from "../src/logger.js";

test("logger: DEBUG выключен для пустых и отрицательных значений", () => {
  for (const value of [undefined, null, "", "0", "false", "FALSE", " no ", "off"]) {
    assert.equal(isDebugEnabled(value), false, `DEBUG=${String(value)}`);
  }
});

test("logger: DEBUG включён для остальных значений", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on", "*"]) {
    assert.equal(isDebugEnabled(value), true, `DEBUG=${String(value)}`);
  }
});
