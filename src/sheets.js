import { config } from "./config.js";
import { google } from "googleapis";

// Константы диапазонов
const RANGES = {
  CATEGORIES: "Categories!A2:A50",
  WALLETS: "Wallets!B2:B20",
  WALLETS_FULL: "Wallets!B2:D",
  TRANSACTIONS: "Transactions!A:G",
};

const spreadsheetId = config.spreadsheetId;

// Функция для создания аутентификации
function createAuth() {
  // Если есть закодированные credentials в переменной окружения
  if (config.googleCredentialsB64) {
    console.log("🔐 Используем аутентификацию через GOOGLE_CREDENTIALS_B64");
    const credentialsJson = Buffer.from(
      config.googleCredentialsB64,
      "base64"
    ).toString("utf-8");
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else {
    // Fallback на файл credentials.json для локальной разработки
    console.log("🔐 Используем аутентификацию через credentials.json");
    return new google.auth.GoogleAuth({
      keyFile: "credentials.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
}

const auth = createAuth();

let sheetsClient = null;
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: "v4", auth: client });
  return sheetsClient;
}

/**
 * Вспомогательная функция для получения сырых данных из указанного диапазона
 * @param {string} range - диапазон ячеек
 * @returns {Promise<Array<Array<string>>>} - двумерный массив значений
 */
async function getSheetValues(range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return res.data.values || [];
}

/**
 * Вспомогательная функция для получения данных из указанного диапазона
 * @param {string} range - диапазон ячеек
 * @returns {Promise<Array<string>>} - массив непустых значений
 */
async function getValuesFromRange(range) {
  const rows = await getSheetValues(range);
  // Преобразуем двумерный массив в одномерный и фильтруем пустые значения
  return rows
    .flat()
    .map((value) => (value ? value.toString().trim() : ""))
    .filter((value) => value !== "");
}

/**
 * Возвращает массив категорий из диапазона Categories!A2:A50
 * @returns {Promise<Array<string>>}
 */
async function getCategories() {
  return getValuesFromRange(RANGES.CATEGORIES);
}

/**
 * Возвращает массив кошельков из диапазона Wallets!B2:B20
 * @returns {Promise<Array<string>>}
 */
async function getWallets() {
  return getValuesFromRange(RANGES.WALLETS);
}

/**
 * Возвращает массив объектов { name, balance, currency } из диапазона Wallets!B2:D
 * Ожидается:
 * - в B2:B — имя кошелька
 * - в C2:C — баланс (число или текст с запятой)
 * - в D2:D — валюта (USD, EUR, RUB и т.д.)
 */
async function getBalances() {
  try {
    const rows = await getSheetValues(RANGES.WALLETS_FULL);

    const balances = rows.map((r) => {
      try {
        const name = r[0] || "";
        const rawBalance = r[1] || "";
        const currency = r[2] || "";

        // Преобразуем баланс в число
        const cleanedBalance = String(rawBalance)
          .replace(/\s/g, "")
          .replace(",", ".");
        const num = Number(cleanedBalance);

        // Валидация данных
        if (name.trim() === "") {
          console.warn("Обнаружена запись с пустым названием кошелька");
          return null;
        }

        return {
          name: name.trim(),
          balance: isNaN(num) ? 0 : num,
          currency: currency.trim().toUpperCase() || "неизвестная валюта", // Значение по умолчанию
        };
      } catch (error) {
        console.warn(`Ошибка обработки строки кошелька: ${error.message}`);
        return null;
      }
    });

    // Фильтруем некорректные записи
    return balances.filter((balance) => balance !== null);
  } catch (error) {
    console.error(`Ошибка получения данных из таблицы: ${error.message}`);
    throw new Error("Не удалось получить данные о балансах из таблицы");
  }
}

// Быстрая проверка: node src/sheets.js test
if (process.argv[2] === "test") {
  (async () => {
    try {
      const bal = await getBalances();
      console.log("Балансы (getBalances):");
      console.table(bal);
    } catch (err) {
      console.error("Ошибка при getBalances():", err.message || err);
    }
  })();
}

// запись в таблицу

async function appendTransaction({ date, amount, category, wallet, note }) {
  const sheets = await getSheetsClient();

  // Порядок колонок: A, B, C, D, E, F, G
  // B и D оставляем пустыми, чтобы не затирать формулы
  const values = [[date, "", amount, "", category, wallet, note]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: RANGES.TRANSACTIONS,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS", // вставляем строку в конец
    requestBody: {
      values,
    },
  });

  console.log("✅ Транзакция добавлена!");
}

export const sheets = {
  getWallets,
  appendTransaction,
  getBalances,
  getCategories,
};
