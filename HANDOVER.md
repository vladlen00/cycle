# HANDOVER: проект "Цикл"

**Дата создания:** 9 мая 2026
**Автор:** Vladlen, технический лид канала "Женский Биохакинг с Иреной Пол" (~600 платных подписчиц)

## 1. Назначение документа

Документ-передача состояния проекта между сессиями Claude Code. Когда текущий чат заканчивается по лимиту памяти, Vladlen открывает новый и присылает содержимое этого файла в первом сообщении - чтобы новый Claude моментально вошёл в контекст и продолжил с того же места.

В новом чате Vladlen приложит этот документ и явно укажет шаг, на котором остановились (см. секцию 9). Claude должен сразу взяться за следующий шаг, соблюдая правила из секции 8.

## 2. Проект "Цикл" - общее

**Что:** Telegram Mini App для трекинга менструального цикла. Минимально-расширяемая v1: главный экран с круговым индикатором фазы, кнопка "Отметить менструацию", календарь последних 3 месяцев, история последних 6 циклов, редактирование и удаление записей.

**Аудитория:** ~600 женщин-подписчиц платного канала "Женский Биохакинг с Иреной Пол" (бот подписки @Biochakirena_bot).

**Где будет жить:** `t.me/relax2000_bot/cycle`. Slug "cycle" в BotFather пока НЕ зарегистрирован.

**Деплой фронта:** GitHub Pages под `vladlen00/cycle`. Репозиторий ещё НЕ создан.

**Бэкенд:** Supabase Edge Function `cycles-api` + таблица `cycles`. Уже задеплоено и протестировано smoke-тестами.

## 3. Текущее состояние файлов

| Файл | Статус | Размер | Строк |
|---|---|---|---|
| `cycleCalc.js` | Готов, проверен в голове | 9715 | 265 |
| `auth.js` | Готов | 7308 | 190 |
| `edge-functions/cycles-api/index.ts` | Готов, задеплоен, smoke-тесты прошли | 13737 | 454 |
| `CLAUDE.md` | Актуальный, синхронизирован со всеми решениями | 7818 | - |
| `_references/verify-access/index.ts` | Локальная копия для референса (не деплоить, не коммитить) | 8908 | 299 |
| `index.html` | НЕ написан | - | - |
| `style.css` | НЕ написан | - | - |
| `app.js` | НЕ написан | - | - |
| `telegram-web-app.js` | НЕ скопирован (нужно из `../oneday/`) | - | - |

## 4. Инфраструктура (что задеплоено и работает)

**Supabase project:** `https://kjzxrpwqyyjcykwbqskn.supabase.co`

**Таблица `cycles`:**

| Колонка | Тип | Default | Заметка |
|---|---|---|---|
| `id` | uuid | `gen_random_uuid()` | PK |
| `user_id` | text | - | Telegram user.id как строка (совпадает с `sub` в JWT) |
| `start_date` | date | - | Дата старта менструации |
| `menstruation_length_days` | int | 5 | Длительность кровотечения |
| `notes` | text | null | Опционально |
| `created_at` | timestamptz | `now()` | |

UNIQUE constraint `(user_id, start_date)` добавлен (нужен для upsert через `on_conflict`). RLS включён, но `cycles-api` использует `service_role` и обходит его. Защита от чужих записей сделана в коде через явный фильтр `user_id` из JWT.

**Edge Function `cycles-api`:** `https://kjzxrpwqyyjcykwbqskn.supabase.co/functions/v1/cycles-api`
- Файл: `edge-functions/cycles-api/index.ts`
- **`verify_jwt = false`** в настройках функции (важно: иначе Supabase Gateway блокирует наш кастомный JWT раньше, чем код функции до него доходит)
- Поддерживает actions: `list`, `create`, `update`, `delete`
- Smoke-тесты прошли: 401 на отсутствующий auth header, 401 на поддельный JWT, корректные CORS-заголовки на разрешённые origins

**Edge Function `verify-access`:** работала до проекта cycle, не трогалась. Локальная копия для референса в `_references/verify-access/index.ts`.

**Env vars Edge Functions** (заданы в Function Settings):

| Переменная | Назначение |
|---|---|
| `JWT_SECRET` | Общий для verify-access и cycles-api. Если разойдётся - вечный 401 |
| `SUPABASE_URL` | Стандартный, предзаполнен |
| `SUPABASE_SERVICE_ROLE_KEY` | Для cycles-api, обход RLS. Deprecated в новой версии Supabase, но работает |
| `SUPABASE_ANON_KEY` | На всякий, cycles-api не использует |
| `BOT_TOKEN` | verify-access использует для HMAC валидации initData |
| `OPENAI_API_KEY` | Для других функций, не для cycle |

## 5. Архитектурные решения (зачем так сделано)

- **5 файлов фронта + telegram-web-app.js** - паттерн скопирован с работающих мини-апп `../oneday/` и `../breathing446/`. Vanilla JS, без сборки, статика на GitHub Pages
- **`cycleCalc.js` строго чистый** - никаких `new Date()` без аргумента, никакого `Date.now()` внутри. Параметр `today` всегда снаружи. Для тестируемости и детерминированности
- **CRUD через `cycles-api` Edge Function**, НЕ прямой REST к PostgREST из фронта (как было legacy в `../biohack/`). Сознательное усиление безопасности
- **JWT TTL = 7 дней** (`JWT_TTL_SECONDS = 7 * 24 * 60 * 60` в verify-access). Общий ключ `irena_access_token` в localStorage между всеми мини-аппами Ирены
- **Защита:** tg-auth через verify-access (HMAC initData → JWT) + наш `JWT_SECRET`. Service_role в cycles-api обходит RLS, поэтому defense in depth - явный фильтр `user_id=eq.${sub из JWT}` в каждом update/delete URL
- **Палитра** (тёплая женская):

  | Элемент | Цвет |
  |---|---|
  | Фон основной | `#fbf6f1` (кремовый) |
  | Текст основной | `#3a2a2a` (тёплый тёмный) |
  | Менструация | `#e8a5a0` (мягкий розовый) |
  | Фолликулярная | `#a8d8c5` (мятный) |
  | Овуляция | `#e8c878` (золотистый) |
  | Лютеиновая | `#c5b4d8` (лавандовый) |

- **Шрифты:** Cormorant Garamond italic для display (числа дня цикла, заголовки), Raleway 200/300 для body
- **Адаптив:** `clamp()` везде, `max-width: 420px` на контейнере

## 6. План фронта

**`index.html`:**
- Каркас `.app` со скрытием через `display:none`, класс `.ready` показывает после auth
- 3 экрана: `main`, `calendar`, `history` (один видим, остальные `hidden`)
- Bottom-nav со sticky-позиционированием
- 2 модалки (вне `.app`): `modal-edit`, `modal-confirm`
- `<script src="telegram-web-app.js">` в `<head>`
- В конце `<body>` скрипты строго в порядке: `cycleCalc.js` → `auth.js` → `app.js`

**`style.css`:**
- CSS-переменные в `:root` (палитра + шрифты + radius/space)
- Reset (паттерн из oneday)
- `.app` каркас, утилитарные классы (`.hidden`, `.btn-primary`, `.toast`)
- Компоненты по экранам, модалки
- Bottom-nav: `position: sticky`, `padding-bottom: max(env(safe-area-inset-bottom), 12px)` для iPhone notch

**`app.js`:**
- IIFE
- Состояние в памяти: `cycles`, `currentScreen`, `editingCycleId`, `isLoading`
- `init()`: `IrenaAuth.checkAccess()` → `loadCycles()` → `render()` → `.app.classList.add('ready')`
- `loadCycles()` зовёт `CyclesApi.list({ limit: 12 })` и кладёт в state
- Render-диспатчер по `currentScreen`

**Главный экран:**
- SVG cycle-ring с днём цикла и фазой по центру
- Подпись с прогнозом следующей менструации
- ОДНА большая кнопка "Отметить менструацию"
- Кнопка открывает модалку с date picker (default = today, можно поменять на любую прошлую) + поле длительности (default 5)
- Унифицирует 3 сценария: today / ретроспективно / первое открытие

**Календарь:**
- 3 месяца, 7-колоночная сетка с цветными точками по фазам
- Read-only для MVP (никаких кликов по дням для добавления)
- **ВАЖНО:** при вызове `CycleCalc.getCalendarPhases` ограничивать `toDate` до `currentCycle.start + avgLength + 7 дней`. Без этого функция красит странно для дат сильно после последнего цикла. Защита намеренно в UI-слое, не в `cycleCalc.js`

**История:**
- Список последних 6 циклов
- Каждая строка: дата старта, длительность, отклонение от средней
- Тап по строке открывает модалку edit

**Модалки:**
- Кастомные, не нативный `confirm()`
- `modal-edit`: форма с полями + кнопка "Удалить" + inline-confirm для удаления
- `modal-confirm`: для подтверждения создания

**Ошибки:** toast снизу над nav, 3 секунды

## 7. Потоки (детально)

**Открытие мини-аппы:**
- 2 запроса с холодного старта: POST verify-access, потом POST cycles-api list
- 1 запрос с тёплого (валидный токен в localStorage): только cycles-api list
- `.app` скрыт до завершения auth + первой загрузки

**"Отметить менструацию":**
1. Тап на кнопку → открывается `modal-confirm` с date picker (default today) и полем длительности (default 5)
2. Подтверждение → `CyclesApi.create({ start_date, menstruation_length_days, notes })`
3. На успех → `loadCycles()` (полная перезагрузка для пересчёта `avgLength`)
4. → `render()` обновляет main экран (новый день=1, фаза=менструация, прогноз сдвинут)
5. На ошибку → toast, кнопка снова активна

Idempotency: повторный create на ту же дату делает upsert (UNIQUE constraint), не создаёт дубликат.

**Редактирование:**
1. Тап строки в Истории → открывается `modal-edit` с текущими значениями
2. Изменения в полях → "Сохранить" → `CyclesApi.update({ id, ...diff })` (только реально изменённые поля)
3. На `affected: 1` → закрыть модалку, `loadCycles()`, `render()`
4. На `affected: 0` → toast "Запись не найдена", `loadCycles()` (синхронизация)

**Удаление:**
1. В `modal-edit` тап "Удалить" → inline-confirm в той же модалке
2. Подтверждение → `CyclesApi.delete({ id })`
3. На `deleted: true` → закрыть модалку, `loadCycles()`, `render()`

**401 от cycles-api:**
- `auth.js` метод `request()` ловит 401 → `clearToken()` + `showBlocked("token_expired")` + throw
- Пользователь видит экран подписки, теряет сессию

## 8. Правила и ограничения

- **КРИТИЧНО: никаких длинных тире (`—`) нигде.** Только короткие дефисы (`-`). Применять во ВСЕХ файлах: код, комментарии, строки в JSON-ответах, console.log, README. Зафиксировано в `CLAUDE.md` и в памяти Claude (`cycle_no_em_dashes.md`)
- **Соседние папки на Desktop read-only:** `../oneday/`, `../breathing446/`, `../studio/`, `../workout/`, `../biohack/`, `../meditation*/` и любые новые siblings. Это рабочие задеплоенные приложения @relax2000_bot с реальными пользовательницами. Можно читать как референс через Read/Grep, НЕЛЬЗЯ модифицировать, НЕЛЬЗЯ git/npm внутри них. Зафиксировано в памяти (`cycle_neighbor_folders_readonly.md`)
- **Папка `_references/` внутри cycle:** локальные справочные материалы. Можно читать и обновлять, нельзя коммитить (должна быть в `.gitignore`)
- **Маленькие шаги, превью перед действием:** Vladlen работает с Claude Code в пошаговом режиме. Перед любой записью файла или git-операцией Claude показывает превью или план в чате и ждёт явного "ок". Никакой инициативы "я тут попутно ещё это поправил"
- **Никакого прямого REST из фронта к Supabase.** Только через `cycles-api` Edge Function. Anon key в коде фронта НЕ используется

## 9. Что осталось сделать (по порядку)

**MVP до релиза:**

a) Скопировать `telegram-web-app.js` из `../oneday/telegram-web-app.js` в корень `cycle/` (побайтово, не модифицируя)

b) Написать `index.html` + `style.css` совместно (показ в чате → проверка → Write)

c) Написать `app.js` (показ → проверка → Write)

d) Локальный тест:
```bash
cd C:\Users\damia\Desktop\cycle
python -m http.server 8000
# открыть http://localhost:8000 в браузере
# (без Telegram-контекста auth не пройдёт, но видно что код не падает на парсинге)
```

e) Создать репозиторий `vladlen00/cycle` на GitHub (приватный или публичный решит Vladlen). Создать `.gitignore`:
```
_references/
node_modules/
.env
.DS_Store
```

f) `git init`, первый commit, push, включить GitHub Pages в Settings (branch: `main`, folder: `/`)

g) В @BotFather: `/newapp` для @relax2000_bot, slug: `cycle`, title: "Цикл", description, photo (можно потом), URL: `https://vladlen00.github.io/cycle/`

h) Тест в Telegram через `t.me/relax2000_bot/cycle` на реальном устройстве (iPhone и Android)

i) Багфикс что вылезет

**Дополнительно (НЕ MVP, отдельные задачи):**
- Добавить 4-ю карточку "Цикл" в `../studio/index.html` (точка входа из общего hub-экрана)
- Интегрировать `getCycleContext(userId)` в `../biohack/src/App.js` (системный промпт ИИ-коуча получает текущую фазу пользовательницы для персонализации)
- Карточки анализов порции 3-5 (продолжение работы по knowledge base, идёт параллельно)

## 10. Вопросы которые возможно поднимутся

- **Если 401 продолжает приходить даже на свежий JWT:** проверить, что `JWT_SECRET` в env Edge Function `cycles-api` совпадает с тем, что использовал `verify-access` при подписи токена. Любое расхождение = всегда 401 `invalid_signature`
- **Если CORS блокирует с какого-то origin:** дополнить `ALLOWED_ORIGIN_PATTERNS` в `edge-functions/cycles-api/index.ts` (и заодно в `verify-access/index.ts` если нужно). Текущий whitelist: `*.vercel.app`, `*.netlify.app`, `*.github.io`, `localhost`, `web.telegram.org`, `t.me`
- **Если на iPhone safe-area не работает:** проверить viewport meta (`viewport-fit=cover` нужен явно) и `padding-bottom: max(env(safe-area-inset-bottom), 12px)` на bottom-nav
- **Если `verify_jwt = true` случайно включится:** Supabase Gateway начнёт требовать свой JWT и блокировать запросы. Вернуть `false` в Function Settings
- **Подписки Tribute/Zenedu рассинхрон:** известная проблема (отчисленные подписчики остаются в linked chat и видят мини-аппу). Не решаем сейчас

## 11. Как возобновить в новом чате

Vladlen в первом сообщении нового чата отправит примерно такое:

> Привет, продолжаем проект cycle. Содержимое HANDOVER.md ниже.
>
> [полный текст HANDOVER.md]
>
> Сейчас я на шаге [например, "b" из секции 9: написание index.html + style.css]. Дальше делаем [например, "показывай план DOM-структуры index.html"].

Claude в новом чате должен:
1. Прочитать HANDOVER целиком
2. Не задавать базовых вопросов про проект, всё уже здесь
3. Сразу подтвердить понимание короткой строкой ("Понял, проект Цикл, шаг b - index.html + style.css. План DOM-структуры:")
4. Начать со следующего шага, соблюдая правила из секции 8 (превью перед действием, маленькие шаги, никаких длинных тире)

Дополнительно: в `~/.claude/projects/.../memory/` есть три файла памяти, которые Claude автоматически загружает:
- `cycle_no_em_dashes.md` - правило про короткие дефисы
- `cycle_neighbor_folders_readonly.md` - read-only соседние папки
- `cycle_app_calendar_upper_bound.md` - напоминание про клемпинг toDate в `app.js` календаре

Файл `CLAUDE.md` в корне проекта тоже грузится автоматически и содержит синхронизированную с этим HANDOVER архитектуру.
