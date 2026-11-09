import { google } from "googleapis";
import {
  buildTransactionRow,
  buildTransferRows,
  escapeSheetFormula,
  normalizeCategoryType,
} from "./utils.js";

const RANGES = {
  CATEGORIES: "Categories!A2:B50",
  WALLETS: "Wallets!B2:B20",
  WALLETS_FULL: "Wallets!B2:D",
  TRANSACTIONS: "Transactions!A:G",
  TRANSACTIONS_FIRST_COLUMN: "Transactions!A2:A",
  SERVICE_LAST_ROW: "Service!A1",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const WINDOW_SIZE = 25;
const MAX_CACHED_WINDOWS = 5;

function parseSheetNumber(value) {
  if (typeof value === "number") return value;

  const cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(",", ".");
  return Number(cleaned);
}

function isTransactionValues(values) {
  if (!Array.isArray(values)) return false;

  return [0, 2, 4, 5, 6].some((index) =>
    String(values[index] ?? "").trim()
  );
}

function parseTransactionRow(row, values) {
  return {
    row,
    date: String(values?.[0] ?? "").trim(),
    amount: parseSheetNumber(values?.[2]),
    category: String(values?.[4] ?? "").trim(),
    wallet: String(values?.[5] ?? "").trim(),
    note: String(values?.[6] ?? "").trim(),
  };
}

function getLastRowFromUpdatedRange(updatedRange) {
  if (!updatedRange) return null;

  const range = String(updatedRange).split("!").at(-1);
  const match = /[A-Z]+(\d+)(?::[A-Z]+(\d+))?/i.exec(range);
  if (!match) return null;

  return Number(match[2] || match[1]);
}

/**
 * Реальная реализация доступа к Google Sheets.
 * Клиент создаётся лениво, чтобы импорт модуля не требовал credentials.
 */
export function createGoogleValuesApi({ config, logger }) {
  let clientPromise = null;

  function createAuth() {
    if (config.googleCredentialsB64) {
      logger.info(
        "🔐 Используем аутентификацию через GOOGLE_CREDENTIALS_B64"
      );
      const credentialsJson = Buffer.from(
        config.googleCredentialsB64,
        "base64"
      ).toString("utf-8");
      return new google.auth.GoogleAuth({
        credentials: JSON.parse(credentialsJson),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }

    logger.info("🔐 Используем аутентификацию через credentials.json");
    return new google.auth.GoogleAuth({
      keyFile: "credentials.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const auth = createAuth();
        const authClient = await auth.getClient();
        return google.sheets({ version: "v4", auth: authClient });
      })();
    }

    return clientPromise;
  }

  return {
    async get(range) {
      const sheets = await getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range,
      });

      return res.data.values || [];
    },

    async append({ range, values, valueInputOption, insertDataOption }) {
      const sheets = await getClient();
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range,
        valueInputOption,
        insertDataOption,
        requestBody: {
          values,
        },
      });

      return res.data;
    },

    async getSheetId(title) {
      const sheets = await getClient();
      const res = await sheets.spreadsheets.get({
        spreadsheetId: config.spreadsheetId,
        fields: "sheets.properties(sheetId,title)",
      });

      const sheet = (res.data.sheets || []).find(
        (item) => item.properties?.title === title
      );
      return sheet?.properties?.sheetId ?? null;
    },

    async deleteRow({ sheetId, row }) {
      const sheets = await getClient();
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: row - 1,
                  endIndex: row,
                },
              },
            },
          ],
        },
      });
    },

    async batchUpdateValues({ data, valueInputOption = "USER_ENTERED" }) {
      const sheets = await getClient();
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: {
          valueInputOption,
          data,
        },
      });
    },
  };
}

/**
 * Создаёт слой работы с таблицей.
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.logger
 * @param {object} [options.valuesApi] - подменяемый доступ к Google Sheets
 */
export function createSheets({ config, logger, valuesApi } = {}) {
  const api = valuesApi || createGoogleValuesApi({ config, logger });

  let lastRowCache = null;
  let transactionsSheetId = null;
  const rowCache = new Map();
  const windowCache = new Map();

  function isFresh(entry) {
    return Boolean(entry) && Date.now() - entry.ts <= CACHE_TTL_MS;
  }

  function clearTransactionCaches() {
    lastRowCache = null;
    rowCache.clear();
    windowCache.clear();
  }

  function cacheRow(transaction) {
    rowCache.set(transaction.row, {
      data: transaction,
      ts: Date.now(),
    });
  }

  async function getSheetValues(range) {
    return api.get(range);
  }

  async function getValuesFromRange(range) {
    const rows = await getSheetValues(range);
    return rows
      .flat()
      .map((value) => (value ? value.toString().trim() : ""))
      .filter((value) => value !== "");
  }

  async function getCategories() {
    const rows = await getSheetValues(RANGES.CATEGORIES);

    return rows
      .map((row) => {
        const name = String(row?.[0] ?? "").trim();
        if (!name) return null;

        const rawType = row?.[1];
        const type = normalizeCategoryType(rawType);
        if (String(rawType ?? "").trim() && !type) {
          logger.warn(`Неизвестный тип категории "${name}": ${rawType}`);
        }

        return { name, type };
      })
      .filter(Boolean);
  }

  async function getWallets() {
    return getValuesFromRange(RANGES.WALLETS);
  }

  async function getBalances() {
    try {
      const rows = await getSheetValues(RANGES.WALLETS_FULL);

      const balances = rows.map((r) => {
        try {
          const name = r[0] || "";
          const rawBalance = r[1] || "";
          const currency = r[2] || "";

          const cleanedBalance = String(rawBalance)
            .replace(/\s/g, "")
            .replace(",", ".");
          const num = Number(cleanedBalance);

          if (name.trim() === "") {
            logger.warn("Обнаружена запись с пустым названием кошелька");
            return null;
          }

          return {
            name: name.trim(),
            balance: isNaN(num) ? 0 : num,
            currency: currency.trim().toUpperCase() || "неизвестная валюта",
          };
        } catch (error) {
          logger.warn(`Ошибка обработки строки кошелька: ${error.message}`);
          return null;
        }
      });

      return balances.filter((balance) => balance !== null);
    } catch (error) {
      logger.error(`Ошибка получения данных из таблицы: ${error.message}`);
      throw new Error("Не удалось получить данные о балансах из таблицы");
    }
  }

  async function readLastRowFromService() {
    const rows = await api.get(RANGES.SERVICE_LAST_ROW);
    const raw = rows?.[0]?.[0];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return null;
    }

    const value = Number(String(raw).trim());
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }

  async function readLastRowFallback() {
    const rows = await api.get(RANGES.TRANSACTIONS_FIRST_COLUMN);

    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (String(rows[index]?.[0] ?? "").trim()) return index + 2;
    }

    return 0;
  }

  async function getLastRow({ force = false } = {}) {
    if (!force && isFresh(lastRowCache)) return lastRowCache.value;

    let value = null;
    try {
      value = await readLastRowFromService();
    } catch (error) {
      logger.warn(`Не удалось прочитать Service!A1: ${error.message}`);
    }

    if (value === null) {
      value = await readLastRowFallback();
    }

    lastRowCache = { value, ts: Date.now() };
    return value;
  }

  async function getTransactionAt(row, { force = false } = {}) {
    if (!force) {
      const cached = rowCache.get(row);
      if (isFresh(cached)) return cached.data;
    }

    const rows = await api.get(`Transactions!A${row}:G${row}`);
    const values = rows?.[0];

    if (!isTransactionValues(values)) {
      rowCache.delete(row);
      return null;
    }

    const transaction = parseTransactionRow(row, values);
    cacheRow(transaction);
    return transaction;
  }

  async function getWindow(start, end, { force = false } = {}) {
    const safeStart = Math.max(2, start);
    if (end < safeStart) return [];

    const key = `${safeStart}:${end}`;
    const cached = windowCache.get(key);
    if (!force && isFresh(cached)) return cached.rows;

    const rows = await api.get(`Transactions!A${safeStart}:G${end}`);
    const transactions = [];

    rows.forEach((values, index) => {
      if (!isTransactionValues(values)) return;
      const transaction = parseTransactionRow(safeStart + index, values);
      transactions.push(transaction);
      cacheRow(transaction);
    });

    windowCache.set(key, { rows: transactions, ts: Date.now() });
    while (windowCache.size > MAX_CACHED_WINDOWS) {
      const oldestKey = windowCache.keys().next().value;
      windowCache.delete(oldestKey);
    }

    return transactions;
  }

  async function getLastTransaction() {
    const lastRow = await getLastRow();
    if (!lastRow) return null;

    const transaction = await getTransactionAt(lastRow);
    if (transaction) return transaction;

    const fallbackRow = await readLastRowFallback();
    lastRowCache = { value: fallbackRow, ts: Date.now() };
    if (!fallbackRow || fallbackRow === lastRow) return null;

    return getTransactionAt(fallbackRow, { force: true });
  }

  async function getNeighborTransaction(row, direction) {
    const lastRow = await getLastRow();
    if (!lastRow) return null;

    if (direction === "next") {
      let start = row + 1;
      while (start <= lastRow) {
        const end = Math.min(lastRow, start + WINDOW_SIZE - 1);
        const rows = await getWindow(start, end);
        if (rows.length > 0) return rows[0];
        start = end + 1;
      }
      return null;
    }

    let end = row - 1;
    while (end >= 2) {
      const start = Math.max(2, end - WINDOW_SIZE + 1);
      const rows = await getWindow(start, end);
      if (rows.length > 0) return rows.at(-1);
      end = start - 1;
    }
    return null;
  }

  async function getTransactionsSheetId() {
    if (transactionsSheetId !== null) return transactionsSheetId;

    transactionsSheetId = await api.getSheetId("Transactions");
    return transactionsSheetId;
  }

  async function deleteTransaction(row) {
    const sheetId = await getTransactionsSheetId();
    if (sheetId === null || sheetId === undefined) {
      throw new Error("Не найден лист Transactions");
    }

    await api.deleteRow({ sheetId, row });
    clearTransactionCaches();
  }

  async function updateTransaction(row, data) {
    await api.batchUpdateValues({
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `Transactions!A${row}`,
          values: [[data.date]],
        },
        {
          range: `Transactions!C${row}`,
          values: [[data.amount]],
        },
        {
          range: `Transactions!E${row}:G${row}`,
          values: [
            [
              data.category,
              data.wallet,
              escapeSheetFormula(data.note || ""),
            ],
          ],
        },
      ],
    });

    rowCache.delete(row);
    windowCache.clear();
  }

  async function appendRows(values) {
    const result = await api.append({
      range: RANGES.TRANSACTIONS,
      values,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    });

    const row = getLastRowFromUpdatedRange(result?.updates?.updatedRange);
    if (row) {
      lastRowCache = { value: row, ts: Date.now() };
      rowCache.clear();
      windowCache.clear();
    }

    return row;
  }

  async function appendTransaction({ date, amount, category, wallet, note }) {
    const row = await appendRows([
      buildTransactionRow({ date, amount, category, wallet, note }),
    ]);

    logger.info("✅ Транзакция добавлена!");
    return row;
  }

  async function appendTransfer({
    date,
    amount,
    category,
    fromWallet,
    toWallet,
    note,
  }) {
    const values = buildTransferRows({
      date,
      amount,
      category,
      fromWallet,
      toWallet,
      note,
    });

    const row = await appendRows(values);
    logger.info("✅ Перевод добавлен!");
    return row;
  }

  return {
    getWallets,
    appendTransaction,
    appendTransfer,
    getBalances,
    getCategories,
    getLastTransaction,
    getNeighborTransaction,
    deleteTransaction,
    updateTransaction,
  };
}

// Быстрая проверка: node src/sheets.js test
if (process.argv[2] === "test") {
  (async () => {
    const [{ config }, { logger }] = await Promise.all([
      import("./config.js"),
      import("./logger.js"),
    ]);
    const sheets = createSheets({ config, logger });

    try {
      const bal = await sheets.getBalances();
      logger.info("Балансы (getBalances):");
      console.table(bal);
    } catch (err) {
      logger.error("Ошибка при getBalances():", err.message || err);
    }
  })();
}
