import "./src/index.js"; // Это запустит вашего бота
import http from "http";

// Простой HTTP-сервер для health-чеков Render
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running 🚀");
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🤖 Telegram Bot with health checks running on port ${PORT}`);
});
