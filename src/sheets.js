import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";

const spreadsheetId = process.env.SPREADSHEET_ID;

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
 * Вспомогательная функция для получения данных из указанного диапазона
 * @param {string} range - диапазон ячеек
 * @returns {Promise<Array<string>>} - массив непустых значений
 */
async function getValuesFromRange(range) {
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID не задан в .env");

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
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
  return getValuesFromRange("Categories!A2:A50");
}

/**
 * Возвращает массив кошельков из диапазона Wallets!B2:B20
 * @returns {Promise<Array<string>>}
 */
async function getWallets() {
  return getValuesFromRange("Wallets!B2:B20");
}

/**
 * Возвращает массив объектов { name, balance } из диапазона Wallets!B2:C
 * Ожидается: в B2:B — имя кошелька, в C2:C — баланс (число или текст с запятой)
 */
async function getBalances() {
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID не задан в .env");

  const sheets = await getSheetsClient();
  const range = "Wallets!B2:C";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
  return rows.map((r) => {
    const name = r[0] || "";
    const raw = r[1] || "";
    // Приводим строку к числу: заменяем запятую на точку, убираем пробелы
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
    range: "Transactions!A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS", // вставляем строку в конец
    requestBody: {
      values,
    },
  });

  console.log("✅ Транзакция добавлена!");
}

// Быстрая проверка: node src/sheets.js test
if (process.argv[2] === "test") {
  (async () => {
    try {
      console.log("Тестирование функций sheets.js...");

      const bal = await getBalances();
      console.log("Балансы (getBalances):");
      console.table(bal);

      const cats = await getCategories();
      console.log("Категории (getCategories):", cats);

      const wals = await getWallets();
      console.log("Кошельки (getWallets):", wals);
    } catch (err) {
      console.error("Ошибка при тестировании:", err.message || err);
    }
  })();
}

export const sheets = {
  getWallets,
  appendTransaction,
  getBalances,
  getCategories,
};
