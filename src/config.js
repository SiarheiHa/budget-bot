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
    const errorMessage = `❌ Ошибка: переменная окружения ${key} не задана. Добавьте её в .env`;
    console.error(errorMessage);

    // В ПРОДАКШЕНЕ ЗАВЕРШАЕМ ПРОЦЕСС
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
    // В режиме разработки можно продолжить, но бросить предупреждение
    throw new Error(errorMessage);
  }
}

// Список разрешённых пользователей (обязателен)
// Без явного списка доступ блокируется для всех
const allowedUsers = (process.env.ALLOWED_USERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedUsers.length === 0) {
  const errorMessage =
    "❌ Ошибка: переменная окружения ALLOWED_USERS не задана или пуста. Укажите через запятую список разрешённых Telegram ID (например: 123456789,987654321)";
  console.error(errorMessage);

  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }

  throw new Error(errorMessage);
}

const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || null;
const cloudflareAiModel =
  process.env.CLOUDFLARE_AI_MODEL ||
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// AI-парсинг — опциональная возможность: без ключей бот работает как раньше.
const aiParsingEnabled =
  process.env.AI_PARSING_ENABLED !== "false" &&
  Boolean(cloudflareAccountId && cloudflareApiToken);

// Экспортируем объект config, чтобы в других файлах проекта можно было
// легко получить доступ к настройкам (без прямого обращения к process.env).
export const config = {
  // Токен Telegram-бота
  botToken: process.env.BOT_TOKEN,

  // ID таблицы Google Sheets
  spreadsheetId: process.env.SPREADSHEET_ID,

  // Список разрешённых пользователей
  allowedUsers,

  // Учётные данные Google (JSON ключ) могут храниться в переменной окружения
  // в Base64 виде (удобно для деплоя, например, на Railway).
  googleCredentialsB64: process.env.GOOGLE_CREDENTIALS_B64 || null,

  // Cloudflare Workers AI (REST API)
  cloudflareAccountId,
  cloudflareApiToken,
  cloudflareAiModel,
  aiParsingEnabled,
};
