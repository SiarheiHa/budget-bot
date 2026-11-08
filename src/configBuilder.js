const REQUIRED_KEYS = ["BOT_TOKEN", "SPREADSHEET_ID"];

/**
 * Собирает конфиг из переменных окружения без побочных эффектов.
 * @param {NodeJS.ProcessEnv} env
 * @returns {object}
 */
export function buildConfig(env = process.env) {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(
        `❌ Ошибка: переменная окружения ${key} не задана. Добавьте её в .env`
      );
    }
  }

  const allowedUsers = (env.ALLOWED_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedUsers.length === 0) {
    throw new Error(
      "❌ Ошибка: переменная окружения ALLOWED_USERS не задана или пуста. Укажите через запятую список разрешённых Telegram ID (например: 123456789,987654321)"
    );
  }

  const cloudflareAccountId = env.CLOUDFLARE_ACCOUNT_ID || null;
  const cloudflareApiToken = env.CLOUDFLARE_API_TOKEN || null;
  const cloudflareAiModel =
    env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const aiParsingEnabled =
    env.AI_PARSING_ENABLED !== "false" &&
    Boolean(cloudflareAccountId && cloudflareApiToken);

  return {
    botToken: env.BOT_TOKEN,
    spreadsheetId: env.SPREADSHEET_ID,
    allowedUsers,
    googleCredentialsB64: env.GOOGLE_CREDENTIALS_B64 || null,
    cloudflareAccountId,
    cloudflareApiToken,
    cloudflareAiModel,
    aiParsingEnabled,
  };
}
