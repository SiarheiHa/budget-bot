// Обработчик команды /add
// Реализует пошаговый диалог: бот задаёт вопросы, а ответы сохраняются в state.
// В конце — вызывает sheets.appendTransaction().

import {
  parseDateDDMMYYYY,
  parseAmount,
  formatDateToDisplay,
} from "../utils.js";

// Списки категорий и кошельков
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

export function registerAddHandler(bot, { sheets, state, logger }) {
  bot.onText(/^\/add$/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`/add от пользователя ${chatId}`);

    // Создаём состояние для пользователя
    state.set(chatId, { step: "date", data: {} });

    await bot.sendMessage(
      chatId,
      "Введите дату операции (в формате ДД.ММ.ГГГГ):"
    );
  });

  // Универсальный обработчик для всех сообщений — маршрутизируем по state
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // Если пользователь не в процессе добавления — выходим
    const userState = state.get(chatId);
    if (!userState) return;

    const text = msg.text?.trim();
    if (!text) return;

    // Пошаговый сценарий
    try {
      if (userState.step === "date") {
        const date = parseDateDDMMYYYY(text);
        if (!date) {
          await bot.sendMessage(
            chatId,
            "Неверный формат даты, попробуйте ещё раз (ДД.ММ.ГГГГ)."
          );
          return;
        }
        userState.data.date = formatDateToDisplay(date);
        userState.step = "amount";
        await bot.sendMessage(chatId, "Введите сумму:");
      } else if (userState.step === "amount") {
        const amount = parseAmount(text);
        if (amount === null) {
          await bot.sendMessage(
            chatId,
            "Неверная сумма, попробуйте ещё раз (например: 123.45)."
          );
          return;
        }
        userState.data.amount = amount;
        userState.step = "category";

        // Создаем клавиатуру с категориями
        const categoryKeyboard = {
          reply_markup: {
            keyboard: categories.map((cat) => [cat]),
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };

        await bot.sendMessage(chatId, "Выберите категорию:", categoryKeyboard);
      } else if (userState.step === "category") {
        // Проверяем, что выбрана существующая категория
        if (!categories.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите категорию из предложенных вариантов."
          );
          return;
        }

        userState.data.category = text;
        userState.step = "wallet";

        // Создаем клавиатуру с кошельками
        const walletKeyboard = {
          reply_markup: {
            keyboard: wallets.map((wallet) => [wallet]),
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };

        await bot.sendMessage(chatId, "Выберите кошелёк:", walletKeyboard);
      } else if (userState.step === "wallet") {
        // Проверяем, что выбран существующий кошелек
        if (!wallets.includes(text)) {
          await bot.sendMessage(
            chatId,
            "Пожалуйста, выберите кошелёк из предложенных вариантов."
          );
          return;
        }

        userState.data.wallet = text;
        userState.step = "note";

        // Убираем клавиатуру
        await bot.sendMessage(
          chatId,
          "Введите примечание (или отправьте '-' для пустого примечания):",
          { reply_markup: { remove_keyboard: true } }
        );
      } else if (userState.step === "note") {
        // Если пользователь отправил "-", сохраняем пустую строку
        userState.data.note = text === "-" ? "" : text;

        // Всё собрано — сохраняем
        await sheets.appendTransaction(userState.data);
        logger.info("Добавлена транзакция", userState.data);

        await bot.sendMessage(chatId, "✅ Запись добавлена в таблицу!");

        // Чистим state
        state.del(chatId);
      }
    } catch (err) {
      logger.error("Ошибка в сценарии /add", err);
      await bot.sendMessage(chatId, "Произошла ошибка при добавлении ❌");
      state.del(chatId);
    }
  });
}
