import { google } from "googleapis";
import {
  buildTransactionRow,
  buildTransferRows,
  normalizeCategoryType,
} from "./utils.js";

const RANGES = {
  CATEGORIES: "Categories!A2:B50",
  WALLETS: "Wallets!B2:B20",
  WALLETS_FULL: "Wallets!B2:D",
  TRANSACTIONS: "Transactions!A:G",
};

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
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range,
        valueInputOption,
        insertDataOption,
        requestBody: {
          values,
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

  async function appendRows(values) {
    await api.append({
      range: RANGES.TRANSACTIONS,
      values,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    });
  }

  async function appendTransaction({ date, amount, category, wallet, note }) {
    await appendRows([
      buildTransactionRow({ date, amount, category, wallet, note }),
    ]);

    logger.info("✅ Транзакция добавлена!");
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

    await appendRows(values);
    logger.info("✅ Перевод добавлен!");
  }

  return {
    getWallets,
    appendTransaction,
    appendTransfer,
    getBalances,
    getCategories,
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
