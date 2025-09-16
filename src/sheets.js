import { config } from "./config.js";
import { google } from "googleapis";

// Константы диапазонов
const RANGES = {
  CATEGORIES: "Categories!A2:A50",
  WALLETS: "Wallets!B2:B20",
  WALLETS_FULL: "Wallets!B2:C",
  TRANSACTIONS: "Transactions!A:G",
};

const spreadsheetId = config.spreadsheetId;

// Используем credentials.json в корне проекта
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

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
 * Возвращает массив объектов { name, balance } из диапазона Wallets!B2:C
 * Ожидается: в B2:B — имя кошелька, в C2:C — баланс (число или текст с запятой)
 */
async function getBalances() {
  const rows = await getSheetValues(RANGES.WALLETS_FULL);

  return rows.map((r) => {
    const name = r[0] || "";
    const raw = r[1] || "";
    const num = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return { name, balance: isNaN(num) ? 0 : num };
  });
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
