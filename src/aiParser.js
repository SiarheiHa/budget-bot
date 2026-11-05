import {
  formatDateToDisplay,
  parseAmount,
  parseNaturalDate,
} from "./utils.js";

const REQUEST_TIMEOUT_MS = 10000;
const MAX_INPUT_LENGTH = 500;
const MAX_NOTE_LENGTH = 200;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    is_transaction: { type: "boolean" },
    amount: { type: "number" },
    category: { type: "string" },
    wallet: { type: "string" },
    date_text: { type: "string" },
    note: { type: "string" },
  },
  required: [
    "is_transaction",
    "amount",
    "category",
    "wallet",
    "date_text",
    "note",
  ],
};

function buildSystemPrompt({ categories, wallets, now }) {
  return [
    "Ты извлекаешь данные о личной финансовой транзакции из сообщения пользователя на русском языке.",
    `Сегодня ${formatDateToDisplay(now)}.`,
    "Верни строго JSON по заданной схеме, без markdown и пояснений.",
    "Правила:",
    "- Одна фраза — максимум одна транзакция.",
    "- Суммы расходов и доходов всегда положительные. Отрицательные суммы и переводы не поддерживаются: is_transaction=false.",
    "- category — только одно значение из списка категорий ниже. Если не подходит ни одна, верни пустую строку.",
    "- wallet — только одно значение из списка кошельков ниже. Если кошелёк не упомянут или не подходит, верни пустую строку.",
    '- date_text — точная фраза про дату из сообщения (например, "сегодня", "вчера", "9 октября", "3.10"). Если дата не указана, верни пустую строку. Не считай сумму датой.',
    "- note — короткое примечание (что или где), без суммы и даты.",
    "- Если сообщение не является финансовой операцией, верни is_transaction=false, amount=0 и пустые строки в остальных полях.",
    `Категории: ${categories.length ? categories.join(", ") : "(нет)"}.`,
    `Кошельки: ${wallets.length ? wallets.join(", ") : "(нет)"}.`,
  ].join("\n");
}

function parseModelJson(payload) {
  const raw = payload?.result?.response;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAmount(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }

  if (typeof raw !== "string") return NaN;

  const cleaned = raw
    .replace(/[−–—]/g, "-")
    .replace(/[^\d.,-]/g, "");

  return parseAmount(cleaned);
}

function matchFromList(value, list) {
  if (!value || typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  return (
    list.find((item) => item.trim().toLowerCase() === normalized) || null
  );
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function createAiParser({ config, logger, fetchImpl } = {}) {
  const request = fetchImpl || globalThis.fetch;
  const log = logger || {};

  async function parse(text, options = {}) {
    const { categories = [], wallets = [], now = new Date() } = options;
    const input = String(text ?? "").trim();

    if (!input) return { ok: false, reason: "not_transaction" };

    if (
      !config?.aiParsingEnabled ||
      !config.cloudflareAccountId ||
      !config.cloudflareApiToken
    ) {
      return { ok: false, reason: "disabled" };
    }

    if (typeof request !== "function") {
      return { ok: false, reason: "http_error" };
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/ai/run/${config.cloudflareAiModel}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: buildSystemPrompt({ categories, wallets, now }),
            },
            {
              role: "user",
              content: input.slice(0, MAX_INPUT_LENGTH),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: JSON_SCHEMA,
          },
          max_tokens: 200,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        log.warn?.(`AI request failed with HTTP ${response.status}`);
        return { ok: false, reason: "http_error" };
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, reason: "invalid_response" };
      }

      if (payload?.success === false) {
        log.warn?.("AI returned success=false", payload?.errors);
        return { ok: false, reason: "http_error" };
      }

      const data = parseModelJson(payload);
      if (!data) return { ok: false, reason: "invalid_response" };
      if (data.is_transaction !== true) {
        return { ok: false, reason: "not_transaction" };
      }

      const amount = normalizeAmount(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, reason: "invalid_response" };
      }

      const dateText =
        typeof data.date_text === "string" ? data.date_text.trim() : "";
      const date = dateText ? parseNaturalDate(dateText, now) : null;
      const note =
        typeof data.note === "string"
          ? data.note.trim().slice(0, MAX_NOTE_LENGTH)
          : "";

      return {
        ok: true,
        draft: {
          amount,
          category: matchFromList(data.category, categories),
          wallet: matchFromList(data.wallet, wallets),
          date: date || startOfDay(now),
          dateText: dateText || null,
          note,
        },
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        log.warn?.("AI request timed out");
        return { ok: false, reason: "timeout" };
      }

      log.error?.(`AI request error: ${err?.message || err}`);
      return { ok: false, reason: "http_error" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { parse };
}
