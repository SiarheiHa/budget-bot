import { test } from "node:test";
import assert from "node:assert/strict";
import { createSheets } from "../src/sheets.js";

const CATEGORIES_RANGE = "Categories!A2:B50";
const WALLETS_RANGE = "Wallets!B2:B20";
const BALANCES_RANGE = "Wallets!B2:D";
const TRANSACTIONS_RANGE = "Transactions!A:G";

function createLogger() {
  const entries = [];
  const add = (level) => (...args) => entries.push([level, ...args]);

  return {
    entries,
    info: add("info"),
    warn: add("warn"),
    error: add("error"),
  };
}

function createValuesApi(rowsByRange = {}) {
  const calls = { get: [], append: [] };

  return {
    calls,
    async get(range) {
      calls.get.push(range);
      return rowsByRange[range] || [];
    },
    async append(params) {
      calls.append.push(params);
    },
  };
}

function setup(rowsByRange) {
  const logger = createLogger();
  const valuesApi = createValuesApi(rowsByRange);
  const sheets = createSheets({
    config: { spreadsheetId: "test-sheet" },
    logger,
    valuesApi,
  });

  return { logger, valuesApi, sheets };
}

test("sheets: getCategories нормализует типы и пропускает пустые имена", async () => {
  const { logger, valuesApi, sheets } = setup({
    [CATEGORIES_RANGE]: [
      ["Еда", "Расход"],
      ["Зарплата", "доход"],
      ["Перевод", "transfer"],
      ["Без типа", ""],
      ["", "Расход"],
      ["Странная", "что-то"],
    ],
  });

  const categories = await sheets.getCategories();

  assert.deepEqual(categories, [
    { name: "Еда", type: "expense" },
    { name: "Зарплата", type: "income" },
    { name: "Перевод", type: "transfer" },
    { name: "Без типа", type: null },
    { name: "Странная", type: null },
  ]);
  assert.deepEqual(valuesApi.calls.get, [CATEGORIES_RANGE]);
  assert.ok(
    logger.entries.some(
      ([level, message]) =>
        level === "warn" && message.includes("Неизвестный тип категории")
    )
  );
});

test("sheets: getWallets возвращает непустые названия", async () => {
  const { valuesApi, sheets } = setup({
    [WALLETS_RANGE]: [["Наличные"], [""], [" Карта "]],
  });

  assert.deepEqual(await sheets.getWallets(), ["Наличные", "Карта"]);
  assert.deepEqual(valuesApi.calls.get, [WALLETS_RANGE]);
});

test("sheets: getBalances парсит суммы и валюты", async () => {
  const { logger, sheets } = setup({
    [BALANCES_RANGE]: [
      ["Наличные", "1 000,50", "rub"],
      ["Карта", "100.25", "USD"],
      ["Пустой", "", "EUR"],
      ["", "999", "RUB"],
      ["Кривой", "abc", "rub"],
    ],
  });

  assert.deepEqual(await sheets.getBalances(), [
    { name: "Наличные", balance: 1000.5, currency: "RUB" },
    { name: "Карта", balance: 100.25, currency: "USD" },
    { name: "Пустой", balance: 0, currency: "EUR" },
    { name: "Кривой", balance: 0, currency: "RUB" },
  ]);
  assert.ok(
    logger.entries.some(
      ([level, message]) =>
        level === "warn" && message.includes("пустым названием")
    )
  );
});

test("sheets: getBalances оборачивает ошибку таблицы", async () => {
  const logger = createLogger();
  const sheets = createSheets({
    config: { spreadsheetId: "test-sheet" },
    logger,
    valuesApi: {
      async get() {
        throw new Error("boom");
      },
    },
  });

  await assert.rejects(
    () => sheets.getBalances(),
    /Не удалось получить данные о балансах из таблицы/
  );
  assert.ok(
    logger.entries.some(
      ([level, message]) => level === "error" && message.includes("boom")
    )
  );
});

test("sheets: appendTransaction пишет строку с USER_ENTERED", async () => {
  const { valuesApi, sheets } = setup();

  await sheets.appendTransaction({
    date: "13.09.2025",
    amount: 250,
    category: "Еда",
    wallet: "Наличные",
    note: "=1+1",
  });

  assert.deepEqual(valuesApi.calls.append, [
    {
      range: TRANSACTIONS_RANGE,
      values: [["13.09.2025", "", 250, "", "Еда", "Наличные", "'=1+1"]],
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    },
  ]);
});

test("sheets: appendTransfer пишет две строки с разными знаками", async () => {
  const { valuesApi, sheets } = setup();

  await sheets.appendTransfer({
    date: "13.09.2025",
    amount: -500,
    category: "Перевод",
    fromWallet: "Наличные",
    toWallet: "Карта",
    note: "перевод",
  });

  assert.deepEqual(valuesApi.calls.append[0].values, [
    ["13.09.2025", "", -500, "", "Перевод", "Наличные", "перевод"],
    ["13.09.2025", "", 500, "", "Перевод", "Карта", "перевод"],
  ]);
});
