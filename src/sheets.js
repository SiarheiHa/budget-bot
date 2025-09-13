import { google } from "googleapis";

// Загружаем ключ сервисного аккаунта
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// сюда вставь ID таблицы (он в ссылке между `/d/` и `/edit`)
const spreadsheetId = "1rGxV5gzDfhql0WCfWfnd32VuEgHSFmdMkAM34MDnGTw";

async function testSheets() {
  try {
    const client = await auth.getClient();

    // создаём экземпляр API
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "A1:B5", // тестовый диапазон
    });

    console.log("Успешно! Данные:");
    console.log(res.data.values);
  } catch (err) {
    console.error("Ошибка доступа:", err);
  }
}

testSheets();
