# ARCHITECTURE.md

## 1. Общее
- Назначение: персональный учёт финансов через Telegram.
- Хранилище: Google Sheets.
- Точка входа: `server.js` → `src/index.js` → `src/bot.js`.
- Режим: long-polling (`new TelegramBot(token, { polling: true })`).

## 2. Структура
```
server.js            # HTTP health-check, graceful shutdown, запуск src/index.js
src/
├── bot.js           # инициализация бота, deps, регистрация хендлеров
├── config.js        # загрузка .env, NODE_ENV, экспорт config
├── configBuilder.js # сборка конфига из env без побочных эффектов
├── shutdown.js      # корректная остановка polling и HTTP-сервера
├── sheets.js        # Google Sheets API
├── state.js         # Map состояний пользователей
├── utils.js         # даты, суммы, доступ, удаление сообщений
├── calendar.js      # календарь и callback-даты
├── amount.js        # ввод суммы и callback-суммы
├── amountUi.js      # очередь редактирования сообщения суммы
├── aiParser.js      # Cloudflare Workers AI
├── keyboards.js     # клавиатуры
├── messages.js      # тексты
├── logger.js        # консольный логгер
├── handlers/
│   ├── startHandler.js
│   ├── addHandler.js
│   ├── aiHandler.js
│   ├── balanceHandler.js
│   ├── transactionHandler.js
│   ├── cancelHandler.js
│   └── callbackHandler.js
└── index.js
```

## 3. Конфиг
- Обязательные: `BOT_TOKEN`, `SPREADSHEET_ID`, `ALLOWED_USERS`.
- Опциональные: `GOOGLE_CREDENTIALS_B64`, `NODE_ENV`, `DEBUG`, `PORT`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_MODEL`,
  `AI_PARSING_ENABLED`.
- `configBuilder.js` читает `BOT_TOKEN`, `SPREADSHEET_ID`, `ALLOWED_USERS`,
  `GOOGLE_CREDENTIALS_B64`, Cloudflare-переменные и `AI_PARSING_ENABLED`.
- `config.js` загружает `.env` и читает `NODE_ENV`; `logger.js` читает `DEBUG`;
  `server.js` читает `PORT`.
- Google Auth: приоритет `GOOGLE_CREDENTIALS_B64`, fallback `credentials.json`.
- AI включается только при наличии Cloudflare-ключей; `AI_PARSING_ENABLED=false`
  принудительно отключает его. Модель по умолчанию —
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## 4. Google Таблица
- `Categories!A2:B50` — категории и тип: `Доход`, `Расход` или `перевод`;
  `getCategories()` возвращает `{ name, type }`, где `type` — `income`,
  `expense`, `transfer` или `null`.
- `Wallets!B2:D` — имена, балансы и валюты кошельков.
- `Transactions!A:G` — транзакции.
- `Service!A1` — служебная формула с номером последней заполненной строки:
  `=IFERROR(ARRAYFORMULA(LOOKUP(2;1/(Transactions!A2:A100000<>"");ROW(Transactions!A2:A100000)));0)`.
  Лист создаётся вручную; если формулы нет, бот откатывается к чтению
  `Transactions!A2:A`.
- При записи заполняются `A,C,E,F,G`, а `B,D` остаются пустыми, чтобы не
  затирать формулы.
- Перевод записывается двумя строками в одном `values.append`: списание с
  кошелька-источника (отрицательная сумма) и зачисление получателю
  (положительная сумма). Категория, дата и примечание у строк одинаковые.

## 5. Флоу
### /start
Показывает главное меню: `Добавить транзакцию`, `Показать баланс`,
`Последняя транзакция`.

### /add (одна карточка)
`/add` удаляет сообщение с командой или кнопкой меню и создаёт карточку.
Шаги даты и суммы редактируют её через `editMessageText`; категория и кошелёк
переотправляют карточку с ReplyKeyboard, примечание — с `ForceReply`.
Предыдущая карточка удаляется. В карточке видны заполненные поля и подсказка
текущего шага.

1. `date` — inline-календарь: навигация по месяцам, `Пн–Вс`, `Сегодня`,
   `Вчера`, `❌ Отмена`. Ручной ввод `ДД.ММ.ГГГГ` остаётся fallback.
2. `amount` — inline-клавиатура `1–9`, `0`, `,`, `±`, `⌫`, `Сброс`,
   `✅ Готово`; поддерживаются отрицательные суммы и до 2 знаков после запятой.
   Ручной ввод также принимается. `amountDraft` обновляется синхронно до
   `answerCallbackQuery`, рендер идёт через `amountUi`.
3. `category` — ReplyKeyboard со списком из таблицы и `❌ Отмена`; ручной ввод
   остаётся fallback. Если выбрана категория с типом `transfer`, сумма
   нормализуется к положительной и диалог переходит к шагам перевода.
4. `wallet` — ReplyKeyboard со списком из таблицы и `❌ Отмена`; ручной ввод
   остаётся fallback. Для перевода вместо этого шага запрашиваются
   `transferFrom` («Откуда») и `transferTo` («Куда»); получатель исключается из
   списка и не может совпадать с источником. Если кошельков меньше двух,
   показывается ошибка и шаг категории не меняется.
5. `note` — ввод или `-` для пропуска. Карточка переотправляется с `ForceReply`,
   чтобы клиент попытался сразу открыть ввод. Кнопки отмены на шаге нет, отмена —
   `/cancel`.

Сохранение обычной операции идёт через `sheets.appendTransaction`, перевода —
через `sheets.appendTransfer` (обе функции используют `valueInputOption:
"USER_ENTERED"`). После успеха бот отправляет одно итоговое сообщение с полями,
`✅ Запись добавлена в таблицу!` и главным меню, затем удаляет карточку и
использованные сообщения пользователя. Ошибки формата даты/суммы и неверные
значения показываются в карточке, без отдельных сообщений.

### Свободный текст (AI)
При включённом AI любое не-командное сообщение без активного диалога уходит в
Cloudflare Workers AI. Модель извлекает одну транзакцию: сумму, категорию,
кошелёк, дату и примечание. Тип берётся из `Categories!B` по выбранной категории
и пересчитывается при её смене. Категории-переводы в AI-флоу не попадают — для
них используется `/add`.

Если все поля распознаны, показывается сводка с кнопками `✅ Сохранить`,
`✏️ Изменить`, `❌ Отмена`. Если категория или кошелёк не распознаны, сразу
открывается карточка с `не выбрана`/`не выбран`. В ней доступны поля `Сумма`,
`Дата`, `Категория`, `Кошелёк`, `Примечание`, `✅ Сохранить` и `❌ Отмена`; тип
read-only. AI-callback сверяют `message_id` с `aiMessageId`, чтобы старые кнопки
не меняли новый черновик. Несколько операций в одной фразе не поддерживаются.

### Callback-кнопки
Единый роутер `callbackHandler` обрабатывает `callback_query`:
- `cal:nav:YYYY-MM`, `cal:day:YYYY-MM-DD`, `cal:today`, `cal:yesterday`,
  `cal:noop` — календарь.
- `v1:amt:*` — ввод суммы, знак, удаление, сброс и подтверждение.
- `v1:cancel` — отмена через общий `handleCancel`.
- `ai:edit`, `ai:field:*`, `ai:pick:*`, `ai:amt:*`, `ai:cal:*`, `ai:back`,
  `ai:confirm`, `ai:cancel` — AI-карточка и редакторы полей.
- `tx:prev:<row>`, `tx:next:<row>`, `tx:view:<row>`, `tx:close:<row>` —
  навигация и закрытие карточки транзакции.
- `tx:edit:<row>`, `tx:edit-field:<row>:<field>`,
  `tx:edit-pick:<row>:<field>:<index>`, `tx:edit-cancel:<row>` — редактирование.
- `tx:delete:<row>`, `tx:confirm-delete:<row>`, `tx:cancel-delete:<row>` —
  удаление с подтверждением.

Проверяется доступ (`checkAccess`), на каждый callback отвечает
`answerCallbackQuery`. Устаревшие кнопки дают alert. Перед переходом
`amountUi.abort` дожидается in-flight правки, чтобы старая клавиатура не
вернулась.

### /last (карточка транзакции)
Кнопка `Последняя транзакция` или `/last` открывает карточку последней
заполненной строки `Transactions`. Карточка показывает дату, сумму, категорию,
кошелёк и примечание. Доступны `← Предыдущая`, `Следующая →`, `✏️ Изменить`,
`🗑 Удалить` и `❌ Закрыть`. Навигация идёт по порядку строк, а не по дате;
пустые строки пропускаются.

Перед удалением показывается подтверждение. Удаление использует
`DeleteDimension` по `sheetId` листа `Transactions`. Редактирование пишет только
`A`, `C`, `E:G`; `B` и `D` с формулами не трогаются. Переводы (категория с типом
`transfer`) пока нельзя редактировать и удалять: карточка показывает
предупреждение, чтобы не удалить половину перевода.

У строки нет стабильного ID, поэтому её идентификатор — номер строки. Перед
действием хендлер перечитывает строку; если она уже пуста, показывает
`Транзакция не найдена`. Кеш `lastRow`, отдельных строк и окон по 25 строк живёт
5 минут и сбрасывается после `append`, `update` и `delete`.

### /balance
`getBalances()` читает `Wallets!B2:D`, приводит баланс к числу и фильтрует
пустые имена. Результат или ошибка отправляются с главным меню; отдельного
`Выберите действие` нет. Сообщение `LOADING` удаляется перед отправкой
результата: Telegram не позволяет редактировать сообщения с ReplyKeyboard.

### Отмена
`/cancel`, `❌ Отмена`, `v1:cancel` и `ai:cancel` идут в общий `handleCancel`.
Он очищает state, дожидается `amountUi.abort` и удаляет известные сообщения:
`cardMessageId`, `aiMessageId`, старые `calendarMessageId`/`amountMessageId`,
а также входящее `/cancel`. Затем отправляется одно `❌ Операция отменена.` с
главным меню. Оно остаётся в чате: Telegram привязывает ReplyKeyboard к
сообщению, поэтому удаление подтверждения убирает и меню. Удаляются только
сохранённые `message_id`; историю бот не ищет.

## 6. Состояние
`state.js` — in-memory Map. Структура ручного `/add`:
```js
{ step: 'date'|'amount'|'category'|'wallet'|'transferFrom'|'transferTo'|'note', data: { date, amount, category, wallet, transferFrom, transferTo, transfer, note }, categories: [], categoryTypes: {}, wallets: [], cardMessageId: <id>, amountDraft: '', _ts: <timestamp> }
```
Структура AI-черновика:
```js
{ aiStep: 'confirm'|'edit', aiEditField: 'amount'|'date'|'category'|'wallet'|'note'|null, aiDraft: { type, amount, category, wallet, date, note }, aiAmountDraft: '', categories: [{ name, type }], wallets: [], aiMessageId: <id>, _ts: <timestamp> }
```

Структура редактирования транзакции:
```js
{ step: 'tx-edit', txRow: <row>, txField: 'date'|'amount'|'category'|'wallet'|'note'|null, cardMessageId: <id>, _ts: <timestamp> }
```

TTL — 15 минут. При истечении `getUserState` удаляет состояние и отправляет одно
сообщение с главным меню. `peekUserState` читает состояние без TTL-проверки и
удаления — нужен AI-хендлеру, чтобы не «съедать» истечение раньше `addHandler`.
`isUserStateExpired` используется AI-хендлером для проверки `_ts`. Очистка —
через `state.del(chatId)` по завершению или отмене.

## 7. Доступ
`checkAccess` сравнивает `chatId` со списком `ALLOWED_USERS`. Переменная
обязательна: при пустом значении `config.js` падает с ошибкой, в production —
через `process.exit(1)`. Middleware отправляет `ACCESS_DENIED` при запрете.

`cancelHandler` обрабатывает `/cancel` и `❌ Отмена` без middleware доступа.
Callback-отмена (`v1:cancel`, `ai:cancel`) проходит через проверку доступа
`callbackHandler`.

## 8. Особенности реализации
- `aiHandler` регистрируется до `addHandler` и обрабатывает текст только без
  активного state. На чат действует `aiInFlight`, запрос ограничен 10 секундами,
  ввод — 500 символами, примечание — 200.
- `addHandler` ловит все сообщения, но выходит, если state нет, текст начинается
  с `/`, это кнопка меню или `❌ Отмена`.
- `amountUi`: одна очередь на чат, не более одного in-flight запроса, debounce
  1000 мс, повтор на 429 с актуальным state. При медленном вводе тап, попавший
  ровно в момент правки сообщения, Telegram-клиент может не отправить.
- Ручные callback-кнопки сверяют `step` и `cardMessageId`, AI-кнопки —
  `aiMessageId`; кнопки из старых сообщений не меняют новый черновик.
- `safeDeleteMessage` и `removeInlineKeyboard` только логируют ошибки Telegram.
- `handleAddCommand` при повторном `/add` удаляет старую карточку и старые
  inline-сообщения. При ошибке загрузки справочников показывает `INIT_ERROR` с
  главным меню.
- `startHandler` вызывает `handleAddCommand`/`handleBalanceCommand` напрямую;
  оба обработчика проверяют доступ.
- `sheets.js` экспортирует `createSheets({ config, logger, valuesApi })`;
  `bot.js` создаёт экземпляр, а тесты подменяют `valuesApi`. Реальный
  Google-клиент создаётся лениво. При аргументе `test` модуль делает быструю
  проверку `getBalances()`.
- `appendTransaction`/`appendTransfer` возвращают номер последней записанной
  строки из `updates.updatedRange`. `getLastTransaction` читает `Service!A1`
  (fallback `Transactions!A2:A`) и одну строку; `getNeighborTransaction` —
  окно до 25 строк. `deleteTransaction` использует `batchUpdate`
  (`DeleteDimension`), `updateTransaction` — `values.batchUpdate` только для
  `A`, `C`, `E:G`.
- `configBuilder.js` собирает конфиг из переданного env без побочных эффектов;
  `config.js` загружает dotenv и валидирует переменные при старте.
- `logger` — минимальная обёртка над `console` с уровнями и `DEBUG`.
- `server.js` перехватывает `SIGTERM`/`SIGINT`: закрывает HTTP-сервер,
  останавливает polling и выходит; если остановка зависла, через 10 секунд
  завершает процесс принудительно. Логика вынесена в `src/shutdown.js`.
- `package.json`: `main: "server.js"`, `start: "node server.js"`,
  `dev: "nodemon src/index.js"`.
