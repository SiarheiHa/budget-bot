# Budget Bot

Telegram-бот для учёта финансов. Данные хранятся в Google Таблицах.

## Стек
- Node.js (ESM)
- node-telegram-bot-api
- googleapis
- google-spreadsheet
- dotenv

## Переменные окружения

Создайте `.env` в корне проекта:

| Переменная | Обязательная | Описание |
|---|---|---|
| `BOT_TOKEN` | да | Токен бота от @BotFather |
| `SPREADSHEET_ID` | да | ID Google Таблицы |
| `ALLOWED_USERS` | да | Список Telegram ID через запятую. Доступ только указанным пользователям |
| `GOOGLE_CREDENTIALS_B64` | нет | JSON ключ сервисного аккаунта в Base64 (приоритетный способ авторизации) |
| `NODE_ENV` | нет | `development` или `production` |
| `PORT` | нет | Порт health-check сервера (по умолчанию 3000) |
| `CLOUDFLARE_ACCOUNT_ID` | нет | Account ID для Cloudflare Workers AI |
| `CLOUDFLARE_API_TOKEN` | нет | API-токен с правами Workers AI Read/Edit |
| `CLOUDFLARE_AI_MODEL` | нет | Модель Workers AI (по умолчанию `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| `AI_PARSING_ENABLED` | нет | `false` отключает распознавание свободного текста |

Если `GOOGLE_CREDENTIALS_B64` не задан, бот попытается использовать `credentials.json` в корне проекта.

## Структура Google Таблицы

- `Categories!A2:A50` — список категорий
- `Wallets!B2:B20` — названия кошельков
- `Wallets!C2:C20` — балансы кошельков
- `Wallets!D2:D20` — валюты кошельков
- `Transactions!A:G` — транзакции

## Команды

```bash
npm install
npm run dev   # запуск с nodemon (src/index.js)
npm start     # запуск через server.js (с health-check на /health)
npm test      # unit-тесты (node:test)
npm run lint  # проверка кода (ESLint)
```

## Особенности

- Многошаговый диалог добавления транзакции (`/add`): дата → сумма → категория → кошелёк → примечание
- Дата выбирается через inline-календарь (навигация по месяцам, подписи дней недели, «Сегодня»/«Вчера»); ручной ввод даты тоже поддерживается
- Сумма вводится inline-клавиатурой (цифры, запятая, смена знака, удаление, сброс); поддерживаются отрицательные суммы и до 2 знаков после запятой. Ручной ввод суммы тоже принимается
- Просмотр балансов (`/balance`)
- Состояния диалогов хранятся в памяти с TTL 15 минут
- Доступ строго ограничен списком `ALLOWED_USERS`
- При запуске через `server.js` доступен health-check на `/health`
