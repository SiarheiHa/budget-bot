import { applyAmountAction, parseAmountCallback } from "../amount.js";
import { parseCalendarCallback, resolveCalendarDate } from "../calendar.js";
import { MESSAGES } from "../messages.js";
import { checkAccess, parseAmount } from "../utils.js";
import {
  completeAmountStep,
  completeDateStep,
  renderAmountStep,
  showCalendarStep,
} from "./addHandler.js";
import { handleCancel } from "./cancelHandler.js";
import { handleAiCallback } from "./aiHandler.js";

function isStaleManualState(userState, step, messageId) {
  return !userState || userState.step !== step || userState.cardMessageId !== messageId;
}

export function registerCallbackHandler(bot, deps) {
  const { logger, config } = deps;

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat?.id ?? query.from?.id;
    const messageId = query.message?.message_id;
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

      if (data.startsWith("ai:")) {
        const result = await handleAiCallback(
          bot,
          deps,
          chatId,
          data,
          query.message?.message_id
        );
        const alertText = result?.stale
          ? MESSAGES.AI.STALE
          : result?.alert;
        await answer(
          alertText ? { text: alertText, show_alert: true } : undefined
        );
        return;
      }

      const amountAction = parseAmountCallback(data);
      if (amountAction) {
        const amountState = deps.state.get(chatId);
        if (isStaleManualState(amountState, "amount", messageId)) {
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
          () => renderAmountStep(bot, deps, chatId),
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
      if (isStaleManualState(userState, "date", messageId)) {
        await answer({
          text: MESSAGES.ADD_TRANSACTION.DATE_STALE,
          show_alert: true,
        });
        return;
      }

      if (parsed.type === "nav") {
        await answer();
        await showCalendarStep(bot, deps, chatId, {
          year: parsed.year,
          month: parsed.month,
        });
        return;
      }

      const date = resolveCalendarDate(parsed);
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
