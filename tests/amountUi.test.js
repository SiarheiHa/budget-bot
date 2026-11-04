import { test } from "node:test";
import assert from "node:assert/strict";
import { createAmountUiQueue } from "../src/amountUi.js";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createClock() {
  let current = 0;
  let nextId = 0;
  const timers = new Map();

  return {
    now: () => current,
    setTimeout(fn, delay) {
      const id = ++nextId;
      timers.set(id, { at: current + delay, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const target = current + ms;
      while (true) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.timer.at)) {
            next = { id, timer };
          }
        }
        if (!next) break;
        timers.delete(next.id);
        current = next.timer.at;
        next.timer.fn();
        await flush();
      }
      current = target;
      await flush();
    },
  };
}

function createQueue(clock, minIntervalMs = 100) {
  return createAmountUiQueue({
    minIntervalMs,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
}

test("amountUi: коалесцирует быстрые нажатия и рендерит актуальный draft", async () => {
  const clock = createClock();
  const queue = createQueue(clock);
  const rendered = [];
  let draft = "";

  const render = async () => {
    rendered.push(draft);
  };

  draft = "1";
  queue.schedule(1, render);
  draft = "12";
  queue.schedule(1, render);
  draft = "123";
  queue.schedule(1, render);

  await flush();
  assert.deepEqual(rendered, ["1"]);

  await clock.advance(100);
  assert.deepEqual(rendered, ["1", "123"]);

  await queue.whenIdle(1);
});

test("amountUi: abort отменяет отложенный рендер и ждёт in-flight", async () => {
  const clock = createClock();
  const queue = createQueue(clock);
  const rendered = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const render = async () => {
    await gate;
    rendered.push("done");
  };

  queue.schedule(1, render);
  queue.schedule(1, render);
  await flush();

  let aborted = false;
  const abortPromise = queue.abort(1).then(() => {
    aborted = true;
  });

  await flush();
  assert.equal(aborted, false);

  release();
  await abortPromise;
  assert.equal(aborted, true);

  await clock.advance(1000);
  assert.deepEqual(rendered, ["done"]);
});

test("amountUi: 429 повторяется с актуальным draft", async () => {
  const clock = createClock();
  const queue = createQueue(clock, 0);
  const rendered = [];
  let draft = "1";
  let attempts = 0;

  const render = async () => {
    attempts += 1;
    if (attempts === 1) {
      const err = new Error("Too Many Requests");
      err.response = { body: { parameters: { retry_after: 2 } } };
      throw err;
    }
    rendered.push(draft);
  };

  queue.schedule(1, render);
  await flush();
  assert.equal(attempts, 1);

  draft = "12";
  queue.schedule(1, render);
  await clock.advance(2000);

  assert.equal(attempts, 2);
  assert.deepEqual(rendered, ["12"]);
  await queue.whenIdle(1);
});

test("amountUi: message is not modified не считается ошибкой", async () => {
  const clock = createClock();
  const queue = createQueue(clock, 0);
  const errors = [];

  queue.schedule(
    1,
    async () => {
      const err = new Error("Bad Request: message is not modified");
      err.response = {
        body: { description: "Bad Request: message is not modified" },
      };
      throw err;
    },
    { onError: (err) => errors.push(err) }
  );

  await queue.whenIdle(1);
  assert.deepEqual(errors, []);
});

test("amountUi: leading=false не рендерит во время серии нажатий", async () => {
  const clock = createClock();
  const queue = createAmountUiQueue({
    minIntervalMs: 100,
    leading: false,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const rendered = [];
  let draft = "";

  const render = async () => {
    rendered.push(draft);
  };

  draft = "1";
  queue.schedule(1, render);
  draft = "12";
  queue.schedule(1, render);
  draft = "123";
  queue.schedule(1, render);

  await flush();
  assert.deepEqual(rendered, []);

  await clock.advance(100);
  assert.deepEqual(rendered, ["123"]);

  await queue.whenIdle(1);
});

test("amountUi: debounceMs отсчитывается от последнего нажатия", async () => {
  const clock = createClock();
  const queue = createAmountUiQueue({
    minIntervalMs: 100,
    debounceMs: 300,
    leading: false,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const rendered = [];

  const render = async () => {
    rendered.push("render");
  };

  queue.schedule(1, render);
  await clock.advance(200);
  queue.schedule(1, render);

  await clock.advance(299);
  assert.deepEqual(rendered, []);

  await clock.advance(1);
  assert.deepEqual(rendered, ["render"]);

  await queue.whenIdle(1);
});
