import { test } from "node:test";
import assert from "node:assert/strict";
import { createSheets } from "../src/sheets.js";

const SERVICE = "Service!A1";
const FIRST_COLUMN = "Transactions!A2:A";

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

function createValuesApi({
  service = [["0"]],
  firstColumn = [],
  rowsByRange = {},
  appendRange = null,
  sheetId = 7,
} = {}) {
  const calls = {
    get: [],
    append: [],
    getSheetId: [],
    deleteRow: [],
    batchUpdateValues: [],
  };

  return {
    calls,
    async get(range) {
      calls.get.push(range);
      if (range === SERVICE) return service;
      if (range === FIRST_COLUMN) return firstColumn;
      return rowsByRange[range] || [];
    },
    async append(params) {
      calls.append.push(params);
      return { updates: { updatedRange: appendRange } };
    },
    async getSheetId(title) {
      calls.getSheetId.push(title);
      return sheetId;
    },
    async deleteRow(params) {
      calls.deleteRow.push(params);
    },
    async batchUpdateValues(params) {
      calls.batchUpdateValues.push(params);
    },
  };
}

function setup(options) {
  const logger = createLogger();
  const valuesApi = createValuesApi(options);
  const sheets = createSheets({
    config: { spreadsheetId: "test-sheet" },
    logger,
    valuesApi,
  });

  return { logger, valuesApi, sheets };
}

function transactionValues(overrides = {}) {
  return [
    overrides.date || "09.11.2026",
    "",
    overrides.amount ?? 250,
    "",
    overrides.category || "Еда",
    overrides.wallet || "Наличные",
    overrides.note || "кофе",
  ];
}

test("transactions: getLastTransaction читает Service и одну строку", async () => {
  const { valuesApi, sheets } = setup({
    service: [["12"]],
    rowsByRange: {
      "Transactions!A12:G12": [transactionValues()],
    },
  });

  const transaction = await sheets.getLastTransaction();

  assert.deepEqual(transaction, {
    row: 12,
    date: "09.11.2026",
    amount: 250,
    category: "Еда",
    wallet: "Наличные",
    note: "кофе",
  });
  assert.deepEqual(valuesApi.calls.get, [SERVICE, "Transactions!A12:G12"]);

  await sheets.getLastTransaction();
  assert.equal(valuesApi.calls.get.length, 2);
});

test("transactions: getLastTransaction использует fallback A:A", async () => {
  const { valuesApi, sheets } = setup({
    service: [],
    firstColumn: [["01.11.2026"], ["02.11.2026"], [], ["04.11.2026"]],
    rowsByRange: {
      "Transactions!A5:G5": [transactionValues({ note: "последняя" })],
    },
  });

  const transaction = await sheets.getLastTransaction();

  assert.equal(transaction.row, 5);
  assert.equal(transaction.note, "последняя");
  assert.deepEqual(valuesApi.calls.get, [
    SERVICE,
    FIRST_COLUMN,
    "Transactions!A5:G5",
  ]);
});

test("transactions: Service=0 означает пустую таблицу", async () => {
  const { valuesApi, sheets } = setup({ service: [["0"]] });

  assert.equal(await sheets.getLastTransaction(), null);
  assert.deepEqual(valuesApi.calls.get, [SERVICE]);
});

test("transactions: getNeighborTransaction ищет предыдущую в окне", async () => {
  const rows = Array.from({ length: 10 }, () => []);
  rows[3] = transactionValues({ date: "05.11.2026", amount: 100 });
  rows[9] = transactionValues({ date: "11.11.2026", amount: 200 });

  const { sheets } = setup({
    service: [["12"]],
    rowsByRange: {
      "Transactions!A2:G11": rows,
    },
  });

  const transaction = await sheets.getNeighborTransaction(12, "prev");

  assert.equal(transaction.row, 11);
  assert.equal(transaction.amount, 200);
});

test("transactions: getNeighborTransaction ищет следующую в окне", async () => {
  const rows = Array.from({ length: 10 }, () => []);
  rows[0] = transactionValues({ date: "03.11.2026", amount: 300 });

  const { sheets } = setup({
    service: [["12"]],
    rowsByRange: {
      "Transactions!A3:G12": rows,
    },
  });

  const transaction = await sheets.getNeighborTransaction(2, "next");

  assert.equal(transaction.row, 3);
  assert.equal(transaction.amount, 300);
});

test("transactions: deleteTransaction удаляет строку по sheetId", async () => {
  const { valuesApi, sheets } = setup({
    service: [["12"]],
    sheetId: 42,
  });

  await sheets.deleteTransaction(12);

  assert.deepEqual(valuesApi.calls.getSheetId, ["Transactions"]);
  assert.deepEqual(valuesApi.calls.deleteRow, [{ sheetId: 42, row: 12 }]);
});

test("transactions: updateTransaction пишет только A, C и E:G", async () => {
  const { valuesApi, sheets } = setup();

  await sheets.updateTransaction(12, {
    date: "10.11.2026",
    amount: 300,
    category: "Транспорт",
    wallet: "Карта",
    note: "=1+1",
  });

  assert.deepEqual(valuesApi.calls.batchUpdateValues, [
    {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Transactions!A12",
          values: [["10.11.2026"]],
        },
        {
          range: "Transactions!C12",
          values: [[300]],
        },
        {
          range: "Transactions!E12:G12",
          values: [["Транспорт", "Карта", "'=1+1"]],
        },
      ],
    },
  ]);
});

test("transactions: append без updatedRange сбрасывает кеш последней строки", async () => {
  const service = [["12"]];
  const { sheets } = setup({
    service,
    rowsByRange: {
      "Transactions!A12:G12": [transactionValues()],
      "Transactions!A13:G13": [
        transactionValues({ date: "13.11.2026", note: "следующая" }),
      ],
    },
  });

  await sheets.getLastTransaction();

  service[0][0] = "13";
  await sheets.appendTransaction({
    date: "13.11.2026",
    amount: 100,
    category: "Еда",
    wallet: "Карта",
    note: "следующая",
  });

  const transaction = await sheets.getLastTransaction();
  assert.equal(transaction.row, 13);
  assert.equal(transaction.note, "следующая");
});

test("transactions: appendTransaction возвращает и кеширует последнюю строку", async () => {
  const { valuesApi, sheets } = setup({
    appendRange: "Transactions!A15:G15",
    rowsByRange: {
      "Transactions!A15:G15": [transactionValues({ note: "новая" })],
    },
  });

  const row = await sheets.appendTransaction({
    date: "15.11.2026",
    amount: 500,
    category: "Еда",
    wallet: "Карта",
    note: "новая",
  });

  assert.equal(row, 15);
  assert.equal(valuesApi.calls.append.length, 1);

  const transaction = await sheets.getLastTransaction();
  assert.equal(transaction.row, 15);
  assert.deepEqual(valuesApi.calls.get, ["Transactions!A15:G15"]);
});
