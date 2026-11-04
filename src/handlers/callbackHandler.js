import { applyAmountAction, parseAmountCallback } from "../amount.js";
import { buildCalendarText, parseCalendarCallback } from "../calendar.js";
import { createAmountKeyboard, createCalendarKeyboard } from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import { checkAccess, parseAmount } from "../utils.js";
import {
  buildAmountText,
  completeAmountStep,
  completeDateStep,
} from "./addHandler.js";
import { handleCancel } from "./cancelHandler.js";

function resolveDate(parsed) {
  if (parsed.type === "today" || parsed.type === "yesterday") {
    const now = new Date();
    const dayOffset = parsed.type === "yesterday" ? -1 : 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  }

  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

function isNotModifiedError(err) {
  const description = err?.response?.body?.description || err?.message || "";
  return description.includes("message is not modified");
}

async function editCalendarMessage(bot, deps, chatId, userState, year, month) {
  const { logger } = deps;
  const text =
    MESSAGES.ADD_TRANSACTION.DATE_PROMPT +
    "\n\n" +
    buildCalendarText(year, month);
  const replyMarkup = createCalendarKeyboard(year, month).reply_markup;

  if (userState.calendarMessageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: userState.calendarMessageId,
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      if (isNotModifiedError(err)) return;
      logger.warn(`Не удалось обновить календарь: ${err.message}`);
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  deps.state.update(chatId, { calendarMessageId: sent.message_id });
}

function isMessageNotFoundError(err) {
  const description = err?.response?.body?.description || err?.message || "";
  return description.includes("message to edit not found");
}

async function renderAmountMessage(bot, deps, chatId) {
  const state = deps.state.get(chatId);
  if (!state || state.step !== "amount") return;

  const draft = state.amountDraft || "";
  const text = buildAmountText(draft);
  const replyMarkup = createAmountKeyboard().reply_markup;

  deps.logger.debug?.(`amount render start draft="${draft}"`);

  if (state.amountMessageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: state.amountMessageId,
        reply_markup: replyMarkup,
      });
      deps.logger.debug?.(`amount render done draft="${draft}"`);
      return;
    } catch (err) {
      if (!isMessageNotFoundError(err)) throw err;
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  deps.state.update(chatId, { amountMessageId: sent.message_id });
}

export function registerCallbackHandler(bot, deps) {
  const { logger, config } = deps;

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat?.id ?? query.from?.id;
    const data = query.data || "";
    logger.debug?.(`callback_query id=${query.id} data="${data}"`);
    let answered = false;

    const answer = async (options) => {
      if (answered) return;
      answered = true;
      try {
        await bot.answerCallbackQuery(query.id, options);
      } catch (err) {
        logger.warn(`Не удалось ответить на callback: ${err.message}`);
      }
    };

    try {
      if (!chatId) {
        await answer();
        return;
      }

      if (!checkAccess(chatId, config)) {
        logger.warn(`Доступ запрещен для callback пользователя: ${chatId}`);
        await answer({
          text: MESSAGES.COMMON.ACCESS_DENIED,
          show_alert: true,
        });
        return;
      }

      if (data === "v1:cancel") {
        logger.debug?.(`cancel chat=${chatId}`);
        const cancellation = handleCancel(bot, deps, { chat: { id: chatId } });
        await answer();
        await cancellation;
        return;
      }

      const amountAction = parseAmountCallback(data);
      if (amountAction) {
        const amountState = deps.state.get(chatId);
        if (!amountState || amountState.step !== "amount") {
          await answer({
            text: MESSAGES.ADD_TRANSACTION.AMOUNT_STALE,
            show_alert: true,
          });
          return;
        }

        logger.debug?.(
          `amount action=${amountAction.type} before="${
            amountState.amountDraft || ""
          }"`
        );

        if (amountAction.type === "confirm") {
          const amount = parseAmount(amountState.amountDraft || "");
          if (Number.isNaN(amount) || amount === 0) {
            await answer({
              text: MESSAGES.ADD_TRANSACTION.AMOUNT_EMPTY,
              show_alert: true,
            });
            return;
          }

          const completion = completeAmountStep(
            bot,
            deps,
            chatId,
            amountState,
            amount
          );
          await answer();
          await completion;
          return;
        }

        const currentDraft = amountState.amountDraft || "";
        const nextDraft = applyAmountAction(currentDraft, amountAction);

        if (nextDraft === currentDraft) {
          await answer(
            amountAction.type === "digit"
              ? {
                  text: MESSAGES.ADD_TRANSACTION.AMOUNT_LIMIT,
                  show_alert: true,
                }
              : undefined
          );
          return;
        }

        deps.state.update(chatId, { amountDraft: nextDraft });
        logger.debug?.(`amount action=${amountAction.type} after="${nextDraft}"`);
        deps.amountUi.schedule(
          chatId,
          () => renderAmountMessage(bot, deps, chatId),
          {
            onError: (err) =>
              logger.warn(
                `Не удалось обновить сообщение суммы: ${err.message}`
              ),
          }
        );
        await answer();
        return;
      }

      const parsed = parseCalendarCallback(data);
      if (!parsed || parsed.type === "noop") {
        await answer();
        return;
      }

      const userState = deps.state.get(chatId);
      if (!userState || userState.step !== "date") {
        await answer({
          text: MESSAGES.ADD_TRANSACTION.DATE_STALE,
          show_alert: true,
        });
        return;
      }

      if (parsed.type === "nav") {
        await answer();
        await editCalendarMessage(
          bot,
          deps,
          chatId,
          userState,
          parsed.year,
          parsed.month
        );
        return;
      }

      const date = resolveDate(parsed);
      await answer();
      await completeDateStep(bot, deps, chatId, userState, date);
    } catch (err) {
      logger.error(`Ошибка обработки callback: ${err.message}`, err);
      await answer({
        text: MESSAGES.COMMON.ERROR,
        show_alert: true,
      });
    }
  });
}
