# HANDOVER: проект "Цикл"

**Создан:** 9 мая 2026 (раннее утро)
**Обновлён:** 9 мая 2026 (вечер)
**Автор:** Vladlen, технический лид канала "Женский Биохакинг с Иреной Пол" (~600 платных подписчиц)
**Статус:** MVP в проде с 9 мая 2026, работает в Telegram. Доступ: t.me/relax2000_bot/cycle

## 1. Назначение документа

Документ-передача состояния проекта между сессиями Claude Code. Когда текущий чат заканчивается по лимиту памяти, Vladlen открывает новый и присылает содержимое этого файла в первом сообщении - чтобы новый Claude моментально вошёл в контекст и продолжил с того же места.

В новом чате Vladlen приложит этот документ и явно укажет шаг, на котором остановились (см. секцию 10). Claude должен сразу взяться за следующий шаг, соблюдая правила из секции 8.

## 2. Проект "Цикл" - общее

**Что:** Telegram Mini App для трекинга менструального цикла. Минимально-расширяемая v1: главный экран с круговым индикатором фазы, кнопка "Отметить менструацию", календарь последних 3 месяцев с прогнозом фаз вперёд, история последних 6 циклов, редактирование и удаление записей.

**Аудитория:** ~600 женщин-подписчиц платного канала "Женский Биохакинг с Иреной Пол" (бот подписки @Biochakirena_bot).

**Где живёт:** `t.me/relax2000_bot/cycle`. Slug "cycle" зарегистрирован в @BotFather.

**Деплой фронта:** GitHub Pages под `vladlen00/cycle` (public репозиторий), URL `https://vladlen00.github.io/cycle/`.

**Бэкенд:** Supabase Edge Function `cycles-api` + таблица `cycles`. Задеплоено и работает с реальным трафиком.

## 3. Текущее состояние файлов

| Файл | Статус |
|---|---|
| `index.html` | В проде, 4322 байт, 98 строк |
| `style.css` | В проде, 13027 байт, 612 строк (включая layout-fix и calendar predictions) |
| `app.js` | В проде, 17064 байт, 544 строки (с scroll-to-current-month и is-predicted) |
| `auth.js` | В проде, 7308 байт, 190 строк |
| `cycleCalc.js` | В проде, 10273 байт, 271 строка (с wrap внутри getCalendarPhases) |
| `telegram-web-app.js` | В проде, 116341 байт, 3392 строки (вендорный SDK, не трогаем) |
| `edge-functions/cycles-api/index.ts` | Задеплоен в Supabase, 13737 байт, 454 строки |
| `CLAUDE.md` | Актуальный, 7818 байт |
| `HANDOVER.md` | Этот документ, обновлён |
| `.gitignore` | 77 байт (`.claude/`, `_references/`, `node_modules/`, `.env`, `.DS_Store`, `.vscode/`, `.idea/`, `Thumbs.db`) |
| `_references/verify-access/index.ts` | Локальная копия, 8908 байт, 299 строк (в .gitignore, не коммитится) |

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
- Smoke-тесты прошли: 401 на отсутствующий auth header, 401 на поддельный JWT, корректные CORS-заголовки на разрешённые origins. В проде работает с реальным трафиком

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

**Деплой фронта:**
- GitHub: `vladlen00/cycle` (public)
- Pages source: branch `main` / root
- URL: `https://vladlen00.github.io/cycle/`
- BotFather slug: `cycle` (для @relax2000_bot)
- Локальные коммиты пушатся в origin, GitHub Pages пересобирается за 1-2 минуты

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
- Bottom-nav как обычный flex-child (.app использует фиксированную height:100svh, .app-main скроллится, nav остаётся видим)
- 2 модалки (вне `.app`): `modal-edit`, `modal-confirm`
- `<script src="telegram-web-app.js">` в `<head>`
- В конце `<body>` скрипты строго в порядке: `cycleCalc.js` → `auth.js` → `app.js`

**`style.css`:**
- CSS-переменные в `:root` (палитра + шрифты + radius/space)
- Reset (паттерн из oneday)
- `.app` каркас, утилитарные классы (`.hidden`, `.btn-primary`, `.toast`)
- Компоненты по экранам, модалки
- Bottom-nav: `flex-shrink: 0`, `padding-bottom: max(env(safe-area-inset-bottom), 12px)` для iPhone notch
- .app: `height:100svh` + `overflow:hidden` (фиксирует viewport)
- .app-main: `overflow-y:auto` + `-webkit-overflow-scrolling:touch` (скролл секций)

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
- Прогноз будущих фаз: точки .is-predicted с opacity 0.65 (отличить от факта)
- toDate = currentCycle.start + avgLength + 7 (всегда, без клемпинга до today). Это даёт прогноз овуляции и следующей менструации
- Wrap делается ВНУТРИ getCalendarPhases (((day-1) % cycleLen) + 1), getPhaseForDay остаётся чистой функцией без wrap
- При открытии календаря scrollIntoView на текущий месяц (последний в списке), обёрнуто в requestAnimationFrame

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

## 9. Известные особенности и решённые баги

**Решённые баги (хронологически по продакшен-итерациям):**

- **Все точки в календаре были розовые.** `.calendar-dot` дефолтный `background: var(--phase-color)`, а `--phase-color` на `:root` равен `var(--color-menstruation)`. Поэтому все клетки получали розовую точку, независимо от наличия `data-phase`. **Фикс:** `background: transparent` в дефолтном правиле, цвет приходит только через `.calendar-cell[data-phase="..."] .calendar-dot`.

- **Двойной "Цикл" в шапке.** Системный заголовок Telegram + наш `<header class="app-logo">Цикл</header>` дублировались визуально. **Фикс:** убрали наш header целиком (блок с тегами `<header>...</header>` удалён из `index.html`), оставили только системный. CSS-правила `.app-header` и `.app-logo` остались как мёртвый код, не мешают.

- **Sticky nav не работал в Telegram WebView.** При коротком контенте nav не "прилипал" к низу экрана, нужно было скроллить чтобы его увидеть. **Фикс:** layout переделан с `min-height:100vh` + `position:sticky` на фиксированный `height:100svh` + `overflow:hidden` на `.app`, `overflow-y:auto` + `-webkit-overflow-scrolling:touch` на `.app-main`. Nav стал `flex-shrink:0` обычным flex-child. Скролл происходит внутри main-области, nav всегда виден.

- **`getCalendarPhases` не рисовал прогноз будущих фаз.** Без обработки циклической природы цикла, день 29 (после avgLength=28) попадал в LUTEAL и оставался лютеиновым до конца календаря. Главная фишка трекеров (показать когда ожидать следующую менструацию и овуляцию) не работала. **Фикс:** wrap `dayNum` внутри `getCalendarPhases`: `wrappedDay = ((dayNum - 1) % cycleLen) + 1`. Это даёт прогноз овуляции, лютеиновой и следующей менструации в виде продолжения текущего цикла.

- **Wrap в `getPhaseForDay` дал бы баг на main экране.** При задержке цикла (например день 30 при avgLength=28) main показал бы "Менструация", хотя пользовательница ничего не отметила (фаза предположила что новый цикл уже начался). **Решение:** wrap делается ТОЛЬКО внутри `getCalendarPhases`, `getPhaseForDay` остаётся чистой функцией без wrap. Main при задержке корректно показывает лютеиновую с продолжающимся счётом дня (день 30, 31, 32...).

- **Прогнозируемые точки были слишком тусклые.** Изначально `.is-predicted .calendar-dot { opacity: 0.4 }` - почти невидимы на светлом фоне. **Фикс:** opacity 0.65 - заметны, но визуально отличаются от факта (полные точки прошлых дней).

- **Календарь открывался на самом старом месяце.** При наличии 3 месяцев пользовательница видела март (давно прошедший) вместо текущего мая - надо было скроллить вниз. **Фикс:** `scrollIntoView({block:'start'})` на `lastElementChild` `.calendar-list` после рендера, обёрнуто в `requestAnimationFrame` чтобы дождаться layout.

**Известные особенности (не баги):**

- **Telegram user.id уникален per-аккаунт, не per-клиент.** Один и тот же аккаунт на десктопе и мобиле = один `user_id`. Разные `user_id` = разные аккаунты Telegram. Изоляция данных по `user_id` работает корректно - тестовые данные с разных аккаунтов в проде остались разделёнными.

- **`height:100svh` означает app занимает РОВНО высоту viewport.** Если внутри секции нужен скролл (длинный календарь, длинная история) - он происходит в `.app-main`, не в body. Это сознательное решение, чтобы nav всегда был на экране.

## 10. Что осталось сделать

**MVP до релиза - ВЫПОЛНЕНО (9 мая 2026):**

Все шаги a-i из исходной версии HANDOVER завершены:
- (a) `telegram-web-app.js` скопирован из `../oneday/` (побайтово)
- (b) `index.html` + `style.css` написаны
- (c) `app.js` написан
- (d) Локальный тест пройден
- (e) Репозиторий `vladlen00/cycle` создан (public), `.gitignore` настроен
- (f) `git init` + commit + push, GitHub Pages включён
- (g) В @BotFather зарегистрирован slug `cycle` для @relax2000_bot
- (h) Тест в Telegram прошёл на реальном устройстве
- (i) Багфиксы применены и запушены (см. секцию 9)

**Текущее состояние:** MVP в проде, работает с реальными данными.

**Post-MVP по приоритету:**

a) **Карточка "Цикл" в hub-приложении studio.** Точка входа из общего меню Ирены - чтобы пользовательница попадала в Цикл из studio, а не только по прямой ссылке. Файл: `../studio/index.html` (read-only зона - менять только с разрешения, или скопировать паттерн в новый билд studio).

b) **`getCycleContext(userId)` в `biohack/src/App.js`.** Системный промпт ИИ-коуча получает текущую фазу пользовательницы для персонализации советов (например при овуляции советует одно, при лютеиновой - другое). Файл: `../biohack/src/App.js` (read-only зона).

c) **Описания под медитациями в studio.** Ждёт тексты от Vladlen.

d) **Карточки анализов порции 3-5.** Knowledge base ИИ-подружки.

e) **Анонс "Цикл" в платный канал @relax2000.** Когда Vladlen решит что готов выкатить аудитории.

f) **Чистка БД от тестового user_id** если решит использовать один аккаунт. На стадии разработки могло накопиться несколько тестовых записей с разных аккаунтов.

## 11. Вопросы которые возможно поднимутся

- **Если 401 продолжает приходить даже на свежий JWT:** проверить, что `JWT_SECRET` в env Edge Function `cycles-api` совпадает с тем, что использовал `verify-access` при подписи токена. Любое расхождение = всегда 401 `invalid_signature`
- **Если CORS блокирует с какого-то origin:** дополнить `ALLOWED_ORIGIN_PATTERNS` в `edge-functions/cycles-api/index.ts` (и заодно в `verify-access/index.ts` если нужно). Текущий whitelist: `*.vercel.app`, `*.netlify.app`, `*.github.io`, `localhost`, `web.telegram.org`, `t.me`
- **Если на iPhone safe-area не работает:** проверить viewport meta (`viewport-fit=cover` нужен явно) и `padding-bottom: max(env(safe-area-inset-bottom), 12px)` на bottom-nav
- **Если `verify_jwt = true` случайно включится:** Supabase Gateway начнёт требовать свой JWT и блокировать запросы. Вернуть `false` в Function Settings
- **Подписки Tribute/Zenedu рассинхрон:** известная проблема (отчисленные подписчики остаются в linked chat и видят мини-аппу). Не решаем сейчас

## 12. Как возобновить в новом чате

Vladlen в первом сообщении нового чата отправит примерно такое:

> Привет, продолжаем cycle. MVP уже в проде на t.me/relax2000_bot/cycle, работает с реальными данными. Содержимое HANDOVER.md ниже:
>
> [полный текст HANDOVER.md]
>
> Сейчас работаем над [пункт из секции 10, например "(a) карточка Цикл в hub-приложении studio"].

Claude в новом чате должен:
1. Прочитать HANDOVER целиком
2. Не задавать базовых вопросов про проект, всё уже здесь
3. Сразу подтвердить понимание короткой строкой ("Понял, MVP в проде, работаем над пунктом X. Предлагаю план:")
4. Начать со следующего шага, соблюдая правила из секции 8 (превью перед действием, маленькие шаги, никаких длинных тире)

Дополнительно: в `~/.claude/projects/.../memory/` есть три файла памяти, которые Claude автоматически загружает:
- `cycle_no_em_dashes.md` - правило про короткие дефисы
- `cycle_neighbor_folders_readonly.md` - read-only соседние папки
- `cycle_app_calendar_upper_bound.md` - правило про клемпинг toDate в `app.js` календаре (всё ещё актуально - сейчас `toDate = upperBound = currentCycle.start + avgLength + 7`, что соответствует памяти)

Файл `CLAUDE.md` в корне проекта тоже грузится автоматически и содержит синхронизированную с этим HANDOVER архитектуру.
