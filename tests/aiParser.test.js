import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiParser } from "../src/aiParser.js";

const NOW = new Date(2026, 10, 4); // Nov 4 2026

const CONFIG = {
  aiParsingEnabled: true,
  cloudflareAccountId: "account-id",
  cloudflareApiToken: "token",
  cloudflareAiModel: "@cf/meta/test-model",
};

const LOGGER = {
  info() {},
  warn() {},
  error() {},
};

function createFetch(payload, { status = 200, throws } = {}) {
  const calls = [];

  async function fetchImpl(url, init) {
    calls.push({ url, init });
    if (throws) throw throws;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  }

  return { fetchImpl, calls };
}

function modelResponse(response) {
  return {
    success: true,
    result: { response },
    errors: [],
    messages: [],
  };
}

function makeParser(fetchImpl, config = CONFIG) {
  return createAiParser({ config, logger: LOGGER, fetchImpl });
}

test("aiParser: успешно извлекает транзакцию и отправляет JSON Schema", async () => {
  const { fetchImpl, calls } = createFetch(
    modelResponse({
      is_transaction: true,
      type: "expense",
      amount: 250,
      category: "еда",
      wallet: "Наличные",
      date_text: "вчера",
      note: "кофе",
    })
  );

  const parser = makeParser(fetchImpl);
  const result = await parser.parse("кофе 250", {
    categories: ["Еда", "Транспорт"],
    wallets: ["Наличные", "Карта"],
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.amount, 250);
  assert.equal(result.draft.category, "Еда");
  assert.equal(result.draft.wallet, "Наличные");
  assert.equal(result.draft.note, "кофе");
  assert.equal("type" in result.draft, false);
  assert.deepEqual(
    [
      result.draft.date.getFullYear(),
      result.draft.date.getMonth() + 1,
      result.draft.date.getDate(),
    ],
    [2026, 11, 3]
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /accounts\/account-id\/ai\/run\/@cf\/meta\/test-model/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.properties.type, undefined);
  assert.equal(body.temperature, 0);
  assert.match(body.messages[0].content, /Еда/);
  assert.match(body.messages[0].content, /Наличные/);
  assert.equal(body.messages[1].content, "кофе 250");
});

test("aiParser: понимает JSON в markdown-обёртке", async () => {
  const { fetchImpl } = createFetch(
    modelResponse(
      '```json\n{"is_transaction":true,"type":"expense","amount":"120,50 ₽","category":"Еда","wallet":"","date_text":"9 октября","note":"обед"}\n```'
    )
  );

  const result = await makeParser(fetchImpl).parse("обед 120,50", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.amount, 120.5);
  assert.equal(result.draft.wallet, null);
  assert.deepEqual(
    [
      result.draft.date.getFullYear(),
      result.draft.date.getMonth() + 1,
      result.draft.date.getDate(),
    ],
    [2026, 10, 9]
  );
});

test("aiParser: пустая дата означает сегодня", async () => {
  const { fetchImpl } = createFetch(
    modelResponse({
      is_transaction: true,
      type: "expense",
      amount: 10,
      category: "Еда",
      wallet: "Карта",
      date_text: "",
      note: "",
    })
  );

  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    [
      result.draft.date.getFullYear(),
      result.draft.date.getMonth() + 1,
      result.draft.date.getDate(),
    ],
    [2026, 11, 4]
  );
});

test("aiParser: неизвестные категория и кошелёк возвращаются как null", async () => {
  const { fetchImpl } = createFetch(
    modelResponse({
      is_transaction: true,
      type: "expense",
      amount: 10,
      category: "Кафе",
      wallet: "Тинькофф",
      date_text: "",
      note: "",
    })
  );

  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.category, null);
  assert.equal(result.draft.wallet, null);
});

test("aiParser: не транзакция", async () => {
  const { fetchImpl } = createFetch(
    modelResponse({
      is_transaction: false,
      type: "unknown",
      amount: 0,
      category: "",
      wallet: "",
      date_text: "",
      note: "",
    })
  );

  const result = await makeParser(fetchImpl).parse("привет", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "not_transaction" });
});

test("aiParser: нулевая и отрицательная сумма отклоняются", async () => {
  for (const amount of [0, -10]) {
    const { fetchImpl } = createFetch(
      modelResponse({
        is_transaction: true,
        type: "expense",
        amount,
        category: "Еда",
        wallet: "Карта",
        date_text: "",
        note: "",
      })
    );

    const result = await makeParser(fetchImpl).parse("кофе", {
      categories: ["Еда"],
      wallets: ["Карта"],
      now: NOW,
    });

    assert.deepEqual(result, { ok: false, reason: "invalid_response" });
  }
});

test("aiParser: HTTP-ошибка", async () => {
  const { fetchImpl } = createFetch({}, { status: 500 });
  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "http_error" });
});

test("aiParser: success=false", async () => {
  const { fetchImpl } = createFetch({
    success: false,
    errors: [{ message: "quota exceeded" }],
  });
  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "http_error" });
});

test("aiParser: невалидный JSON ответа", async () => {
  const { fetchImpl } = createFetch(modelResponse("not a json"));
  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "invalid_response" });
});

test("aiParser: таймаут", async () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  const { fetchImpl } = createFetch(null, { throws: error });

  const result = await makeParser(fetchImpl).parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "timeout" });
});

test("aiParser: выключенный AI не делает запрос", async () => {
  const { fetchImpl, calls } = createFetch(modelResponse({}));
  const parser = makeParser(fetchImpl, {
    ...CONFIG,
    aiParsingEnabled: false,
  });

  const result = await parser.parse("кофе 10", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "disabled" });
  assert.equal(calls.length, 0);
});

test("aiParser: пустой текст не делает запрос", async () => {
  const { fetchImpl, calls } = createFetch(modelResponse({}));
  const result = await makeParser(fetchImpl).parse("   ", {
    categories: ["Еда"],
    wallets: ["Карта"],
    now: NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "not_transaction" });
  assert.equal(calls.length, 0);
});
