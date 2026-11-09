import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createShutdownHandler,
  registerShutdownHandlers,
} from "../src/shutdown.js";

function createLogger() {
  const entries = [];
  const add = (level) => (...args) => entries.push([level, ...args]);

  return {
    entries,
    info: add("info"),
    warn: add("warn"),
    error: add("error"),
  };
}

function createProcessRef() {
  const handlers = {};
  const exits = [];

  return {
    handlers,
    exits,
    on(signal, handler) {
      handlers[signal] = handler;
    },
    exit(code) {
      exits.push(code);
    },
  };
}

test("shutdown: закрывает сервер, polling и выходит с кодом 0", async () => {
  const calls = [];
  const logger = createLogger();
  const processRef = createProcessRef();
  const server = {
    close(callback) {
      calls.push("server");
      callback();
    },
  };
  const bot = {
    async stopPolling() {
      calls.push("bot");
    },
  };

  const shutdown = createShutdownHandler({
    server,
    bot,
    logger,
    processRef,
    timeoutMs: 1000,
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, ["server", "bot"]);
  assert.deepEqual(processRef.exits, [0]);
});

test("shutdown: повторный сигнал не запускает остановку заново", async () => {
  let calls = 0;
  const processRef = createProcessRef();
  const shutdown = createShutdownHandler({
    server: null,
    bot: {
      async stopPolling() {
        calls += 1;
      },
    },
    logger: createLogger(),
    processRef,
    timeoutMs: 1000,
  });

  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

  assert.equal(calls, 1);
  assert.deepEqual(processRef.exits, [0]);
});

test("shutdown: по таймауту выходит с кодом 1", async () => {
  const logger = createLogger();
  const processRef = createProcessRef();
  const shutdown = createShutdownHandler({
    server: null,
    bot: { stopPolling: () => new Promise(() => {}) },
    logger,
    processRef,
    timeoutMs: 5,
  });

  await shutdown("SIGTERM");

  assert.deepEqual(processRef.exits, [1]);
  assert.ok(
    logger.entries.some(
      ([level, message]) =>
        level === "error" && message.includes("принудительно")
    )
  );
});

test("shutdown: регистрирует обработчики SIGTERM и SIGINT", () => {
  const processRef = createProcessRef();

  registerShutdownHandlers({
    server: null,
    bot: null,
    logger: createLogger(),
    processRef,
  });

  assert.equal(typeof processRef.handlers.SIGTERM, "function");
  assert.equal(typeof processRef.handlers.SIGINT, "function");
});
