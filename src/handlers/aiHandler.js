import { formatAmountValue } from "../amount.js";
import {
  createAiConfirmKeyboard,
  createCancelableKeyboard,
  showMainKeyboard,
} from "../keyboards.js";
import { MESSAGES } from "../messages.js";
import { isUserStateExpired } from "../state.js";
import {
  checkAccess,
  formatDateToDisplay,
  removeInlineKeyboard,
} from "../utils.js";
import { handleAddCommand } from "./addHandler.js";

function buildAiSummary(draft) {
  const typeLabel =
    draft.type === "income" ? MESSAGES.AI.INCOME : MESSAGES.AI.EXPENSE;

  return [
    MESSAGES.AI.SUMMARY_TITLE,
    "",
    `${typeLabel}: ${formatAmountValue(draft.amount)}`,
    `📅 Дата: ${formatDateToDisplay(draft.date)}`,
    `📂 Категория: ${draft.category}`,
    `👛 Кошелёк: ${draft.wallet}`,
    `📝 Примечание: ${draft.note || MESSAGES.AI.NO_NOTE}`,
  ].join("\n");
}

async function showAiSummary(bot, deps, chatId, draft) {
  const current = deps.state.get(chatId);
  if (current?.aiMessageId) {
    await removeInlineKeyboard(bot, deps.logger, chatId, current.aiMessageId);
  }

  const sent = await bot.sendMessage(
    chatId,
    buildAiSummary(draft),
    createAiConfirmKeyboard()
  );

  deps.state.update(chatId, {
    aiStep: "confirm",
    aiDraft: draft,
    aiMessageId: sent.message_id,
  });
}

async function promptMissing(bot, deps, chatId, draft, categories, wallets) {
  if (!draft.category) {
    deps.state.update(chatId, {
      aiStep: "category",
      aiDraft: draft,
      categories,
      wallets,
    });
    await bot.sendMessage(
      chatId,
      MESSAGES.AI.SELECT_CATEGORY,
      createCancelableKeyboard(categories || [])
    );
    return;
  }

  if (!draft.wallet) {
    deps.state.update(chatId, {
      aiStep: "wallet",
      aiDraft: draft,
      categories,
      wallets,
    });
    await bot.sendMessage(
      chatId,
      MESSAGES.AI.SELECT_WALLET,
      createCancelableKeyboard(wallets || [])
    );
    return;
  }

  await showAiSummary(bot, deps, chatId, draft);
}

async function handlePendingText(bot, deps, chatId, existing, text) {
  const draft = existing.aiDraft;
  if (!draft) return;

  if (existing.aiStep === "category") {
    if (!existing.categories?.includes(text)) {
      await bot.sendMessage(
        chatId,
        MESSAGES.AI.SELECT_CATEGORY,
        createCancelableKeyboard(existing.categories || [])
      );
      return;
    }

    await promptMissing(
      bot,
      deps,
      chatId,
      { ...draft, category: text },
      existing.categories,
      existing.wallets
    );
    return;
  }

  if (existing.aiStep === "wallet") {
    if (!existing.wallets?.includes(text)) {
      await bot.sendMessage(
        chatId,
        MESSAGES.AI.SELECT_WALLET,
        createCancelableKeyboard(existing.wallets || [])
      );
      return;
    }

    await promptMissing(
      bot,
      deps,
      chatId,
      { ...draft, wallet: text },
      existing.categories,
      existing.wallets
    );
    return;
  }

  if (existing.aiStep === "confirm") {
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
    await handlePendingText(bot, deps, chatId, existing, text);
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

    const [categories, wallets] = await Promise.all([
      deps.sheets.getCategories(),
      deps.sheets.getWallets(),
    ]);

    const result = await deps.ai.parse(text, {
      categories,
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

    deps.state.set(chatId, {
      aiStep: null,
      aiDraft: result.draft,
      categories,
      wallets,
    });

    await promptMissing(bot, deps, chatId, result.draft, categories, wallets);
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

  if (
    !draft ||
    userState.aiStep !== "confirm" ||
    !draft.category ||
    !draft.wallet
  ) {
    return "stale";
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
  const draft = userState?.aiDraft;
  if (!draft) return false;

  await removeInlineKeyboard(bot, deps.logger, chatId, userState.aiMessageId);
  deps.state.del(chatId);
  await handleAddCommand(
    bot,
    deps,
    { chat: { id: chatId } },
    { prefill: draft }
  );
  return true;
}
