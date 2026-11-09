/**
 * Создаёт обработчик корректной остановки.
 * Закрывает HTTP-сервер, останавливает polling и завершает процесс.
 */
export function createShutdownHandler({
  server,
  bot,
  logger,
  processRef = process,
  timeoutMs = 10000,
}) {
  let shuttingDown = false;

  return async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Получен ${signal}, останавливаю бота...`);

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        logger.error(
          `Остановка не завершилась за ${timeoutMs} мс, выхожу принудительно`
        );
        resolve("timeout");
      }, timeoutMs);
      timer.unref?.();
    });

    const graceful = (async () => {
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
      }
      if (bot) {
        await bot.stopPolling();
      }
      return "done";
    })();

    try {
      const result = await Promise.race([graceful, timeout]);
      processRef.exit(result === "done" ? 0 : 1);
    } catch (error) {
      logger.error(`Ошибка при остановке: ${error.message}`);
      processRef.exit(1);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function registerShutdownHandlers(options) {
  const processRef = options.processRef || process;
  const shutdown = createShutdownHandler({ ...options, processRef });

  processRef.on("SIGTERM", () => shutdown("SIGTERM"));
  processRef.on("SIGINT", () => shutdown("SIGINT"));

  return shutdown;
}
