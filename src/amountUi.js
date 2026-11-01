const DEFAULT_MIN_INTERVAL_MS = 500;

function getErrorDescription(err) {
  return err?.response?.body?.description || err?.message || "";
}

function isNotModifiedError(err) {
  return getErrorDescription(err).includes("message is not modified");
}

function getRetryAfterSeconds(err) {
  const value =
    err?.response?.body?.parameters?.retry_after ??
    err?.parameters?.retry_after;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function createAmountUiQueue(options = {}) {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const tasks = new Map();

  function resolveIdle(task) {
    const resolvers = task.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  function drain(task) {
    if (task.inFlight || !task.hasPending || task.timer) return;

    const elapsed = now() - task.lastStartAt;
    if (elapsed < minIntervalMs) {
      task.timer = setTimer(() => {
        task.timer = null;
        drain(task);
      }, minIntervalMs - elapsed);
      return;
    }

    task.hasPending = false;
    const generation = task.generation;
    task.lastStartAt = now();

    task.inFlight = (async () => {
      let retryDelayMs = 0;

      try {
        await task.render();
      } catch (err) {
        if (!isNotModifiedError(err)) {
          const retryAfter = getRetryAfterSeconds(err);
          if (retryAfter > 0) {
            retryDelayMs = retryAfter * 1000;
            task.hasPending = true;
          } else {
            task.onError?.(err);
          }
        }
      } finally {
        task.inFlight = null;

        if (task.generation !== generation) {
          resolveIdle(task);
          return;
        }

        if (task.hasPending) {
          if (retryDelayMs > 0) {
            if (!task.timer) {
              task.timer = setTimer(() => {
                task.timer = null;
                drain(task);
              }, retryDelayMs);
            }
          } else {
            drain(task);
          }
        } else if (!task.timer) {
          tasks.delete(task.key);
          resolveIdle(task);
        }
      }
    })();
  }

  function schedule(chatId, render, handlers = {}) {
    const key = String(chatId);
    let task = tasks.get(key);

    if (!task) {
      task = {
        key,
        chatId,
        render,
        onError: handlers.onError,
        inFlight: null,
        hasPending: false,
        timer: null,
        lastStartAt: -Infinity,
        generation: 0,
        idleResolvers: [],
      };
      tasks.set(key, task);
    } else {
      task.render = render;
      task.onError = handlers.onError;
    }

    task.hasPending = true;
    drain(task);
  }

  async function abort(chatId) {
    const key = String(chatId);
    const task = tasks.get(key);
    if (!task) return;

    task.generation += 1;
    task.hasPending = false;
    if (task.timer) {
      clearTimer(task.timer);
      task.timer = null;
    }
    tasks.delete(key);

    const inFlight = task.inFlight;
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // Ошибка уже обработана очередью через onError
      }
    }

    resolveIdle(task);
  }

  function whenIdle(chatId) {
    const task = tasks.get(String(chatId));
    if (!task || (!task.inFlight && !task.hasPending && !task.timer)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      task.idleResolvers.push(resolve);
    });
  }

  return { schedule, abort, whenIdle };
}
