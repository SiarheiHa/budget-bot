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
├── calendar.js      # генерация календаря и разбор callback-данных
├── amount.js        # ввод суммы, знак, разбор callback-данных
├── amountUi.js      # очередь редактирования сообщения суммы (коалесценция, abort)
├── aiParser.js      # Cloudflare Workers AI: разбор свободного текста
├── keyboards.js     # клавиатуры
├── messages.js      # тексты
├── logger.js        # консольный логгер
├── handlers/
│   ├── startHandler.js
│   ├── addHandler.js
│   ├── aiHandler.js
│   ├── balanceHandler.js
│   ├── cancelHandler.js
│   └── callbackHandler.js
└── index.js         # лог о запуске
```

## 3. Конфиг
Обязательные: `BOT_TOKEN`, `SPREADSHEET_ID`, `ALLOWED_USERS`
Опциональные: `GOOGLE_CREDENTIALS_B64`, `NODE_ENV`, `DEBUG`, `PORT`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_MODEL`,
`AI_PARSING_ENABLED`

Auth Google: приоритет `GOOGLE_CREDENTIALS_B64`, fallback `credentials.json`.

AI-парсинг включается только при наличии `CLOUDFLARE_ACCOUNT_ID` и
`CLOUDFLARE_API_TOKEN`; `AI_PARSING_ENABLED=false` принудительно отключает его.
По умолчанию модель — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

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
1. date — inline-календарь на текущий месяц: навигация `«`/`»`, строка подписей `Пн–Вс` (noop-кнопки, выровнены с сеткой), `Сегодня`, `Вчера`, `❌ Отмена`. Ручной ввод (`parseDateDDMMYYYY`) остаётся fallback
2. amount — inline-клавиатура `1–9`, `,`, `±`, `⌫`, `Сброс`, `✅ Готово` (4 колонки с действиями справа); черновик хранится строкой, поддерживаются отрицательные суммы и до 2 знаков после запятой. Ручной ввод (`parseAmount`) остаётся fallback. `amountDraft` обновляется синхронно до `answerCallbackQuery`, поэтому одновременные нажатия не теряются. Рендер сообщения идёт через `amountUi`: одна очередь на чат, не более одного in-flight запроса, debounce 1000 мс от последнего нажатия (во время серии тапов сообщение не редактируется), повтор на 429 с актуальным state
3. category — выбор из загруженных из таблицы
4. wallet — выбор из загруженных из таблицы
5. note — ввод или `-` для пропуска
Сохранение через `sheets.appendTransaction` с `valueInputOption: "USER_ENTERED"`

### Свободный текст (AI)
Если AI включён и у пользователя нет активного диалога, любое не-командное
сообщение отправляется в Cloudflare Workers AI. Модель извлекает одну
транзакцию и возвращает JSON: тип, сумму, категорию, кошелёк, дату и
примечание. Категория и кошелёк проверяются по фактическим спискам из таблицы.
Если они не распознаны — бот просит выбрать их кнопками. Перед записью
показывается сводка с кнопками `✅ Подтвердить`, `✏️ Изменить`, `❌ Отмена`;
`Изменить` открывает `/add` с предзаполненными полями. Переводы и несколько
операций в одной фразе не поддерживаются.

### Callback-кнопки
Единый роутер `callbackHandler` обрабатывает `callback_query`:
- `cal:nav:YYYY-MM` — перерисовать календарь через `editMessageText`
- `cal:day:YYYY-MM-DD` — выбрать дату и перейти к сумме
- `cal:today`, `cal:yesterday` — быстрый выбор даты
- `cal:noop` — заглушка для подписей дней недели и пустых ячеек
- `v1:amt:d:N`, `v1:amt:sep`, `v1:amt:sign`, `v1:amt:back`, `v1:amt:clear`, `v1:amt:ok` — ввод суммы, знак, удаление, сброс и подтверждение
- `v1:cancel` — отмена через общий `handleCancel`
- `ai:confirm`, `ai:edit`, `ai:cancel` — подтверждение, редактирование и отмена
  AI-черновика
Проверяется доступ (`checkAccess`), на каждый callback отвечает `answerCallbackQuery`. Устаревшие кнопки и неверный шаг дают alert «сессия устарела». Перед подтверждением и отменой `amountUi.abort` дожидается in-flight правки, чтобы старая клавиатура не вернулась после перехода.

### /balance
`getBalances()` парсит B2:D, приводит баланс к числу, фильтрует пустые имена

### Отмена
`/cancel` или кнопка `❌ Отмена` — очищает state, возврат в меню

## 6. Состояние
`state.js` — in-memory Map. Структура при `/add`:
```js
{ step: 'date'|'amount'|'category'|'wallet'|'note', data: {...}, categories: [], wallets: [], calendarMessageId: <id>, amountMessageId: <id>, amountDraft: '', _ts: <timestamp> }
```
Структура AI-черновика:
```js
{ aiStep: 'category'|'wallet'|'confirm', aiDraft: {...}, categories: [], wallets: [], aiMessageId: <id>, _ts: <timestamp> }
```
TTL: 15 минут. При истечении `getUserState` удаляет состояние и отправляет пользователю сообщение о истечении сессии с возвратом в главное меню. `peekUserState` возвращает состояние без удаления и без проверки TTL — используется AI-хендлером, чтобы не «съедать» истечение сессии раньше `addHandler`. Очищается через `state.del(chatId)` по завершению/отмене. `updateUserState` обновляет `_ts`.

## 7. Доступ
`checkAccess` — сравнивает chatId со списком. `ALLOWED_USERS` обязателен - если пустой/не задан, `config.js` падает с понятной ошибкой при старте (и в production делает `process.exit(1)`). Middleware шлёт `ACCESS_DENIED` при запрете.  
`cancelHandler` обрабатывает `/cancel` и `❌ Отмена` **без** проверки доступа (вариант А).

## 8. Особенности реализации
- `aiHandler` регистрируется до `addHandler` и обрабатывает свободный текст,
  только если нет активного state. Команды, кнопки меню и `❌ Отмена`
  игнорируются. На чат действует блокировка `aiInFlight`, чтобы повторная
  отправка не запускала второй запрос. Запрос ограничен 10 секундами, ввод —
  500 символами, примечание — 200.
- `addHandler` в `bot.on("message")` ловит все сообщения. Фильтр: если нет state ИЛИ текст начинается с `/` — выход. Кнопка "Отмена" проверяется отдельно.
- `handleAddCommand` принимает `{ prefill }` — так AI-черновик открывается в
  `/add` на шаге даты с заполненными датой, категорией, кошельком и примечанием.
  Сумма кладётся в `amountDraft`, чтобы пользователь мог её поправить.
- На шаге `date` inline-календарь редактируется на месте; ручной ввод даты также принимается и убирает клавиатуру календаря.
- На шаге `amount` inline-клавиатура редактируется на месте, черновик хранится в `amountDraft`. `amountDraft` обновляется синхронно до `await answerCallbackQuery`, иначе параллельные callback читают старый draft и затирают цифры. Рендер — через `amountUi`: одна очередь на чат, один in-flight запрос, debounce 1000 мс от последнего нажатия, повтор на 429 с актуальным state. Ограничение: если пользователь нажимает медленно и ровно во время правки сообщения, Telegram-клиент может не отправить такой тап. Ручной ввод суммы также принимается и убирает клавиатуру. Отрицательные суммы разрешены, ноль — нет.
- `callbackHandler` проверяет доступ и текущий шаг state, поэтому кнопки из старых сообщений не ломают диалог.
- `handleCancel` и повторный `/add` убирают inline-клавиатуры календаря, суммы и AI-сводки.
- В `startHandler` при клике по кнопкам вызываются `handleAddCommand`/`handleBalanceCommand` напрямую (оба с проверкой доступа)
- `sheets.js` при `test` аргументе делает быструю проверку
- Логгер минимальный, без ротации
- `package.json`: `main: "server.js"`, `start: "node server.js"`, `dev: "nodemon src/index.js"`
- `config.js` при отсутствии обязательных переменных в production делает `process.exit(1)`, в dev кидает ошибку
- `addHandler` при ошибке очищает state и показывает главное меню
