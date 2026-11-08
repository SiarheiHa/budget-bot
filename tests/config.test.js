import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig } from "../src/configBuilder.js";

const BASE_ENV = {
  BOT_TOKEN: "test-token",
  SPREADSHEET_ID: "test-sheet",
  ALLOWED_USERS: "1, 2 ,",
};

test("config: собирает базовые значения", () => {
  const config = buildConfig(BASE_ENV);

  assert.equal(config.botToken, "test-token");
  assert.equal(config.spreadsheetId, "test-sheet");
  assert.deepEqual(config.allowedUsers, ["1", "2"]);
  assert.equal(config.googleCredentialsB64, null);
  assert.equal(
    config.cloudflareAiModel,
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  );
  assert.equal(config.aiParsingEnabled, false);
});

test("config: требует BOT_TOKEN и SPREADSHEET_ID", () => {
  assert.throws(
    () => buildConfig({ ...BASE_ENV, BOT_TOKEN: "" }),
    /BOT_TOKEN/
  );
  assert.throws(
    () => buildConfig({ ...BASE_ENV, SPREADSHEET_ID: "" }),
    /SPREADSHEET_ID/
  );
});

test("config: требует непустой ALLOWED_USERS", () => {
  assert.throws(
    () => buildConfig({ ...BASE_ENV, ALLOWED_USERS: " , " }),
    /ALLOWED_USERS/
  );
});

test("config: AI включается только при наличии ключей", () => {
  const withKeys = buildConfig({
    ...BASE_ENV,
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
  });
  assert.equal(withKeys.aiParsingEnabled, true);

  const disabled = buildConfig({
    ...BASE_ENV,
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
    AI_PARSING_ENABLED: "false",
  });
  assert.equal(disabled.aiParsingEnabled, false);
});
