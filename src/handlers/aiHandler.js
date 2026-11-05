import {
  applyAmountAction,
  formatAmountDraft,
  formatAmountValue,
  parseAmountCallback,
} from "../amount.js";
import {
  buildCalendarText,
  parseCalendarCallback,
  resolveCalendarDate,
} from "../calendar.js";
import {
  createAiCardKeyboard,
  createAiConfirmKeyboard,
  createAiNoteKeyboard,
  createAiPickKeyboard,
  createAmountKeyboard,
  createCalendarKeyboard,
  showMainKeyboard,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import { isUserStateExpired } from "../state.js";
import {
  checkAccess,
  formatDateToDisplay,
  parseAmount,
  parseDateDDMMYYYY,
  removeInlineKeyboard,
} from "../utils.js";
import { handleCancel } from "./cancelHandler.js";

const AI_AMOUNT_PREFIX = "ai:amt";
const AI_CALENDAR_PREFIX = "ai:cal";
const MAX_NOTE_LENGTH = 200;

function getErrorDescription(err) {
  return err?.response?.body?.description || err?.message || "";
}

function isNotModifiedError(err) {
  return getErrorDescription(err).includes("message is not modified");
}

function isMessageNotFoundError(err) {
  const description = getErrorDescription(err);
  return (
    description.includes("message to edit not found") ||
    description.includes("message not found")
  );
}

function getTypeLabel(type) {
  if (type === "income") return MESSAGES.AI.INCOME;
  if (type === "expense") return MESSAGES.AI.EXPENSE;
  if (type === "transfer") return MESSAGES.AI.TRANSFER;
  return MESSAGES.AI.UNKNOWN;
}

function findCategory(categories, name) {
  return (categories || []).find((category) => category.name === name) || null;
}

function deriveType(categories, categoryName) {
  return findCategory(categories, categoryName)?.type || null;
}

function buildAiCardText(draft) {
  return [
    MESSAGES.AI.SUMMARY_TITLE,
    "",
    `${MESSAGES.AI.TYPE_LABEL}: ${getTypeLabel(draft.type)}`,
    `${MESSAGES.AI.AMOUNT_LABEL}: ${formatAmountValue(draft.amount)}`,
    `${MESSAGES.AI.DATE_LABEL}: ${formatDateToDisplay(draft.date)}`,
    `${MESSAGES.AI.CATEGORY_LABEL}: ${
      draft.category || MESSAGES.AI.NOT_SET_CATEGORY
    }`,
    `${MESSAGES.AI.WALLET_LABEL}: ${
      draft.wallet || MESSAGES.AI.NOT_SET_WALLET
    }`,
    `${MESSAGES.AI.NOTE_LABEL}: ${draft.note || MESSAGES.AI.NO_NOTE}`,
  ].join("\n");
}

async function renderAiMessage(bot, deps, chatId, text, replyMarkup) {
  const current = deps.state.peek
    ? deps.state.peek(chatId)
    : deps.state.get(chatId);

  if (current?.aiMessageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: current.aiMessageId,
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      if (isNotModifiedError(err)) return;
      if (!isMessageNotFoundError(err)) {
        deps.logger?.warn?.(`Не удалось обновить AI-сообщение: ${err.message}`);
      }
    }
  }

  const sent = await bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
  deps.state.update(chatId, { aiMessageId: sent.message_id });
}

async function renderAiCard(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft) return false;

  if (deps.amountUi) {
    await deps.amountUi.abort(chatId);
  }

  const draft = {
    ...userState.aiDraft,
    type: deriveType(userState.categories, userState.aiDraft.category),
  };

  deps.state.update(chatId, {
    aiStep: "edit",
    aiEditField: null,
    aiAmountDraft: "",
    aiDraft: draft,
  });

  await renderAiMessage(
    bot,
    deps,
    chatId,
    buildAiCardText(draft),
    createAiCardKeyboard().reply_markup
  );
  return true;
}

async function renderAiAmountEditor(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (
    !userState?.aiDraft ||
    userState.aiStep !== "edit" ||
    userState.aiEditField !== "amount"
  ) {
    return;
  }

  const text = [
    MESSAGES.ADD_TRANSACTION.AMOUNT_PROMPT,
    "",
    `${MESSAGES.ADD_TRANSACTION.AMOUNT_SELECTED} ${formatAmountDraft(
      userState.aiAmountDraft
    )}`,
  ].join("\n");

  await renderAiMessage(
    bot,
    deps,
    chatId,
    text,
    createAmountKeyboard({
      prefix: AI_AMOUNT_PREFIX,
      allowSign: false,
      footer: [
        [
          { text: "Назад", callback_data: "ai:back" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    }).reply_markup
  );
}

async function renderAiDateEditor(bot, deps, chatId, year, month) {
  const userState = deps.state.get(chatId);
  if (
    !userState?.aiDraft ||
    userState.aiStep !== "edit" ||
    userState.aiEditField !== "date"
  ) {
    return;
  }

  const text = [
    MESSAGES.ADD_TRANSACTION.DATE_PROMPT,
    "",
    buildCalendarText(year, month),
  ].join("\n");

  await renderAiMessage(
    bot,
    deps,
    chatId,
    text,
    createCalendarKeyboard(year, month, {
      prefix: AI_CALENDAR_PREFIX,
      footer: [
        [
          { text: "Назад", callback_data: "ai:back" },
          { text: "❌ Отмена", callback_data: "ai:cancel" },
        ],
      ],
    }).reply_markup
  );
}

async function renderAiPickEditor(bot, deps, chatId, field) {
  const userState = deps.state.get(chatId);
  if (
    !userState?.aiDraft ||
    userState.aiStep !== "edit" ||
    userState.aiEditField !== field
  ) {
    return;
  }

  const categories = userState.categories || [];
  const wallets = userState.wallets || [];
  const items =
    field === "category" ? categories.map((category) => category.name) : wallets;
  const prompt =
    field === "category" ? MESSAGES.AI.SELECT_CATEGORY : MESSAGES.AI.SELECT_WALLET;
  const text = items.length
    ? prompt
    : `${prompt}\n\n${
        field === "category"
          ? MESSAGES.AI.NO_CATEGORIES
          : MESSAGES.AI.NO_WALLETS
      }`;

  await renderAiMessage(
    bot,
    deps,
    chatId,
    text,
    createAiPickKeyboard(field, items).reply_markup
  );
}

async function renderAiNoteEditor(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (
    !userState?.aiDraft ||
    userState.aiStep !== "edit" ||
    userState.aiEditField !== "note"
  ) {
    return;
  }

  await renderAiMessage(
    bot,
    deps,
    chatId,
    MESSAGES.AI.NOTE_PROMPT,
    createAiNoteKeyboard().reply_markup
  );
}

async function showAiSummary(bot, deps, chatId, draft) {
  const current = deps.state.get(chatId);
  if (current?.aiMessageId) {
    await removeInlineKeyboard(bot, deps.logger, chatId, current.aiMessageId);
  }

  const sent = await bot.sendMessage(
    chatId,
    buildAiCardText(draft),
    createAiConfirmKeyboard()
  );

  deps.state.update(chatId, {
    aiStep: "confirm",
    aiEditField: null,
    aiAmountDraft: "",
    aiDraft: draft,
    aiMessageId: sent.message_id,
  });
}

async function showAiAmountEditor(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft) return false;

  const amount = userState.aiDraft.amount;
  deps.state.update(chatId, {
    aiStep: "edit",
    aiEditField: "amount",
    aiAmountDraft: Number.isFinite(amount)
      ? String(amount).replace(".", ",")
      : "",
  });
  await renderAiAmountEditor(bot, deps, chatId);
  return true;
}

async function showAiDateEditor(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft) return false;

  const date =
    userState.aiDraft.date instanceof Date &&
    !Number.isNaN(userState.aiDraft.date.getTime())
      ? userState.aiDraft.date
      : new Date();

  deps.state.update(chatId, {
    aiStep: "edit",
    aiEditField: "date",
  });
  await renderAiDateEditor(
    bot,
    deps,
    chatId,
    date.getFullYear(),
    date.getMonth() + 1
  );
  return true;
}

async function showAiPickEditor(bot, deps, chatId, field) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft) return false;

  deps.state.update(chatId, {
    aiStep: "edit",
    aiEditField: field,
  });
  await renderAiPickEditor(bot, deps, chatId, field);
  return true;
}

async function showAiNoteEditor(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft) return false;

  deps.state.update(chatId, {
    aiStep: "edit",
    aiEditField: "note",
  });
  await renderAiNoteEditor(bot, deps, chatId);
  return true;
}

async function showInitialAiDraft(bot, deps, chatId, draft) {
  if (!draft.category || !draft.wallet) {
    await renderAiCard(bot, deps, chatId);
    return;
  }

  await showAiSummary(bot, deps, chatId, draft);
}

async function handleEditText(bot, deps, chatId, userState, text) {
  const field = userState.aiEditField;
  const draft = userState.aiDraft;

  if (!field) {
    await bot.sendMessage(chatId, MESSAGES.AI.PENDING_CONFIRMATION);
    return;
  }

  if (field === "amount") {
    if (deps.amountUi) {
      await deps.amountUi.abort(chatId);
    }

    const amount = parseAmount(text);
    if (Number.isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.AMOUNT_INVALID);
      await renderAiAmountEditor(bot, deps, chatId);
      return;
    }

    deps.state.update(chatId, {
      aiDraft: { ...draft, amount },
      aiEditField: null,
      aiAmountDraft: "",
    });
    await renderAiCard(bot, deps, chatId);
    return;
  }

  if (field === "date") {
    const date = parseDateDDMMYYYY(text);
    if (!date) {
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.DATE_INVALID);
      const currentDate =
        draft.date instanceof Date && !Number.isNaN(draft.date.getTime())
          ? draft.date
          : new Date();
      await renderAiDateEditor(
        bot,
        deps,
        chatId,
        currentDate.getFullYear(),
        currentDate.getMonth() + 1
      );
      return;
    }

    deps.state.update(chatId, {
      aiDraft: { ...draft, date },
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
    return;
  }

  if (field === "category") {
    const category = findCategory(userState.categories, text);
    if (!category || (category.type !== "income" && category.type !== "expense")) {
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.CATEGORY_INVALID);
      await renderAiPickEditor(bot, deps, chatId, "category");
      return;
    }

    deps.state.update(chatId, {
      aiDraft: { ...draft, category: category.name, type: category.type },
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
    return;
  }

  if (field === "wallet") {
    if (!userState.wallets?.includes(text)) {
      await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.WALLET_INVALID);
      await renderAiPickEditor(bot, deps, chatId, "wallet");
      return;
    }

    deps.state.update(chatId, {
      aiDraft: { ...draft, wallet: text },
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
    return;
  }

  if (field === "note") {
    const note = text === "-" ? "" : text.slice(0, MAX_NOTE_LENGTH);
    deps.state.update(chatId, {
      aiDraft: { ...draft, note },
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
  }
}

async function handleAiText(bot, deps, chatId, userState, text) {
  if (userState.aiStep === "edit") {
    await handleEditText(bot, deps, chatId, userState, text);
    return;
  }

  if (userState.aiStep === "confirm") {
    await bot.sendMessage(chatId, MESSAGES.AI.PENDING_CONFIRMATION);
  }
}

async function handleFreeText(bot, deps, msg) {
  const chatId = msg.chat.id;
  if (!checkAccess(chatId, deps.config)) return;

  const text = msg.text?.trim();
  if (!text) return;

  if (
    text.startsWith("/") ||
    text === "❌ Отмена" ||
    text === "Добавить транзакцию" ||
    text === "Показать баланс"
  ) {
    return;
  }

  const existing = deps.state.peek
    ? deps.state.peek(chatId)
    : deps.state.get(chatId);

  if (existing) {
    if (!existing.aiStep || isUserStateExpired(existing)) return;
    await handleAiText(bot, deps, chatId, existing, text);
    return;
  }

  if (!deps.config.aiParsingEnabled) return;

  const inFlight = deps.aiInFlight;
  if (inFlight?.has(chatId)) return;
  inFlight?.add(chatId);

  try {
    try {
      await bot.sendChatAction(chatId, "typing");
    } catch {
      // индикатор набора не критичен
    }

    const [categoryRows, wallets] = await Promise.all([
      deps.sheets.getCategories(),
      deps.sheets.getWallets(),
    ]);

    const categories = categoryRows.filter(
      (category) => category.type === "income" || category.type === "expense"
    );
    const categoryNames = categories.map((category) => category.name);

    const result = await deps.ai.parse(text, {
      categories: categoryNames,
      wallets,
      now: new Date(),
    });

    if (!result.ok) {
      if (result.reason === "not_transaction") {
        await bot.sendMessage(chatId, MESSAGES.AI.NOT_RECOGNIZED);
      } else if (result.reason !== "disabled") {
        await bot.sendMessage(chatId, MESSAGES.AI.ERROR);
      }
      return;
    }

    const draft = {
      ...result.draft,
      type: deriveType(categories, result.draft.category),
    };

    deps.state.set(chatId, {
      aiStep: null,
      aiEditField: null,
      aiAmountDraft: "",
      aiDraft: draft,
      categories,
      wallets,
    });

    await showInitialAiDraft(bot, deps, chatId, draft);
  } catch (err) {
    deps.logger?.error?.(`AI handler error: ${err?.message || err}`);
    await bot.sendMessage(chatId, MESSAGES.AI.ERROR);
  } finally {
    inFlight?.delete(chatId);
  }
}

export function registerAiHandler(bot, deps) {
  bot.on("message", async (msg) => {
    try {
      await handleFreeText(bot, deps, msg);
    } catch (err) {
      deps.logger?.error?.(`AI message handler failed: ${err?.message || err}`);
    }
  });
}

export async function confirmAiDraft(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  const draft = userState?.aiDraft;

  if (!draft) return "stale";

  const canSave =
    userState.aiStep === "confirm" ||
    (userState.aiStep === "edit" && !userState.aiEditField);
  if (!canSave) return "stale";

  if (
    !draft.category ||
    !draft.wallet ||
    !Number.isFinite(draft.amount) ||
    draft.amount <= 0
  ) {
    return "incomplete";
  }

  try {
    await deps.sheets.appendTransaction({
      date: formatDateToDisplay(draft.date),
      amount: draft.amount,
      category: draft.category,
      wallet: draft.wallet,
      note: draft.note || "",
    });
    deps.logger?.info?.("AI transaction added", {
      chatId,
      amount: draft.amount,
      category: draft.category,
      wallet: draft.wallet,
    });

    await removeInlineKeyboard(bot, deps.logger, chatId, userState.aiMessageId);
    deps.state.del(chatId);
    await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.SUCCESS);
    await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    return "saved";
  } catch (err) {
    deps.logger?.error?.(`AI save failed: ${err?.message || err}`);
    await removeInlineKeyboard(bot, deps.logger, chatId, userState.aiMessageId);
    deps.state.del(chatId);
    await bot.sendMessage(chatId, MESSAGES.ADD_TRANSACTION.ERROR);
    await showMainKeyboard(bot, chatId, MESSAGES.COMMON.WHAT_NEXT);
    return "failed";
  }
}

export async function editAiDraft(bot, deps, chatId) {
  const userState = deps.state.get(chatId);
  if (!userState?.aiDraft || userState.aiStep !== "confirm") return false;

  return renderAiCard(bot, deps, chatId);
}

export async function handleAiCallback(bot, deps, chatId, data, messageId) {
  const userState = deps.state.get(chatId);
  if (
    !userState?.aiStep ||
    !userState.aiDraft ||
    userState.aiMessageId !== messageId
  ) {
    return { stale: true };
  }

  if (data === "ai:cancel") {
    await handleCancel(bot, deps, { chat: { id: chatId } });
    return {};
  }

  if (data === "ai:confirm") {
    const result = await confirmAiDraft(bot, deps, chatId);
    if (result === "stale") return { stale: true };
    if (result === "incomplete") {
      return { alert: MESSAGES.AI.SELECT_REQUIRED };
    }
    return {};
  }

  if (data === "ai:edit") {
    const handled = await editAiDraft(bot, deps, chatId);
    return handled ? {} : { stale: true };
  }

  if (data === "ai:back") {
    if (userState.aiStep !== "edit" || !userState.aiEditField) {
      return { stale: true };
    }
    await renderAiCard(bot, deps, chatId);
    return {};
  }

  if (data.startsWith("ai:field:")) {
    if (userState.aiStep !== "edit" || userState.aiEditField) {
      return { stale: true };
    }

    const field = data.slice("ai:field:".length);
    if (field === "amount") {
      await showAiAmountEditor(bot, deps, chatId);
      return {};
    }
    if (field === "date") {
      await showAiDateEditor(bot, deps, chatId);
      return {};
    }
    if (field === "category" || field === "wallet") {
      await showAiPickEditor(bot, deps, chatId, field);
      return {};
    }
    if (field === "note") {
      await showAiNoteEditor(bot, deps, chatId);
      return {};
    }
    return { stale: true };
  }

  const pickMatch = /^ai:pick:(category|wallet):(\d+)$/.exec(data);
  if (pickMatch) {
    const field = pickMatch[1];
    if (
      userState.aiStep !== "edit" ||
      userState.aiEditField !== field
    ) {
      return { stale: true };
    }

    const index = Number(pickMatch[2]);
    const items =
      field === "category" ? userState.categories || [] : userState.wallets || [];
    const item = items[index];
    if (!item) return { stale: true };

    const draft =
      field === "category"
        ? { ...userState.aiDraft, category: item.name, type: item.type || null }
        : { ...userState.aiDraft, wallet: item };

    deps.state.update(chatId, {
      aiDraft: draft,
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
    return {};
  }

  const amountAction = parseAmountCallback(data, AI_AMOUNT_PREFIX);
  if (amountAction) {
    if (
      userState.aiStep !== "edit" ||
      userState.aiEditField !== "amount"
    ) {
      return { stale: true };
    }

    if (amountAction.type === "confirm") {
      const amount = parseAmount(userState.aiAmountDraft || "");
      if (Number.isNaN(amount) || amount <= 0) {
        return { alert: MESSAGES.ADD_TRANSACTION.AMOUNT_EMPTY };
      }

      deps.state.update(chatId, {
        aiDraft: { ...userState.aiDraft, amount },
        aiEditField: null,
        aiAmountDraft: "",
      });
      await renderAiCard(bot, deps, chatId);
      return {};
    }

    const currentDraft = userState.aiAmountDraft || "";
    const nextDraft = applyAmountAction(currentDraft, amountAction);
    if (nextDraft === currentDraft) {
      return amountAction.type === "digit"
        ? { alert: MESSAGES.ADD_TRANSACTION.AMOUNT_LIMIT }
        : {};
    }

    deps.state.update(chatId, { aiAmountDraft: nextDraft });
    if (deps.amountUi) {
      deps.amountUi.schedule(
        chatId,
        () => renderAiAmountEditor(bot, deps, chatId),
        {
          onError: (err) =>
            deps.logger?.warn?.(
              `Не удалось обновить AI-сумму: ${err.message}`
            ),
        }
      );
    } else {
      await renderAiAmountEditor(bot, deps, chatId);
    }
    return {};
  }

  const calendarAction = parseCalendarCallback(data, AI_CALENDAR_PREFIX);
  if (calendarAction) {
    if (calendarAction.type === "noop") return {};
    if (
      userState.aiStep !== "edit" ||
      userState.aiEditField !== "date"
    ) {
      return { stale: true };
    }

    if (calendarAction.type === "nav") {
      await renderAiDateEditor(
        bot,
        deps,
        chatId,
        calendarAction.year,
        calendarAction.month
      );
      return {};
    }

    const date = resolveCalendarDate(calendarAction);
    deps.state.update(chatId, {
      aiDraft: { ...userState.aiDraft, date },
      aiEditField: null,
    });
    await renderAiCard(bot, deps, chatId);
    return {};
  }

  return {};
}
