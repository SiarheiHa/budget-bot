// src/index.js
import dotenv from "dotenv";
dotenv.config();

import TelegramBot from "node-telegram-bot-api";
import { getBalances, appendTransaction } from "./sheets.js";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("ERROR: BOT_TOKEN не задан в .env");
  process.exit(1);
}

// Парсим ALLOWED_USERS (если пусто => только developer разрешён)
const allowedEnv = process.env.ALLOWED_USERS || "";
const allowedUsers = new Set(
  allowedEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Если ALLOWED_USERS пуст, разрешаем всем (опционально).
// Сейчас будем требовать хотя бы один ID — безопаснее.
// Если хочешь разрешить всем, закомментируй следующий блок.
// -------------------------
if (allowedUsers.size === 0) {
  console.warn(
    "ALLOWED_USERS пуст. Установи хотя бы один telegram_id в .env для безопасности."
  );
}
// -------------------------

// Запускаем бота в режиме polling (просто для локальной разработки)
const bot = new TelegramBot(TOKEN, { polling: true });

function isAllowed(userId) {
  if (allowedUsers.size === 0) return false; // пока требуем явный список
  return allowedUsers.has(String(userId));
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId)) {
    await bot.sendMessage(chatId, "⛔ У вас нет доступа к этому боту.");
    return;
  }

  const text = [
    `Привет, ${msg.from.first_name || ""}!`,
    "",
    "Доступные команды:",
    "/balance — показать текущие балансы по кошелькам",
    "/add — добавить транзакцию (вопросник) — пока не реализовано",
  ].join("\n");

  await bot.sendMessage(chatId, text);
});

// /balance
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId)) {
    await bot.sendMessage(chatId, "⛔ У вас нет доступа к этому боту.");
    return;
  }

  try {
    await bot.sendMessage(chatId, "⏳ Получаю балансы...");
    const balances = await getBalances(); // возвращает [{name, balance}, ...]
    if (!balances || balances.length === 0) {
      await bot.sendMessage(
        chatId,
        "Балансов не найдено (проверь лист Wallets)."
      );
      return;
    }

    // Форматируем сообщение
    const lines = balances.map((b) => {
      // формат числа с запятой и двумя знаками
      const val = typeof b.balance === "number" ? b.balance : Number(b.balance);
      const textVal = isNaN(val)
        ? "0"
        : val.toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
      return `• ${b.name}: ${textVal}`;
    });

    const resp = ["💼 Текущие балансы:", ...lines].join("\n");
    await bot.sendMessage(chatId, resp);
  } catch (err) {
    console.error("Ошибка /balance:", err);
    await bot.sendMessage(
      chatId,
      `Ошибка при получении балансов: ${err.message || err}`
    );
  }
});

// Логирование старта
bot.on("polling_error", (err) => {
  console.error("Polling error:", err);
});

//add
const userStates = new Map();
// структура: userStates.set(userId, { step: "amount", data: {} })

// Список категорий (пока хардкодим)
const categories = [
  "зп Сергей",
  "зп Аня",
  "аренда гараж",
  "продукты",
  "машина - обслуживание",
  "машина - топливо",
  "транспорт",
  "школа",
  "вкусняшки",
  "жку",
  "продажа",
  "перевод",
  "Даша",
  "помощь",
  "еда вне дома",
  "одежда и обувь",
  "развлечения",
  "услуги",
  "дом",
  "медицина",
  "хозтовары",
  "косметика",
  "кешбек",
  "подарки",
];

// Список кошельков (пока хардкодим)
const wallets = [
  "наличные Сергей",
  "наличные Аня",
  "МТБ Сергей",
  "МТБ Аня",
  "статусбанк",
  "халва",
  "альфа кредит",
  "копилка",
];

// /add
bot.onText(/\/add/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId)) {
    await bot.sendMessage(chatId, "⛔ У вас нет доступа к этому боту.");
    return;
  }

  userStates.set(userId, { step: "amount", data: {} });
  await bot.sendMessage(chatId, "Введите сумму транзакции (например: 123.45):");
});

// Общий обработчик текстов (для шагов вопросника)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  // если нет состояния для пользователя — игнорируем
  if (!userStates.has(userId)) return;

  const state = userStates.get(userId);

  // если это команда (начинается с /), игнорируем, чтобы не ломать диалог
  if (msg.text.startsWith("/")) return;

  switch (state.step) {
    case "amount":
      {
        const val = msg.text.replace(",", ".").trim();
        const num = parseFloat(val);
        if (isNaN(num)) {
          await bot.sendMessage(chatId, "❌ Введите число, например 123.45");
          return;
        }
        state.data.amount = num;
        state.step = "category";

        const opts = {
          reply_markup: {
            keyboard: categories.map((c) => [c]),
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        };
        await bot.sendMessage(chatId, "Выберите категорию:", opts);
      }
      break;

    case "category":
      {
        const cat = msg.text.trim();
        if (!categories.includes(cat)) {
          await bot.sendMessage(
            chatId,
            "❌ Неверная категория. Выберите из списка."
          );
          return;
        }
        state.data.category = cat;
        state.step = "wallet";

        const opts = {
          reply_markup: {
            keyboard: wallets.map((w) => [w]),
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        };
        await bot.sendMessage(chatId, "Выберите кошелёк:", opts);
      }
      break;

    case "wallet":
      {
        const wal = msg.text.trim();
        if (!wallets.includes(wal)) {
          await bot.sendMessage(
            chatId,
            "❌ Неверный кошелёк. Выберите из списка."
          );
          return;
        }
        state.data.wallet = wal;
        state.step = "date";
        await bot.sendMessage(chatId, "Введите дату (ДД-ММ-ГГГГ):", {
          reply_markup: { remove_keyboard: true },
        });
      }
      break;

    case "date":
      {
        const parts = msg.text.trim().split("-");
        if (parts.length !== 3) {
          await bot.sendMessage(chatId, "❌ Формат даты: ДД-ММ-ГГГГ");
          return;
        }
        const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10));
        const dt = new Date(yyyy, mm - 1, dd);
        if (isNaN(dt.getTime())) {
          await bot.sendMessage(
            chatId,
            "❌ Неверная дата. Попробуйте ещё раз."
          );
          return;
        }
        state.data.date = dt.toISOString().split("T")[0]; // формат YYYY-MM-DD
        state.step = "note";
        await bot.sendMessage(chatId, "Введите примечание:");
      }
      break;

    case "note":
      {
        state.data.note = msg.text.trim();

        // добавляем в таблицу
        try {
          await appendTransaction(state.data);
          await bot.sendMessage(chatId, "✅ Транзакция добавлена!");
        } catch (err) {
          console.error("Ошибка записи:", err);
          await bot.sendMessage(chatId, "❌ Ошибка записи в таблицу.");
        }

        // очищаем состояние
        userStates.delete(userId);
      }
      break;
  }
});

console.log("Бот запущен. Ожидает команд...");
