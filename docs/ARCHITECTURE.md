# ARCHITECTURE.md

## 1. Общее
- Назначение: персональный учёт финансов через Telegram
- Хранилище: Google Sheets
- Точка входа: `server.js` -> `src/index.js` -> `src/bot.js`
- Режим: polling (`new TelegramBot(token, { polling: true })`)

## 2. Структура
```
src/
├── bot.js           # инициализация бота, deps, регистрация хендлеров
├── config.js        # валидация env, экспорт config
├── sheets.js        # Google Sheets API
├── state.js         # Map состояний пользователей
├── utils.js         # парсинг/валидация/доступ
├── keyboards.js     # клавиатуры
├── messages.js      # тексты
├── logger.js        # консольный логгер
├── handlers/
│   ├── startHandler.js
│   ├── addHandler.js
│   ├── balanceHandler.js
│   └── cancelHandler.js
└── index.js         # лог о запуске
```

## 3. Конфиг
Обязательные: `BOT_TOKEN`, `SPREADSHEET_ID`, `ALLOWED_USERS`
Опциональные: `GOOGLE_CREDENTIALS_B64`, `NODE_ENV`, `DEBUG`, `PORT`

Auth Google: приоритет `GOOGLE_CREDENTIALS_B64`, fallback `credentials.json`.

## 4. Google Таблица
Листы:
- `Categories!A2:A50` — категории
- `Wallets!B2:B20` — имена кошельков
- `Wallets!C2:C20` — балансы
- `Wallets!D2:D20` — валюты (берётся getBalances)
- `Transactions!A:G` — транзакции. При записи в A,G + пустые B,D (чтобы не затирать формулы)

## 5. Флоу
### /start
Меню с кнопками "Добавить транзакцию", "Показать баланс"

### /add (многошаговый)
1. date — `parseDateDDMMYYYY` (поддерживает разделители, короткие форматы, 2-значный год)
2. amount — `parseAmount` (запятая/точка, пробелы)
3. category — выбор из загруженных из таблицы
4. wallet — выбор из загруженных из таблицы
5. note — ввод или `-` для пропуска
Сохранение через `sheets.appendTransaction` с `valueInputOption: "USER_ENTERED"`

### /balance
`getBalances()` парсит B2:D, приводит баланс к числу, фильтрует пустые имена

### Отмена
`/cancel` или кнопка `❌ Отмена` — очищает state, возврат в меню

## 6. Состояние
`state.js` — in-memory Map. Структура при `/add`:
```js
{ step: 'date'|'amount'|'category'|'wallet'|'note', data: {...}, categories: [], wallets: [], _ts: <timestamp> }
```
TTL: 15 минут. При истечении `getUserState` удаляет состояние и отправляет пользователю сообщение о истечении сессии с возвратом в главное меню. Очищается через `state.del(chatId)` по завершению/отмене. `updateUserState` обновляет `_ts`.

## 7. Доступ
`checkAccess` — сравнивает chatId со списком. `ALLOWED_USERS` обязателен - если пустой/не задан, `config.js` падает с понятной ошибкой при старте (и в production делает `process.exit(1)`). Middleware шлёт `ACCESS_DENIED` при запрете.  
`cancelHandler` обрабатывает `/cancel` и `❌ Отмена` **без** проверки доступа (вариант А).

## 8. Особенности реализации
- `addHandler` в `bot.on("message")` ловит все сообщения. Фильтр: если нет state ИЛИ текст начинается с `/` — выход. Кнопка "Отмена" проверяется отдельно.
- В `startHandler` при клике по кнопкам вызываются `handleAddCommand`/`handleBalanceCommand` напрямую (оба с проверкой доступа)
- `sheets.js` при `test` аргументе делает быструю проверку
- Логгер минимальный, без ротации
- `package.json`: `main: "server.js"`, `start: "node server.js"`, `dev: "nodemon src/index.js"`
- `config.js` при отсутствии обязательных переменных в production делает `process.exit(1)`, в dev кидает ошибку
- `addHandler` при ошибке очищает state и показывает главное меню
