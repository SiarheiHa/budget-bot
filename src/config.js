// Импортируем dotenv для загрузки переменных окружения из файла .env
// Это позволит хранить токены и ключи отдельно от кода (безопасность).
import dotenv from "dotenv";

// Загружаем переменные окружения из .env файла в process.env
dotenv.config();

// Список обязательных переменных окружения
// Если их нет — бот работать не сможет, поэтому мы проверим и выведем ошибку.
const required = ["BOT_TOKEN", "SPREADSHEET_ID"];

// Проверяем наличие обязательных переменных окружения
for (const key of required) {
  if (!process.env[key]) {
    console.error(
      `❌ Ошибка: переменная окружения ${key} не задана. Добавьте её в .env`
    );
    // В реальном проекте можно завершать процесс:
    // process.exit(1);
    // Но пока оставим только предупреждение, чтобы не мешать отладке.
  }
}

// Экспортируем объект config, чтобы в других файлах проекта можно было
// легко получить доступ к настройкам (без прямого обращения к process.env).
export const config = {
  // Токен Telegram-бота
  botToken: process.env.BOT_TOKEN,

  // ID таблицы Google Sheets
  spreadsheetId: process.env.SPREADSHEET_ID,

  // Список разрешённых пользователей (если нужно ограничить доступ к боту).
  // Например: ALLOWED_USERS=123456789,987654321
  allowedUsers: (process.env.ALLOWED_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Учётные данные Google (JSON ключ) могут храниться в переменной окружения
  // в Base64 виде (удобно для деплоя, например, на Railway).
  googleCredentialsB64: process.env.GOOGLE_CREDENTIALS_B64 || null,
};
