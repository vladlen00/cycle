// Mini App: Цикл - app.js
// UI-слой и оркестрация. Зависит от cycleCalc.js (CycleCalc) и auth.js (IrenaAuth, CyclesApi).
// Все даты внутри - UTC midnight (синхронно с cycleCalc.js).

(function () {
  'use strict';

  // === Конфиг ===

  const FETCH_LIMIT = 12;        // с запасом сверх HISTORY_LIMIT для устойчивого avg
  const HISTORY_LIMIT = 6;
  const CALENDAR_MONTHS_BACK = 2;
  const CALENDAR_MONTHS_FORWARD = 12;
  const RING_CIRCUMFERENCE = 540.4; // 2*pi*86, синхронно с stroke-dasharray в HTML
  const UNDO_TOAST_MS = 5000;    // окно, в котором можно отменить только что созданную отметку

  // Длительность менструации почти никто не правит: в форме стоит 5, и календарь
  // рисует пять дней там, где было три. Поэтому спрашиваем, двумя дорогами.
  // Отметка задним числом: длина уже известна, поле в форме пустое и обязательное.
  // Отметка вовремя: с 8 по 14 день цикла на "Сегодня" карточка с вопросом.
  // К восьмому дню менструация кончилась почти у всех, через две недели число
  // вспоминается хуже. Спрашиваем только про пятёрку: другое число это уже выбор.
  // Граница у дорог общая: дата на 7 дней раньше сегодня это и есть день цикла 8.
  const LEN_ASK_DEFAULT = 5;
  const LEN_ASK_FROM_DAY = 8;
  const LEN_ASK_TO_DAY = 14;
  const RETRO_MIN_DAYS = LEN_ASK_FROM_DAY - 1;
  const LEN_LABEL_DEFAULT = 'Длительность (дней)';
  const LEN_LABEL_RETRO = 'Сколько дней шла?';
  // Флажки хранят id цикла, к которому относятся: новый цикл даёт новый id, и
  // вопрос открывается сам, чистить старое не нужно. Приставка cycle. отделяет
  // ключи от токена в auth.js и от соседних мини-аппов на том же github.io.
  const LEN_ASK_DONE_KEY = 'cycle.lenAsk.done';     // ответила, закрыла или ушла в форму
  const LEN_ASK_LANDED_KEY = 'cycle.lenAsk.landed'; // уже открывали "Сегодня" ради вопроса
  // Пока висит вопрос, кольцо на низком экране ужимается, но не меньше RING_MIN_SIZE:
  // дальше пусть будет прокрутка. Ниже RING_COMPACT_SIZE номер дня и фаза мельче.
  const RING_MIN_SIZE = 140;
  const RING_COMPACT_SIZE = 220;
  const RING_TINY_SIZE = 170;    // ниже название фазы прячем: под центром кольцо уже, и оно не влезает

  // Картинка с датами цикла. Геометрия в логических единицах, одна и та же для
  // всех трёх периодов: меняется только сетка месяцев и итоговый масштаб.
  // Масштаб подбирается так, чтобы длинная сторона не вышла за SHARE_MAX_SIDE -
  // до этого размера Telegram ужимает фото при обычной отправке.
  const SHARE_CELL = 52;
  const SHARE_PAD = 28;
  const SHARE_GAP = 28;
  const SHARE_TITLE_H = 48;
  const SHARE_WEEKDAY_H = 36;
  const SHARE_WEEKS = 6;         // строк в сетке месяца, всегда 6 - блоки одинаковые
  const SHARE_CAPTION_H = 60;
  const SHARE_LEGEND_ROW_H = 40;
  const SHARE_COLS = 3;          // месяцев в ряду при периоде больше одного
  const SHARE_MAX_SIDE = 1280;
  const SHARE_MAX_SCALE = 2;
  const SHARE_FONT_TIMEOUT_MS = 1500;
  const SHARE_FONT_BODY = '"Raleway", -apple-system, "Segoe UI", Roboto, sans-serif';
  const SHARE_FONT_TITLE = '"Cormorant Garamond", Georgia, serif';
  const SHARE_OVU_DOT_R = 4;     // точка овуляции под числом
  const SHARE_OVU_DOT_DY = 15;   // её отступ от центра ячейки, в соседний ряд не залезает

  const PHASE_COLOR_VAR = {
    menstruation: 'var(--color-menstruation)',
    follicular:   'var(--color-follicular)',
    ovulation:    'var(--color-ovulation)',
    luteal:       'var(--color-luteal)',
  };

  const PHASE_LABEL = {
    menstruation: 'Менструация',
    follicular:   'Фолликулярная',
    ovulation:    'Овуляция',
    luteal:       'Лютеиновая',
  };

  const MONTH_NAMES_NOM = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  const MONTH_NAMES_GEN = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const WEEKDAY_NAMES_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Отметки самочувствия. Коды и порядок синхронны со списком в cycles-api: сервер
  // принимает только их и хранит набор в этом же порядке. Подписи утверждает
  // Ирена, живут они только здесь, в базе лежат коды.
  const SYMPTOM_OPTIONS = [
    { code: 'fine', label: 'Всё в порядке' },
    { code: 'lower_abdominal_pain', label: 'Боль внизу живота' },
    { code: 'breast_tenderness', label: 'Грудь болит' },
    { code: 'headache', label: 'Головная боль' },
    { code: 'acne', label: 'Прыщи' },
    { code: 'back_pain', label: 'Боль в спине' },
    { code: 'fatigue', label: 'Усталость' },
    { code: 'hot_flashes', label: 'Приливы' },
    { code: 'night_sweats', label: 'Ночная потливость' },
    { code: 'forgetfulness', label: 'Забывчивость' },
    { code: 'joint_pain', label: 'Боль в суставах' },
    { code: 'increased_appetite', label: 'Аппетит' },
    { code: 'insomnia', label: 'Бессонница' },
    { code: 'vaginal_itching', label: 'Зуд' },
    { code: 'vaginal_dryness', label: 'Сухость' },
    { code: 'anxiety', label: 'Тревожность' },
    { code: 'swelling', label: 'Отёки' },
    { code: 'bloating', label: 'Вздутие' },
    { code: 'low_libido', label: 'Либидо снижено' },
  ];
  const DISCHARGE_OPTIONS = [
    { code: 'none', label: 'Выделений нет' },
    { code: 'creamy', label: 'Кремообразные' },
    { code: 'watery', label: 'Водянистые' },
    { code: 'sticky', label: 'Липкие' },
    { code: 'mucus', label: 'Слизистые' },
    { code: 'spotting', label: 'Кровомажущие' },
    { code: 'atypical', label: 'Нетипичные' },
    { code: 'white_clumpy', label: 'Белые комковатые' },
    { code: 'grey', label: 'Серые' },
  ];
  // "Всё в порядке" и "Выделений нет" это отметки, а не пустота: с другими
  // значениями своего списка не совмещаются. Синхронно с cycles-api и базой.
  const SYMPTOM_KINDS = {
    symptoms: { options: SYMPTOM_OPTIONS, exclusive: 'fine' },
    discharge: { options: DISCHARGE_OPTIONS, exclusive: 'none' },
  };

  // === State ===

  const state = {
    cycles: [],
    // null = отметок мало, типичную длину посчитать не из чего. Запасных 28
    // здесь нет намеренно: каждый читатель обязан решить, что показать при
    // неизвестной длине, а не получить чужое число молча.
    typicalLength: null,
    isLoading: false,
    pendingConfirmAction: null, // callback для modal-confirm
    undoCreate: null,           // { id, el, timer } последней созданной отметки, пока жив тост
    shareImage: null,           // { url, file } открытой картинки, ссылку освобождаем при закрытии
    // Отметки самочувствия: дата YYYY-MM-DD -> { symptoms, discharge, note }.
    // Только в памяти: localStorage на vladlen00.github.io общий у всех мини-аппов,
    // медицинским данным там не место.
    symptomsByDate: new Map(),
    // 'loading' | 'ok' | 'error'. Пока статус не 'ok', пустая карта НЕ значит
    // "не отмечено": экран обязан отличать "отметок нет" от "не загрузились".
    symptomsStatus: 'loading',
  };

  const $ = {}; // DOM cache

  // === DOM cache ===

  function cacheDom() {
    $.app = document.querySelector('.app');
    $.appMain = document.querySelector('.app-main');
    $.screens = document.querySelectorAll('.screen');
    $.navBtns = document.querySelectorAll('.nav-btn');

    $.cycleDay = document.getElementById('cycle-day');
    $.cyclePhase = document.getElementById('cycle-phase');
    $.cyclePrediction = document.getElementById('cycle-prediction');
    $.ringProgress = document.querySelector('.ring-progress');
    $.ringWrap = document.querySelector('.cycle-ring-wrap');
    $.lenAsk = document.getElementById('len-ask');
    $.lenAskNote = document.getElementById('len-ask-note');

    $.calendarList = document.getElementById('calendar-list');
    $.legendSym = document.getElementById('legend-sym');

    $.historyList = document.getElementById('history-list');
    $.historyEmpty = document.getElementById('history-empty');

    $.modalRecord = document.getElementById('modal-record');
    $.recordTitle = document.getElementById('record-title');
    $.formRecord = document.getElementById('form-record');
    $.btnDeleteRecord = $.formRecord.querySelector('[data-action="delete-record"]');
    $.lenLabel = document.getElementById('len-label');

    $.modalConfirm = document.getElementById('modal-confirm');
    $.confirmTitle = document.getElementById('confirm-title');
    $.confirmText = document.getElementById('confirm-text');

    $.modalDay = document.getElementById('modal-day');
    $.dayTitle = document.getElementById('day-title');
    $.dayInfo = document.getElementById('day-info');
    $.dayEditBtn = $.modalDay.querySelector('[data-action="day-edit"]');

    $.modalSymptoms = document.getElementById('modal-symptoms');
    $.symCard = $.modalSymptoms.querySelector('.modal-card');
    $.symDate = document.getElementById('sym-date');
    $.symSymptoms = document.getElementById('sym-symptoms');
    $.symDischarge = document.getElementById('sym-discharge');
    $.symNote = document.getElementById('sym-note');
    $.symFoot = document.getElementById('sym-foot');
    $.symConfirm = document.getElementById('sym-confirm');

    $.shareBar = document.getElementById('share-bar');
    $.modalShare = document.getElementById('modal-share');
    $.modalImage = document.getElementById('modal-image');
    $.shareImg = document.getElementById('share-img');
    $.shareSendBtn = document.getElementById('share-send');

    $.toasts = document.getElementById('toasts');
    $.fabAdd = document.getElementById('fab-add');
  }

  // === Утилиты ===

  function getToday() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function formatDateRu(date) {
    const day = date.getUTCDate();
    const month = MONTH_NAMES_GEN[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    const currentYear = getToday().getUTCFullYear();
    return year === currentYear
      ? day + ' ' + month
      : day + ' ' + month + ' ' + year;
  }

  function getMonthTitleRu(date) {
    return MONTH_NAMES_NOM[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
  }

  function getMondayWeekday(date) {
    // Date.getUTCDay: 0=Sun..6=Sat. Сдвигаем к 0=Mon..6=Sun.
    return (date.getUTCDay() + 6) % 7;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function pluralize(n, forms) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  function isSameUTCDate(a, b) {
    return a.getUTCFullYear() === b.getUTCFullYear()
        && a.getUTCMonth() === b.getUTCMonth()
        && a.getUTCDate() === b.getUTCDate();
  }

  // opts (необязательный): { duration, actionLabel, onAction }. Без него поведение
  // прежнее - текст на 3 секунды. Возвращает { el, timer } для досрочного снятия.
  function showToast(message, opts) {
    if (!$.toasts) return null;
    const duration = (opts && Number.isInteger(opts.duration)) ? opts.duration : 3000;
    const el = document.createElement('div');
    el.className = 'toast';
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);
    if (opts && opts.actionLabel && typeof opts.onAction === 'function') {
      el.classList.add('has-action');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        opts.onAction();
      });
      el.appendChild(btn);
    }
    $.toasts.appendChild(el);
    const timer = setTimeout(() => dismissToast(el), duration);
    return { el: el, timer: timer };
  }

  function dismissToast(el) {
    if (!el || !el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }

  // Отмена живёт одна: новое создание снимает предыдущий тост вместе с таймером.
  function clearUndoCreate() {
    const u = state.undoCreate;
    state.undoCreate = null;
    if (!u) return;
    clearTimeout(u.timer);
    dismissToast(u.el);
  }

  function showUndoCreateToast(id) {
    clearUndoCreate();
    const handle = showToast('Отметка добавлена', {
      duration: UNDO_TOAST_MS,
      actionLabel: 'Отменить',
      // doDelete сам перезагружает циклы, перерисовывает экран и честно говорит,
      // если удалить не вышло или строки уже нет.
      onAction: () => {
        clearUndoCreate();
        doDelete(id);
      },
    });
    if (handle) state.undoCreate = { id: id, el: handle.el, timer: handle.timer };
  }

  function formatDays(n) {
    return n + ' ' + pluralize(n, ['день', 'дня', 'дней']);
  }

  // === Вопрос о длительности ===

  // Память на время сессии: сюда пишется всегда, localStorage поверх неё.
  const memoryFlags = {};

  function readFlag(key) {
    if (Object.prototype.hasOwnProperty.call(memoryFlags, key)) return memoryFlags[key];
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // true только если значение легло в localStorage и читается обратно.
  function writeFlag(key, value) {
    memoryFlags[key] = value;
    try {
      localStorage.setItem(key, value);
      return localStorage.getItem(key) === value;
    } catch {
      return false;
    }
  }

  // Текущий цикл, про который сейчас уместно спросить длительность, иначе null.
  function getLengthAskCycle(today) {
    const current = CycleCalc.getCurrentCycle(state.cycles, today);
    if (!current || current.menstruation_length_days !== LEN_ASK_DEFAULT) return null;
    const day = CycleCalc.getCurrentCycleDay(current, today);
    if (day < LEN_ASK_FROM_DAY || day > LEN_ASK_TO_DAY) return null;
    if (readFlag(LEN_ASK_DONE_KEY) === String(current.id)) return null;
    return current;
  }

  function markLengthAsked(id) {
    if (id) writeFlag(LEN_ASK_DONE_KEY, String(id));
  }

  // Флажок один на всех, поэтому ставим его только текущему циклу: правка
  // старой записи не должна гасить вопрос про нынешний.
  function markLengthAskedIfCurrent(id) {
    const current = CycleCalc.getCurrentCycle(state.cycles, getToday());
    if (current && current.id === id) markLengthAsked(id);
  }

  function renderLengthAsk(today) {
    if (!$.lenAsk) return;
    const cycle = getLengthAskCycle(today);
    if (cycle) {
      $.lenAsk.dataset.id = cycle.id;
      $.lenAskNote.textContent = 'Сейчас записано ' + formatDays(cycle.menstruation_length_days);
      $.lenAsk.removeAttribute('hidden');
    } else {
      $.lenAsk.setAttribute('hidden', '');
      delete $.lenAsk.dataset.id;
    }
    fitRingToLengthAsk();
  }

  // Пока висит вопрос, на низком экране кольцо ужимается ровно настолько, чтобы
  // карточка встала без прокрутки. На обычном экране всё помещается и так, и
  // кольцо не меняется. Размер меряем, а не угадываем: высоту решают и окно
  // Телеграма, и кнопка возврата на вебе, и перенос строк в карточке.
  function fitRingToLengthAsk() {
    if (!$.ringWrap || !$.appMain) return;
    $.ringWrap.style.removeProperty('width');
    $.ringWrap.classList.remove('is-compact', 'is-tiny');
    // offsetParent null: карточка скрыта или экран "Сегодня" сейчас не на виду.
    if (!$.lenAsk || $.lenAsk.hidden || $.lenAsk.offsetParent === null) return;
    const overflow = $.appMain.scrollHeight - $.appMain.clientHeight;
    if (overflow <= 0) return;
    const size = Math.max(RING_MIN_SIZE, Math.floor($.ringWrap.offsetWidth - overflow - 4));
    $.ringWrap.style.width = size + 'px';
    $.ringWrap.classList.toggle('is-compact', size < RING_COMPACT_SIZE);
    $.ringWrap.classList.toggle('is-tiny', size < RING_TINY_SIZE);
  }

  function setLengthAskBusy(busy) {
    if (!$.lenAsk) return;
    $.lenAsk.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  }

  // === Render ===

  function setScreen(name) {
    $.screens.forEach((s) => {
      const isActive = s.dataset.screen === name;
      s.classList.toggle('is-active', isActive);
      if (isActive) s.removeAttribute('hidden');
      else s.setAttribute('hidden', '');
    });
    $.navBtns.forEach((b) => {
      const isActive = b.dataset.nav === name;
      if (isActive) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if ($.fabAdd) {
      const showFab = name === 'calendar' || name === 'history';
      if (showFab) $.fabAdd.removeAttribute('hidden');
      else $.fabAdd.setAttribute('hidden', '');
    }
    render();
  }

  function render() {
    state.typicalLength = CycleCalc.computeTypicalCycleLength(state.cycles);
    const active = document.querySelector('.screen.is-active');
    const name = active ? active.dataset.screen : 'main';
    updateShareBar(name);
    if (name === 'main') renderMain();
    else if (name === 'calendar') renderCalendar();
    else if (name === 'history') renderHistory();
  }

  // Полоса "Поделиться" живёт только на календаре и только когда есть что показать:
  // без единой записи календарь пуст, и кнопка была бы обманом. Класс на контейнере
  // поднимает "+", чтобы он не закрывал текст кнопки. Высоту прокручиваемой области
  // пересчитывать не нужно: .app-main тянется на flex, полоса отнимает своё сама.
  function updateShareBar(screenName) {
    if (!$.shareBar || !$.app) return;
    const visible = screenName === 'calendar' && state.cycles.length > 0;
    if (visible) $.shareBar.removeAttribute('hidden');
    else $.shareBar.setAttribute('hidden', '');
    $.app.classList.toggle('has-share-bar', visible);
  }

  function renderMain() {
    const today = getToday();
    renderLengthAsk(today);
    const current = CycleCalc.getCurrentCycle(state.cycles, today);

    if (!current) {
      $.cycleDay.textContent = '--';
      $.cyclePhase.textContent = '';
      $.cyclePrediction.textContent = 'Отметь первую менструацию';
      $.ringProgress.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE));
      $.ringWrap.style.removeProperty('--phase-color');
      return;
    }

    const day = CycleCalc.getCurrentCycleDay(current, today);
    const known = state.typicalLength !== null;

    // При неизвестной длине честно назвать можно только менструацию: она
    // отсчитывается от дня 1. getPhaseForDay проверяет её ПЕРВОЙ, поэтому её
    // ответ здесь годится, а остальные фазы (они встали бы по дефолтным 28)
    // отбрасываем.
    const rawPhase = CycleCalc.getPhaseForDay(
      day,
      current.menstruation_length_days,
      state.typicalLength
    );
    const phase = (known || rawPhase === 'menstruation') ? rawPhase : null;
    const next = CycleCalc.predictNextMenstruation(current, state.typicalLength);

    $.cycleDay.textContent = String(day);
    $.cyclePhase.textContent = PHASE_LABEL[phase] || '';
    $.cyclePrediction.textContent = known
      ? (next ? 'Следующая ~ ' + formatDateRu(next) : '')
      : 'Данных мало для прогноза';

    // Дуга показывает, какую долю цикла женщина прожила. Без типичной длины
    // доля неизвестна, и любая дуга это ложь: полный круг читается как
    // "цикл почти закончился". Поэтому дуги нет вовсе.
    if (known) {
      const progress = Math.max(0, Math.min(1, day / state.typicalLength));
      const offset = RING_CIRCUMFERENCE * (1 - progress);
      $.ringProgress.setAttribute('stroke-dashoffset', offset.toFixed(1));
    } else {
      $.ringProgress.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE));
    }

    const colorVar = PHASE_COLOR_VAR[phase];
    if (colorVar) {
      $.ringWrap.style.setProperty('--phase-color', colorVar);
    } else {
      $.ringWrap.style.removeProperty('--phase-color');
    }
  }

  function renderCalendar() {
    if (!$.calendarList) return;
    $.calendarList.innerHTML = '';
    // Записей нет, клеток нет: покраска пройдёт по пустому списку и уберёт пятую
    // строку легенды, если та осталась с прошлого показа.
    if (state.cycles.length === 0) {
      paintSymptomDots();
      return;
    }

    const today = getToday();
    const todayY = today.getUTCFullYear();
    const todayM = today.getUTCMonth();

    const months = [];
    for (let off = -CALENDAR_MONTHS_BACK; off <= CALENDAR_MONTHS_FORWARD; off++) {
      months.push(new Date(Date.UTC(todayY, todayM + off, 1)));
    }

    const fromDate = months[0];
    const lastMonth = months[months.length - 1];
    const toDate = new Date(Date.UTC(
      lastMonth.getUTCFullYear(),
      lastMonth.getUTCMonth() + 1,
      0
    ));

    const phasesMap = CycleCalc.getCalendarPhases(
      state.cycles, fromDate, toDate, state.typicalLength, today
    );

    let currentMonthEl = null;
    for (const monthDate of months) {
      const el = renderCalendarMonth(monthDate, today, phasesMap);
      $.calendarList.appendChild(el);
      if (monthDate.getUTCFullYear() === todayY && monthDate.getUTCMonth() === todayM) {
        currentMonthEl = el;
      }
    }

    paintSymptomDots();

    if (currentMonthEl) {
      requestAnimationFrame(() => {
        currentMonthEl.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    }
  }

  function renderCalendarMonth(monthDate, today, phasesMap) {
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth();
    const total = daysInMonth(year, month);
    const firstWeekday = getMondayWeekday(monthDate);

    const block = document.createElement('div');
    block.className = 'calendar-month';

    const title = document.createElement('div');
    title.className = 'calendar-month-title';
    title.textContent = getMonthTitleRu(monthDate);
    block.appendChild(title);

    const weekdays = document.createElement('div');
    weekdays.className = 'calendar-weekdays';
    for (const wd of WEEKDAY_NAMES_RU) {
      const w = document.createElement('div');
      w.className = 'calendar-weekday';
      w.textContent = wd;
      weekdays.appendChild(w);
    }
    block.appendChild(weekdays);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-cell is-empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= total; d++) {
      const dayDate = new Date(Date.UTC(year, month, d));
      const iso = CycleCalc.formatDate(dayDate);
      const info = phasesMap.get(iso) || null;
      const phase = info ? info.phase : null;
      const isFuture = dayDate.getTime() > today.getTime();
      // Прогноз определяет расчёт (происхождение дня), а не сравнение с сегодня.
      // Несбывшийся прогноз в прошлом сюда менструацией больше не приходит вовсе:
      // такой день становится обычным с точкой своей фазы.
      const isPredicted = info ? info.predicted : isFuture;

      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      if (isSameUTCDate(dayDate, today)) cell.classList.add('is-today');
      if (isPredicted) cell.classList.add('is-predicted');
      if (phase) cell.dataset.phase = phase;

      // Тап по дню открывает превью: дата, фаза, номер дня цикла. Раньше свободный
      // прошедший день открывал форму СОЗДАНИЯ с этой датой, и "Сохранить" читалось
      // как "ОК" - так появлялись случайные отметки, сдвигавшие весь прогноз.
      // Создание записи осталось на кнопке "+" и на главном экране, правка
      // существующей отметки - на кнопке внутри превью.
      cell.dataset.action = 'open-day';
      cell.dataset.date = iso;

      if (phase === 'menstruation') {
        // Розовый круг с числом (factual) или пунктирный круг (predicted)
        const span = document.createElement('span');
        span.className = isPredicted ? 'cell-menstr-pred' : 'cell-menstr';
        span.textContent = String(d);
        cell.appendChild(span);
      } else if (phase === 'ovulation') {
        // Сердце SVG (absolute по центру) + число поверх него
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 22');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#b8932a');
        svg.setAttribute('stroke-width', '1.5');
        svg.classList.add('cell-ovu-heart');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
        svg.appendChild(path);
        cell.appendChild(svg);
        const numSpan = document.createElement('span');
        numSpan.className = 'cell-ovu-num';
        numSpan.textContent = String(d);
        cell.appendChild(numSpan);
      } else if (phase === 'follicular' || phase === 'luteal') {
        // Число + цветная точка снизу (через [data-phase])
        cell.appendChild(document.createTextNode(String(d)));
        const dot = document.createElement('span');
        dot.className = 'calendar-dot';
        cell.appendChild(dot);
      } else {
        // Без фазы - только число
        cell.appendChild(document.createTextNode(String(d)));
      }

      grid.appendChild(cell);
    }

    block.appendChild(grid);
    return block;
  }

  // Точка в углу клетки у дня с отметкой самочувствия и пятая строка легенды.
  // Календарь при этом НЕ пересобирается: renderCalendar чистит список и уезжает
  // скроллом на текущий месяц, а красить надо и после загрузки отметок, и сразу
  // после сохранения, когда женщина уже листает свой месяц. Пересборка выбросила
  // бы её из него.
  //
  // Отмеченный день это наличие строки в symptomsByDate. Сюда попадает и "Всё в
  // порядке", и день с одними выделениями, и день с одной заметкой: женщина
  // отметила день, значит он отмечен.
  function paintSymptomDots() {
    if (!$.calendarList) return;
    // Красим только по достоверной карте. Пока статус не 'ok', уже нарисованные
    // точки не трогаем вовсе: данные целы, мы их просто не перезапросили, а
    // точки, исчезающие с экрана, читаются как потерянные отметки. 'loading'
    // здесь наравне с 'error': на повторной загрузке карта ещё держит прошлый
    // успешный ответ и пустой она НЕ бывает. Про загрузку и сбой честно говорит
    // превью дня.
    if (state.symptomsStatus !== 'ok') return;
    let marked = 0;

    for (const cell of $.calendarList.querySelectorAll('.calendar-cell[data-date]')) {
      const has = state.symptomsByDate.has(cell.dataset.date);
      const dot = cell.querySelector('.cell-sym');
      if (has) {
        marked++;
        if (!dot) {
          const span = document.createElement('span');
          span.className = 'cell-sym';
          cell.appendChild(span);
        }
      } else if (dot) {
        dot.remove();
      }
    }

    // Строка легенды по числу нарисованных точек, а не по отдельному проходу по
    // датам: "за видимый период есть отметки" это ровно то, что видно на экране.
    if ($.legendSym) {
      if (marked > 0) $.legendSym.removeAttribute('hidden');
      else $.legendSym.setAttribute('hidden', '');
    }
  }

  function renderHistory() {
    const items = CycleCalc.getCycleHistory(state.cycles, HISTORY_LIMIT);
    $.historyList.innerHTML = '';
    if (items.length === 0) {
      $.historyEmpty.removeAttribute('hidden');
      return;
    }
    $.historyEmpty.setAttribute('hidden', '');

    const today = getToday();
    const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
    const SVG_NS = 'http://www.w3.org/2000/svg';

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.action = 'open-edit';
      li.dataset.id = item.id;

      // Шапка: дата + длина/отклонение
      const row = document.createElement('div');
      row.className = 'history-row';

      const dateEl = document.createElement('div');
      dateEl.className = 'history-date';
      dateEl.textContent = formatDateRu(CycleCalc.parseDate(item.start_date));
      row.appendChild(dateEl);

      const meta = document.createElement('div');
      meta.className = 'history-meta';

      if (item.length === null) {
        const len = document.createElement('div');
        len.className = 'history-length';
        len.textContent = 'идёт';
        meta.appendChild(len);
      } else {
        const word = pluralize(item.length, ['день', 'дня', 'дней']);
        const len = document.createElement('div');
        len.className = 'history-length';
        len.textContent = item.length + ' ' + word;
        meta.appendChild(len);

        if (item.deviation !== null && item.deviation !== 0) {
          const sign = item.deviation > 0 ? '+' : '';
          const cls = item.deviation > 0 ? 'is-positive' : 'is-negative';
          const dev = document.createElement('div');
          dev.className = 'history-deviation ' + cls;
          dev.textContent = sign + item.deviation;
          meta.appendChild(dev);
        }
      }

      row.appendChild(meta);
      li.appendChild(row);

      // Лента дней
      const bar = document.createElement('div');
      bar.className = 'hist-bar';

      const isCurrent = item.length === null;
      let barLen, cycleLenForPhase, todayDay;
      if (isCurrent) {
        todayDay = CycleCalc.daysBetween(CycleCalc.parseDate(item.start_date), today) + 1;
        // Без типичной длины полоса обрывается на сегодня: тянуть её до
        // выдуманных 28 значит рисовать будущее, которого мы не знаем.
        cycleLenForPhase = state.typicalLength;
        barLen = cycleLenForPhase === null
          ? todayDay
          : Math.max(cycleLenForPhase, todayDay);
      } else {
        cycleLenForPhase = item.length;
        barLen = item.length;
        todayDay = item.length;
      }

      for (let d = 1; d <= barLen; d++) {
        const isFuture = isCurrent && d > todayDay;
        if (isFuture) {
          const dot = document.createElement('span');
          dot.className = 'hist-bd hist-bd-future';
          bar.appendChild(dot);
          continue;
        }
        const rawPhase = CycleCalc.getPhaseForDay(
          d, item.menstruation_length_days, cycleLenForPhase
        );
        // Без типичной длины доверяем только менструации: остальные фазы
        // встали бы по дефолтным 28.
        const phase = (cycleLenForPhase !== null || rawPhase === 'menstruation')
          ? rawPhase
          : null;
        if (phase === 'ovulation') {
          const svg = document.createElementNS(SVG_NS, 'svg');
          svg.setAttribute('viewBox', '0 0 24 22');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', '#b8932a');
          svg.setAttribute('stroke-width', '2');
          svg.classList.add('hist-heart');
          const path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', HEART_PATH);
          svg.appendChild(path);
          bar.appendChild(svg);
        } else if (phase === 'menstruation' || phase === 'follicular' || phase === 'luteal') {
          const dot = document.createElement('span');
          dot.className = 'hist-bd hist-bd-' + phase;
          bar.appendChild(dot);
        } else {
          // Фаза неизвестна. Прежде здесь стояло "phase === null - продолжение
          // лютеиновой", и ветка была МЁРТВОЙ: getPhaseForDay при dayNum >= 1
          // никогда не отдаёт null. С неизвестной типичной длиной она оживает
          // и покрасила бы лютеиновым месяц дней, про которые мы не знаем
          // ничего. Поэтому нейтральная точка, а не лютеиновая.
          const dot = document.createElement('span');
          dot.className = 'hist-bd hist-bd-unknown';
          bar.appendChild(dot);
        }
      }

      li.appendChild(bar);
      $.historyList.appendChild(li);
    }
  }

  // === Modals ===

  // При отметке задним числом длительность уже известна, и подставленная пятёрка
  // становится неправдой, которую потом никто не поправит. Поэтому поле пустое и
  // обязательное, с прямым вопросом. Только при создании: у правки число своё.
  // Введённое руками не трогаем, как бы ни менялась дата. Повторный вызов с той
  // же датой ничего не делает, поэтому годится и на input, и на change.
  function syncRetroLength() {
    const form = $.formRecord;
    if (form.elements.id.value) return;
    let retro = false;
    try {
      const start = CycleCalc.parseDate(form.elements.start_date.value);
      retro = CycleCalc.daysBetween(start, getToday()) >= RETRO_MIN_DAYS;
    } catch {
      // дата пустая или недописанная - считаем, что не задним числом
    }
    if (retro === (form.dataset.retro === '1')) return;
    form.dataset.retro = retro ? '1' : '';
    $.lenLabel.textContent = retro ? LEN_LABEL_RETRO : LEN_LABEL_DEFAULT;
    const input = form.elements.menstruation_length_days;
    if (input.dataset.touched === '1') return;
    input.value = retro ? '' : String(LEN_ASK_DEFAULT);
  }

  function openRecordModal(opts) {
    const cycle = (opts && opts.cycle) || null;
    const form = $.formRecord;

    // Режим "задним числом" и отметка о ручном вводе считаются заново при каждом открытии.
    form.dataset.retro = '';
    $.lenLabel.textContent = LEN_LABEL_DEFAULT;
    delete form.elements.menstruation_length_days.dataset.touched;

    if (cycle) {
      $.recordTitle.textContent = 'Изменить запись';
      form.elements.id.value = cycle.id;
      form.elements.start_date.value = cycle.start_date;
      form.elements.menstruation_length_days.value = cycle.menstruation_length_days || 5;
      form.elements.notes.value = cycle.notes || '';
      $.btnDeleteRecord.removeAttribute('hidden');
    } else {
      $.recordTitle.textContent = 'Отметить менструацию';
      form.reset();
      form.elements.id.value = '';
      form.elements.start_date.value = (opts && opts.date) || CycleCalc.formatDate(getToday());
      form.elements.menstruation_length_days.value = '5';
      form.elements.notes.value = '';
      $.btnDeleteRecord.setAttribute('hidden', '');
    }

    form.elements.start_date.max = CycleCalc.formatDate(getToday());
    syncRetroLength();

    $.modalRecord.removeAttribute('hidden');
  }

  function closeRecordModal() {
    $.modalRecord.setAttribute('hidden', '');
  }

  function openConfirmModal(opts) {
    $.confirmTitle.textContent = (opts && opts.title) || 'Подтверждение';
    $.confirmText.textContent = (opts && opts.text) || '';
    state.pendingConfirmAction = (opts && typeof opts.onConfirm === 'function')
      ? opts.onConfirm
      : null;
    $.modalConfirm.removeAttribute('hidden');
  }

  function closeConfirmModal() {
    $.modalConfirm.setAttribute('hidden', '');
    state.pendingConfirmAction = null;
  }

  // Превью дня. Только чтение: ни полей ввода, ни "Сохранить". Самочувствие
  // отмечают в отдельной шторке, сюда приходит только кнопка к ней.
  function openDayModal(iso) {
    let date;
    try {
      date = CycleCalc.parseDate(iso);
    } catch {
      return;
    }
    $.modalDay.dataset.date = iso;
    const today = getToday();
    // Фаза берётся тем же расчётом, что и раскраска календаря, на одну дату
    // и с теми же входами. Своей копии логики фаз здесь нет.
    const info = CycleCalc.getCalendarPhases(
      state.cycles, date, date, state.typicalLength, today
    ).get(iso) || null;

    const weekday = WEEKDAY_NAMES_RU[getMondayWeekday(date)];
    const isToday = isSameUTCDate(date, today);
    $.dayTitle.textContent = formatDateRu(date) + ', ' + weekday + (isToday ? ', сегодня' : '');

    $.dayInfo.innerHTML = '';
    if (!info) {
      // "Нет данных" правда только до первой отметки. Если день принадлежит
      // начатому циклу, отметка есть, неизвестна фаза, и старый текст врал бы
      // ровно тем способом, который мы здесь и чиним.
      const owning = CycleCalc.getCurrentCycle(state.cycles, date);
      const ownedDay = owning ? CycleCalc.getCurrentCycleDay(owning, date) : null;
      const lived = ownedDay !== null && ownedDay >= 1
        && date.getTime() <= today.getTime();

      const empty = document.createElement('div');
      empty.className = 'day-empty';
      if (lived) {
        empty.textContent = 'День цикла: ' + ownedDay + '. Фаза неизвестна, отметок мало';
      } else if (owning) {
        empty.textContent = 'Прогноза нет, отметок мало';
      } else {
        empty.textContent = 'Нет данных';
      }
      $.dayInfo.appendChild(empty);
    } else {
      const phaseRow = document.createElement('div');
      phaseRow.className = 'day-row';
      phaseRow.dataset.phase = info.phase;
      const dot = document.createElement('span');
      dot.className = 'day-dot';
      phaseRow.appendChild(dot);
      const label = document.createElement('span');
      label.textContent = (PHASE_LABEL[info.phase] || '') + (info.predicted ? ', прогноз' : '');
      phaseRow.appendChild(label);
      $.dayInfo.appendChild(phaseRow);

      // День цикла только для прожитых дней: у прогнозного дня номер считается
      // от последней реальной отметки и рядом со словом "прогноз" вводит в заблуждение.
      if (!info.predicted) {
        const cycle = CycleCalc.getCurrentCycle(state.cycles, date);
        const dayNum = CycleCalc.getCurrentCycleDay(cycle, date);
        if (dayNum !== null && dayNum >= 1) {
          const dayRow = document.createElement('div');
          dayRow.className = 'day-row';
          dayRow.textContent = 'День цикла: ' + dayNum;
          $.dayInfo.appendChild(dayRow);
        }
      }
    }

    renderDaySymptoms(iso, date, today);

    const editId = (info && info.phase === 'menstruation' && info.cycleId) ? info.cycleId : null;
    if (editId) {
      $.dayEditBtn.dataset.id = editId;
      $.dayEditBtn.removeAttribute('hidden');
    } else {
      delete $.dayEditBtn.dataset.id;
      $.dayEditBtn.setAttribute('hidden', '');
    }

    $.modalDay.removeAttribute('hidden');
  }

  function closeDayModal() {
    $.modalDay.setAttribute('hidden', '');
  }

  // === Самочувствие ===

  // Строка дня из ответа сервера в форму, с которой работает экран.
  function normalizeSymptomDay(d) {
    return {
      symptoms: Array.isArray(d.symptoms) ? d.symptoms : [],
      discharge: Array.isArray(d.discharge) ? d.discharge : [],
      note: typeof d.note === 'string' ? d.note : null,
    };
  }

  // Коды из набора в порядке списка. Код не из списка сюда не проходит.
  function optionCodes(options, selected) {
    return options.filter((o) => selected.has(o.code)).map((o) => o.code);
  }

  // Строка для превью: подписи со второй с маленькой буквы, чтобы читалось фразой.
  // Код не из списка (если Ирена что-то уберёт) не показываем, подписи для него нет.
  function describeSymptomDay(day) {
    const parts = [];
    const symptoms = SYMPTOM_OPTIONS
      .filter((o) => day.symptoms.includes(o.code))
      .map((o, i) => (i === 0 ? o.label : o.label.toLowerCase()));
    if (symptoms.length) parts.push(symptoms.join(', '));
    if (day.discharge.includes(SYMPTOM_KINDS.discharge.exclusive)) {
      parts.push('Выделений нет');
    } else {
      const discharge = DISCHARGE_OPTIONS
        .filter((o) => day.discharge.includes(o.code))
        .map((o) => o.label.toLowerCase());
      if (discharge.length) parts.push('Выделения: ' + discharge.join(', '));
    }
    if (day.note) parts.push('«' + day.note + '»');
    return parts.join('. ');
  }

  // Блок в превью дня: что отмечено и кнопка в шторку. У будущего дня блока нет,
  // отмечают то, что было. Пока отметки не загрузились или загрузка упала, писать
  // "Не отмечено" нельзя, и в шторку не пускаем: сохранение заменяет день целиком
  // и затёрло бы отметки, которых экран не видел.
  function renderDaySymptoms(iso, date, today) {
    if (date.getTime() > today.getTime()) return;

    const block = document.createElement('div');
    block.className = 'day-sym';
    const title = document.createElement('div');
    title.className = 'form-label';
    title.textContent = 'Самочувствие';
    block.appendChild(title);

    const text = document.createElement('div');
    text.className = 'day-sym-text';
    block.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary btn-block';
    btn.dataset.date = iso;

    if (state.symptomsStatus === 'ok') {
      const day = state.symptomsByDate.get(iso) || null;
      text.textContent = day ? describeSymptomDay(day) : 'Не отмечено';
      text.classList.toggle('is-muted', !day);
      btn.dataset.action = 'open-symptoms';
      btn.textContent = day ? 'Изменить самочувствие' : 'Отметить самочувствие';
    } else if (state.symptomsStatus === 'loading') {
      text.textContent = 'Загружаем отметки';
      text.classList.add('is-muted');
      btn.textContent = 'Отметить самочувствие';
      btn.disabled = true;
    } else {
      text.textContent = 'Не удалось загрузить отметки';
      text.classList.add('is-muted');
      btn.dataset.action = 'symptoms-retry';
      btn.textContent = 'Повторить';
    }
    block.appendChild(btn);
    $.dayInfo.appendChild(block);
  }

  // Превью открыто, а отметки догрузились или упали: перерисовать его на месте.
  function refreshOpenDayModal() {
    if ($.modalDay && !$.modalDay.hidden && $.modalDay.dataset.date) {
      openDayModal($.modalDay.dataset.date);
    }
  }

  // Шторка отметки. Черновик живёт, только пока она открыта, и только в памяти.
  const symptomsSheet = {
    date: null,            // YYYY-MM-DD открытого дня
    draft: null,           // { symptoms: Set, discharge: Set }
    initial: null,         // снимок на момент открытия: есть ли что терять при закрытии
    saving: false,
    closingConfirm: false, // что сейчас выставлено Телеграму
  };

  // Варианты рисуются один раз из списков выше: подписи живут в одном месте.
  // Исключающий вариант идёт первым на всю ширину, остальные сеткой в две колонки.
  function buildSymptomOptions() {
    for (const kind of Object.keys(SYMPTOM_KINDS)) {
      const host = kind === 'symptoms' ? $.symSymptoms : $.symDischarge;
      if (host.childElementCount > 0) continue;
      const cfg = SYMPTOM_KINDS[kind];
      const grid = document.createElement('div');
      grid.className = 'sym-grid';
      for (const opt of cfg.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sym-chip';
        b.dataset.action = 'symptom-toggle';
        b.dataset.kind = kind;
        b.dataset.code = opt.code;
        b.setAttribute('aria-pressed', 'false');
        b.textContent = opt.label;
        if (opt.code === cfg.exclusive) {
          b.classList.add('is-wide');
          host.appendChild(b);
        } else {
          grid.appendChild(b);
        }
      }
      host.appendChild(grid);
    }
  }

  function syncSymptomChips() {
    const draft = symptomsSheet.draft;
    $.modalSymptoms.querySelectorAll('.sym-chip').forEach((b) => {
      const set = draft && draft[b.dataset.kind];
      b.setAttribute('aria-pressed', set && set.has(b.dataset.code) ? 'true' : 'false');
    });
  }

  function currentSymptomsSnapshot() {
    const draft = symptomsSheet.draft;
    return JSON.stringify([
      optionCodes(SYMPTOM_OPTIONS, draft.symptoms),
      optionCodes(DISCHARGE_OPTIONS, draft.discharge),
      $.symNote.value.trim(),
    ]);
  }

  function isSymptomsDirty() {
    return !!symptomsSheet.draft && currentSymptomsSnapshot() !== symptomsSheet.initial;
  }

  // Свайп вниз и крестик Телеграма закрывают всё приложение мимо шторки. Пока есть
  // несохранённое, просим Телеграм переспросить. Ниже 6.2 и на вебе (там SDK
  // сообщает 6.0) не зовём вовсе: SDK на каждый вызов пишет предупреждение.
  function setClosingConfirmation(on) {
    if (symptomsSheet.closingConfirm === on) return;
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData || typeof tg.isVersionAtLeast !== 'function' || !tg.isVersionAtLeast('6.2')) {
      return;
    }
    try {
      if (on) tg.enableClosingConfirmation();
      else tg.disableClosingConfirmation();
      symptomsSheet.closingConfirm = on;
    } catch {
      // Переспрос при закрытии это страховка, шторку он ломать не должен.
    }
  }

  function updateClosingConfirmation() {
    setClosingConfirmation(!$.modalSymptoms.hidden && isSymptomsDirty());
  }

  // Подтверждение живёт внутри шторки на месте ряда кнопок: общее окно
  // подтверждения заточено под удаление записи, его не трогаем.
  function showSymptomsConfirm(on) {
    $.symFoot.hidden = on;
    $.symConfirm.hidden = !on;
  }

  function setSymptomsSaving(saving) {
    symptomsSheet.saving = saving;
    $.modalSymptoms.querySelectorAll('button, textarea').forEach((el) => {
      el.disabled = saving;
    });
  }

  function openSymptomsSheet(iso) {
    if (state.symptomsStatus !== 'ok') return;
    let date;
    try {
      date = CycleCalc.parseDate(iso);
    } catch {
      return;
    }
    if (date.getTime() > getToday().getTime()) return;

    buildSymptomOptions();
    const day = state.symptomsByDate.get(iso) || null;
    symptomsSheet.date = iso;
    symptomsSheet.draft = {
      symptoms: new Set(optionCodes(SYMPTOM_OPTIONS, new Set(day ? day.symptoms : []))),
      discharge: new Set(optionCodes(DISCHARGE_OPTIONS, new Set(day ? day.discharge : []))),
    };
    $.symNote.value = (day && day.note) || '';
    symptomsSheet.initial = currentSymptomsSnapshot();

    $.symDate.textContent = formatDateRu(date) + ', ' + WEEKDAY_NAMES_RU[getMondayWeekday(date)];
    syncSymptomChips();
    showSymptomsConfirm(false);
    setSymptomsSaving(false);

    closeDayModal();
    $.modalSymptoms.removeAttribute('hidden');
    $.symCard.scrollTop = 0;
  }

  // Закрытие всегда возвращает в превью того же дня, уже с новыми отметками.
  function closeSymptomsSheet() {
    const iso = symptomsSheet.date;
    $.modalSymptoms.setAttribute('hidden', '');
    showSymptomsConfirm(false);
    symptomsSheet.date = null;
    symptomsSheet.draft = null;
    symptomsSheet.initial = null;
    $.symNote.value = '';
    setClosingConfirmation(false);
    if (iso) openDayModal(iso);
  }

  // Отмена и тап по фону: без изменений закрываем молча, с изменениями переспрашиваем.
  function requestCloseSymptomsSheet() {
    if (symptomsSheet.saving) return;
    if (isSymptomsDirty()) {
      showSymptomsConfirm(true);
      return;
    }
    closeSymptomsSheet();
  }

  function toggleSymptom(kind, code) {
    const cfg = SYMPTOM_KINDS[kind];
    const set = symptomsSheet.draft && symptomsSheet.draft[kind];
    if (!cfg || !set || symptomsSheet.saving) return;
    if (set.has(code)) {
      set.delete(code);
    } else if (code === cfg.exclusive) {
      set.clear();
      set.add(code);
    } else {
      set.delete(cfg.exclusive);
      set.add(code);
    }
    syncSymptomChips();
    showSymptomsConfirm(false);
    updateClosingConfirmation();
  }

  async function saveSymptomsSheet() {
    if (symptomsSheet.saving || !symptomsSheet.draft) return;
    // Ничего не поменялось: запрос не нужен, просто назад в превью.
    if (!isSymptomsDirty()) {
      closeSymptomsSheet();
      return;
    }
    const iso = symptomsSheet.date;
    const draft = symptomsSheet.draft;
    const payload = {
      date: iso,
      symptoms: optionCodes(SYMPTOM_OPTIONS, draft.symptoms),
      discharge: optionCodes(DISCHARGE_OPTIONS, draft.discharge),
      note: $.symNote.value.trim() || null,
    };

    setSymptomsSaving(true);
    let res;
    try {
      res = await CyclesApi.symptomsSave(payload);
    } catch (err) {
      setSymptomsSaving(false);
      // Шторка остаётся открытой со всеми выборами, повторить можно тем же тапом.
      if (err && err.message !== 'token_expired') showToast('Не удалось сохранить');
      return;
    }

    // В память кладём день из ответа сервера, а не свой черновик.
    if (res && res.day) {
      state.symptomsByDate.set(iso, normalizeSymptomDay(res.day));
    } else {
      state.symptomsByDate.delete(iso);
    }
    // Точка за этот день появляется или уходит сразу, скролл календаря на месте.
    paintSymptomDots();
    setSymptomsSaving(false);
    closeSymptomsSheet();
    showToast(res && res.day ? 'Сохранено' : 'Отметки дня удалены');
  }

  // === Картинка с датами цикла ===

  function openShareModal() {
    $.modalShare.removeAttribute('hidden');
  }

  function closeShareModal() {
    $.modalShare.setAttribute('hidden', '');
  }

  // Пояснение про заливку и контур. На узкой картинке (один месяц) строка
  // не помещается целиком, поэтому режем её на две заранее, одним местом
  // и для расчёта высоты, и для рисования.
  function shareLegendLines(cols, hasForecast) {
    // Прогноза в картинке нет, когда отметок мало. Обещать контур в такой
    // картинке нельзя: его никто не нарисует.
    if (!hasForecast) {
      return ['Сплошной кружок - отмеченный день'];
    }
    return cols === 1
      ? ['Сплошной кружок - отмеченный день,', 'контур - прогноз']
      : ['Сплошной кружок - отмеченный день, контур - прогноз'];
  }

  // Пункты легенды повторяют то, что реально нарисовано в сетке. Без прогноза
  // овуляции в картинке нет вовсе, и обещать её кружком нельзя.
  function shareLegendItems(hasForecast) {
    const items = [{ phase: 'menstruation', label: 'Менструация', radius: 9 }];
    if (hasForecast) {
      items.push({ phase: 'ovulation', label: 'Овуляция', radius: SHARE_OVU_DOT_R });
    }
    return items;
  }

  function shareLegendRows(cols, hasForecast) {
    // Пункты всегда встают в один ряд, дальше идут строки пояснения.
    return 1 + shareLegendLines(cols, hasForecast).length;
  }

  // Цвета берём из тех же переменных CSS, что и экран: палитра картинки
  // не может разойтись с палитрой приложения.
  function sharePalette() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => {
      const v = (css.getPropertyValue(name) || '').trim();
      return v || fallback;
    };
    return {
      bg: pick('--bg-primary', '#fbf6f1'),
      ink: pick('--text-primary', '#3a2a2a'),
      muted: pick('--text-muted', 'rgba(58, 42, 42, 0.55)'),
      phases: {
        menstruation: pick('--color-menstruation', '#e8a5a0'),
        follicular: pick('--color-follicular', '#a8d8c5'),
        ovulation: pick('--color-ovulation', '#e8c878'),
        luteal: pick('--color-luteal', '#c5b4d8'),
      },
    };
  }

  // Google Fonts отдаёт шрифт подмножествами по диапазонам символов, и для canvas
  // кириллическое подмножество может быть ещё не загружено. Просим его явно, со
  // строкой нужных букв. Таймаут - на случай заблокированного шрифтового CDN:
  // системный шрифт кириллицу знает, поэтому худший случай это другое начертание.
  async function ensureShareFonts() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return;
    const sample = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя 0123456789';
    const wait = Promise.all([
      document.fonts.load('400 40px "Raleway"', sample),
      document.fonts.load('300 40px "Raleway"', sample),
      document.fonts.load('italic 400 40px "Cormorant Garamond"', sample),
    ]);
    const timeout = new Promise((resolve) => setTimeout(resolve, SHARE_FONT_TIMEOUT_MS));
    try {
      await Promise.race([wait, timeout]);
    } catch {
      // Шрифт не приехал - рисуем тем, что есть.
    }
  }

  function drawShareMonth(ctx, monthDate, x, y, phasesMap, palette) {
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth();
    const total = daysInMonth(year, month);
    const firstWeekday = getMondayWeekday(monthDate);
    const blockW = SHARE_CELL * 7;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'italic 400 30px ' + SHARE_FONT_TITLE;
    ctx.fillStyle = palette.ink;
    ctx.fillText(MONTH_NAMES_NOM[month] + ' ' + year, x + blockW / 2, y + SHARE_TITLE_H / 2);

    ctx.font = '400 18px ' + SHARE_FONT_BODY;
    ctx.fillStyle = palette.muted;
    for (let i = 0; i < 7; i++) {
      ctx.fillText(
        WEEKDAY_NAMES_RU[i],
        x + i * SHARE_CELL + SHARE_CELL / 2,
        y + SHARE_TITLE_H + SHARE_WEEKDAY_H / 2
      );
    }

    const gridTop = y + SHARE_TITLE_H + SHARE_WEEKDAY_H;
    for (let d = 1; d <= total; d++) {
      const idx = firstWeekday + d - 1;
      const cx = x + (idx % 7) * SHARE_CELL + SHARE_CELL / 2;
      const cy = gridTop + Math.floor(idx / 7) * SHARE_CELL + SHARE_CELL / 2;
      const info = phasesMap.get(CycleCalc.formatDate(new Date(Date.UTC(year, month, d)))) || null;
      const phase = info ? info.phase : null;

      // Иерархия: главное это менструация, только у неё круг. Овуляция уходит
      // на второй план точкой под числом, фолликулярная и лютеиновая на картинке
      // не показываются вовсе - от них остаётся голое число.
      if (phase === 'menstruation') {
        ctx.beginPath();
        ctx.arc(cx, cy, SHARE_CELL * 0.4, 0, Math.PI * 2);
        if (info.predicted) {
          // Прогноз - контур. Прожитый день с отметкой - заливка.
          ctx.strokeStyle = palette.phases.menstruation;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = palette.phases.menstruation;
          ctx.fill();
        }
      }

      ctx.font = '400 24px ' + SHARE_FONT_BODY;
      ctx.fillStyle = palette.ink;
      ctx.fillText(String(d), cx, phase === 'ovulation' ? cy - 2 : cy);

      if (phase === 'ovulation') {
        // Прожитый и прогнозный день овуляции выглядят одинаково: разница
        // важна только для менструации.
        ctx.beginPath();
        ctx.arc(cx, cy + SHARE_OVU_DOT_DY, SHARE_OVU_DOT_R, 0, Math.PI * 2);
        ctx.fillStyle = palette.phases.ovulation;
        ctx.fill();
      }
    }
  }

  function drawShareLegend(ctx, x, y, width, cols, palette, hasForecast) {
    // Метка каждого пункта повторяет то, что нарисовано в сетке: у менструации
    // круг, у овуляции маленькая точка. Без прогноза овуляции в сетке нет,
    // и пункт про неё не рисуется.
    const items = shareLegendItems(hasForecast);
    const colW = width / items.length;

    ctx.textBaseline = 'middle';
    ctx.font = '400 18px ' + SHARE_FONT_BODY;
    // Единственный пункт не растягиваем на всю ширину: он встал бы у левого
    // края, а строка пояснения под ним центрирована.
    const single = items.length === 1;
    for (let i = 0; i < items.length; i++) {
      const itemW = items[i].radius + 16 + ctx.measureText(items[i].label).width;
      const cx = single
        ? x + (width - itemW) / 2 + items[i].radius
        : x + i * colW + 10;
      const cy = y + SHARE_LEGEND_ROW_H / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, items[i].radius, 0, Math.PI * 2);
      ctx.fillStyle = palette.phases[items[i].phase];
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = palette.ink;
      ctx.fillText(items[i].label, cx + 16, cy);
    }

    const lines = shareLegendLines(cols, hasForecast);
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.muted;
    for (let i = 0; i < lines.length; i++) {
      const cy = y + (1 + i) * SHARE_LEGEND_ROW_H + SHARE_LEGEND_ROW_H / 2;
      ctx.fillText(lines[i], x + width / 2, cy);
    }
  }

  function shareWeeksInMonth(monthDate) {
    const total = daysInMonth(monthDate.getUTCFullYear(), monthDate.getUTCMonth());
    return Math.ceil((getMondayWeekday(monthDate) + total) / 7);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        reject(new Error('no_toblob'));
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('empty_blob'));
      }, 'image/png');
    });
  }

  function buildShareImage(monthsCount) {
    const today = getToday();
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const months = [];
    for (let i = 0; i < monthsCount; i++) {
      months.push(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)));
    }
    const last = months[months.length - 1];
    const toDate = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0));

    // Тот же расчёт и те же входы, что и у экранного календаря.
    const phasesMap = CycleCalc.getCalendarPhases(
      state.cycles, first, toDate, state.typicalLength, today
    );

    const cols = Math.min(months.length, SHARE_COLS);
    const rows = Math.ceil(months.length / cols);
    const blockW = SHARE_CELL * 7;
    // Для одного месяца берём его настоящее число недель, иначе внизу остаётся
    // пустая полоса. В сетке из нескольких месяцев блоки держим одинаковыми.
    const weeks = months.length === 1 ? shareWeeksInMonth(months[0]) : SHARE_WEEKS;
    const blockH = SHARE_TITLE_H + SHARE_WEEKDAY_H + weeks * SHARE_CELL;
    const gridW = cols * blockW + (cols - 1) * SHARE_GAP;
    const gridH = rows * blockH + (rows - 1) * SHARE_GAP;
    // Прогноз рисуется только когда есть типичная длина цикла. Флаг решает и
    // состав легенды, и подпись сверху, чтобы картинка не обещала лишнего.
    const hasForecast = state.typicalLength !== null;
    const legendH = shareLegendRows(cols, hasForecast) * SHARE_LEGEND_ROW_H;
    const logicalW = SHARE_PAD * 2 + gridW;
    const logicalH = SHARE_PAD * 2 + SHARE_CAPTION_H + gridH + SHARE_GAP + legendH;
    const scale = Math.min(
      SHARE_MAX_SCALE,
      SHARE_MAX_SIDE / logicalW,
      SHARE_MAX_SIDE / logicalH
    );

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(logicalW * scale);
    canvas.height = Math.round(logicalH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_context');
    ctx.scale(scale, scale);

    const palette = sharePalette();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, logicalW, logicalH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 22px ' + SHARE_FONT_BODY;
    ctx.fillStyle = palette.muted;
    // Без прогноза прежняя подпись обещала бы то, чего в картинке нет.
    const caption = hasForecast
      ? 'Прогноз, даты могут сдвинуться'
      : 'Отмеченные дни';
    ctx.fillText(caption, logicalW / 2, SHARE_PAD + SHARE_CAPTION_H / 2);

    const gridTop = SHARE_PAD + SHARE_CAPTION_H;
    for (let i = 0; i < months.length; i++) {
      const x = SHARE_PAD + (i % cols) * (blockW + SHARE_GAP);
      const y = gridTop + Math.floor(i / cols) * (blockH + SHARE_GAP);
      drawShareMonth(ctx, months[i], x, y, phasesMap, palette);
    }

    drawShareLegend(ctx, SHARE_PAD, gridTop + gridH + SHARE_GAP, gridW, cols, palette, hasForecast);

    return canvasToBlob(canvas);
  }

  async function handleShareRange(monthsCount) {
    if (state.isLoading) return;
    closeShareModal();
    state.isLoading = true;
    try {
      await ensureShareFonts();
      const blob = await buildShareImage(monthsCount);
      openImageModal(blob, monthsCount);
    } catch (err) {
      showToast('Не удалось собрать картинку');
    } finally {
      state.isLoading = false;
    }
  }

  function makeShareFile(blob, monthsCount) {
    if (typeof File !== 'function') return null;
    try {
      return new File([blob], 'cycle-' + monthsCount + 'm.png', { type: 'image/png' });
    } catch {
      return null;
    }
  }

  function openImageModal(blob, monthsCount) {
    closeImageModal();
    const file = makeShareFile(blob, monthsCount);
    const url = URL.createObjectURL(blob);
    state.shareImage = { url: url, file: file };
    $.shareImg.src = url;

    // Кнопку показываем только когда браузер подтвердил, что умеет делиться файлом.
    // Основной путь - долгое нажатие по картинке, он работает всегда.
    const canShare = !!(file && typeof navigator.share === 'function'
      && navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShare) $.shareSendBtn.removeAttribute('hidden');
    else $.shareSendBtn.setAttribute('hidden', '');

    $.modalImage.removeAttribute('hidden');
  }

  function closeImageModal() {
    $.modalImage.setAttribute('hidden', '');
    $.shareImg.removeAttribute('src');
    if (state.shareImage) {
      URL.revokeObjectURL(state.shareImage.url);
      state.shareImage = null;
    }
  }

  async function handleShareImage() {
    const data = state.shareImage;
    if (!data || !data.file) return;
    try {
      await navigator.share({ files: [data.file] });
    } catch (err) {
      // Отмена самой женщиной - не ошибка, молчим.
      if (err && err.name === 'AbortError') return;
      showToast('Не удалось отправить, сохрани долгим нажатием');
    }
  }

  // === Action handlers ===

  async function handleSubmitRecord(form) {
    if (state.isLoading) return;

    const id = form.elements.id.value.trim();
    const start_date = form.elements.start_date.value;
    const lenRaw = form.elements.menstruation_length_days.value;
    const notesRaw = form.elements.notes.value.trim();
    // Длительность вписана руками. Только тогда число считается ответом на вопрос:
    // сохранение правки ради даты или заметки пятёрку не подтверждает.
    const lenChosen = form.elements.menstruation_length_days.dataset.touched === '1';

    if (!start_date) {
      showToast('Укажи дату');
      return;
    }
    const len = parseInt(lenRaw, 10);
    if (!Number.isInteger(len) || len < 1 || len > 14) {
      showToast('Длительность 1-14 дней');
      return;
    }

    const payload = {
      start_date: start_date,
      menstruation_length_days: len,
      notes: notesRaw || null,
    };

    let createdId = null;
    state.isLoading = true;
    try {
      if (id) {
        const res = await CyclesApi.update({ id: id, ...payload });
        if (res && res.affected === 0) {
          showToast('Запись не найдена');
          closeRecordModal();
          await loadCycles();
          render();
          return;
        }
      } else {
        const exists = state.cycles.some((c) => c.start_date === start_date);
        if (exists) {
          showToast('На эту дату уже есть запись');
          return;
        }
        const res = await CyclesApi.create(payload);
        createdId = (res && res.cycle && res.cycle.id) ? res.cycle.id : null;
      }
      closeRecordModal();
      await loadCycles();
      // Число выбрано в форме: спрашивать о нём ещё и карточкой незачем.
      if (lenChosen) markLengthAskedIfCurrent(id || createdId);
      render();
    } catch (err) {
      createdId = null;
      if (err && err.message !== 'token_expired') {
        showToast('Не удалось сохранить');
      }
    } finally {
      state.isLoading = false;
    }
    // Тост с отменой показываем после снятия isLoading, иначе тап по "Отменить"
    // упрётся в защиту от повторного запроса внутри doDelete.
    if (createdId) showUndoCreateToast(createdId);
  }

  function handleDeleteRecord() {
    const id = $.formRecord.elements.id.value.trim();
    if (!id) return;
    openConfirmModal({
      title: 'Удалить отметку?',
      text: 'Действие можно отменить только через поддержку.',
      onConfirm: () => doDelete(id),
    });
  }

  async function doDelete(id) {
    if (state.isLoading) return;
    state.isLoading = true;
    try {
      const res = await CyclesApi.delete({ id: id });
      closeConfirmModal();
      closeRecordModal();
      await loadCycles();
      render();
      // deleted === false: сервер не нашёл строку (уже удалена или чужой id).
      // Раньше в этом случае всё равно рапортовали об успехе.
      showToast(res && res.deleted === false ? 'Эта отметка уже удалена' : 'Отметка удалена');
    } catch (err) {
      if (err && err.message !== 'token_expired') {
        showToast('Не удалось удалить');
      }
    } finally {
      state.isLoading = false;
    }
  }

  function handleOpenEdit(id) {
    const cycle = state.cycles.find((c) => c.id === id);
    if (!cycle) {
      showToast('Запись не найдена');
      loadCycles().then(render).catch(() => {});
      return;
    }
    openRecordModal({ cycle: cycle });
  }

  // Правка одной длительности. update частичный: дата и заметки не трогаются.
  // true - сервер записал. Экран перерисовывает вызывающий.
  async function saveLength(id, len, failText) {
    if (state.isLoading) return false;
    state.isLoading = true;
    setLengthAskBusy(true);
    let saved = false;
    try {
      const res = await CyclesApi.update({ id: id, menstruation_length_days: len });
      if (res && res.affected === 0) {
        showToast('Запись не найдена');
      } else {
        saved = true;
        // Сразу и локально: если перечитать список не выйдет, экран всё равно
        // покажет записанное число, а не прежнее.
        const local = state.cycles.find((c) => c.id === id);
        if (local) local.menstruation_length_days = len;
      }
      try {
        await loadCycles();
      } catch {
        // тост уже показан в loadCycles
      }
    } catch (err) {
      if (err && err.message !== 'token_expired') showToast(failText);
    } finally {
      state.isLoading = false;
      setLengthAskBusy(false);
    }
    return saved;
  }

  async function handleLengthPick(id, len) {
    if (state.isLoading) return;
    const cycle = state.cycles.find((c) => c.id === id);
    if (!cycle) {
      renderMain();
      return;
    }
    const prev = cycle.menstruation_length_days;
    if (len === prev) {
      // То же число: писать нечего, это подтверждение.
      markLengthAsked(id);
      renderMain();
      showToast('Спасибо, так и оставим');
      return;
    }
    const saved = await saveLength(id, len, 'Не удалось сохранить');
    if (saved) markLengthAsked(id);
    render();
    if (!saved) return;
    // Смену можно откатить: число, ткнутое лишь бы убрать карточку, не должно
    // молча портить прогноз.
    const handle = showToast('Готово: ' + formatDays(len), {
      duration: UNDO_TOAST_MS,
      actionLabel: 'Вернуть',
      onAction: async () => {
        const back = await saveLength(id, prev, 'Не удалось вернуть');
        if (handle) {
          clearTimeout(handle.timer);
          dismissToast(handle.el);
        }
        render();
        if (back) showToast('Снова ' + formatDays(prev));
      },
    });
  }

  // Нужного числа нет среди 3-7: открываем обычную правку записи. Ушла в форму -
  // вопрос считаем отвеченным, даже если закроет без сохранения: число перед ней.
  function handleLengthOther(id) {
    markLengthAsked(id);
    renderMain();
    handleOpenEdit(id);
  }

  // === Events (делегирование) ===

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        const screen = navBtn.dataset.nav;
        if (screen) setScreen(screen);
        return;
      }

      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;

      switch (action) {
        case 'open-record':
          openRecordModal();
          break;
        case 'open-day': {
          const date = actionEl.dataset.date;
          if (date) openDayModal(date);
          break;
        }
        case 'close-day':
          closeDayModal();
          break;
        case 'open-symptoms': {
          const date = actionEl.dataset.date;
          if (date) openSymptomsSheet(date);
          break;
        }
        case 'symptoms-retry':
          loadSymptoms();
          refreshOpenDayModal();
          break;
        case 'symptom-toggle':
          toggleSymptom(actionEl.dataset.kind, actionEl.dataset.code);
          break;
        case 'symptoms-cancel':
          requestCloseSymptomsSheet();
          break;
        case 'symptoms-keep':
          showSymptomsConfirm(false);
          break;
        case 'symptoms-discard':
          closeSymptomsSheet();
          break;
        case 'symptoms-save':
          saveSymptomsSheet();
          break;
        case 'open-share':
          openShareModal();
          break;
        case 'close-share':
          closeShareModal();
          break;
        case 'share-range': {
          const months = parseInt(actionEl.dataset.months, 10);
          if (Number.isInteger(months) && months > 0) handleShareRange(months);
          break;
        }
        case 'close-image':
          closeImageModal();
          break;
        case 'share-image':
          handleShareImage();
          break;
        case 'day-edit': {
          const editId = actionEl.dataset.id;
          closeDayModal();
          if (editId) handleOpenEdit(editId);
          break;
        }
        case 'close-modal':
          closeRecordModal();
          break;
        case 'delete-record':
          handleDeleteRecord();
          break;
        case 'open-edit': {
          const id = actionEl.dataset.id;
          if (id) handleOpenEdit(id);
          break;
        }
        case 'close-confirm':
          closeConfirmModal();
          break;
        case 'confirm-yes': {
          const fn = state.pendingConfirmAction;
          if (typeof fn === 'function') fn();
          break;
        }
        case 'len-ask-pick': {
          const id = $.lenAsk.dataset.id;
          const len = parseInt(actionEl.dataset.len, 10);
          if (id && Number.isInteger(len)) handleLengthPick(id, len);
          break;
        }
        case 'len-ask-close': {
          const id = $.lenAsk.dataset.id;
          if (id) {
            markLengthAsked(id);
            renderMain();
          }
          break;
        }
        case 'len-ask-other': {
          const id = $.lenAsk.dataset.id;
          if (id) handleLengthOther(id);
          break;
        }
      }
    });

    $.formRecord.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmitRecord(e.target);
    });

    // Поле даты в разных WebView шлёт то input, то change, слушаем оба.
    const startInput = $.formRecord.elements.start_date;
    startInput.addEventListener('input', syncRetroLength);
    startInput.addEventListener('change', syncRetroLength);
    $.formRecord.elements.menstruation_length_days.addEventListener('input', (e) => {
      e.target.dataset.touched = '1';
    });

    $.symNote.addEventListener('input', () => {
      showSymptomsConfirm(false);
      updateClosingConfirmation();
    });

    // Окно Телеграма меняет высоту (разворот, поворот), кольцо под карточкой пересчитываем.
    window.addEventListener('resize', fitRingToLengthAsk);
  }

  // === Loading ===

  async function loadCycles() {
    try {
      const res = await CyclesApi.list({ limit: FETCH_LIMIT });
      state.cycles = (res && Array.isArray(res.cycles)) ? res.cycles : [];
    } catch (err) {
      if (err && err.message !== 'token_expired') {
        showToast('Не удалось загрузить циклы');
      }
      throw err;
    }
  }

  // Отметки самочувствия грузятся за прошлую часть календаря: с первого числа
  // CALENDAR_MONTHS_BACK месяцев назад по сегодня. Будущих отметок не бывает.
  function getSymptomsRange(today) {
    const from = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth() - CALENDAR_MONTHS_BACK,
      1
    ));
    return { from: CycleCalc.formatDate(from), to: CycleCalc.formatDate(today) };
  }

  // Номер последней загрузки: запоздавший ответ прежней загрузки не затирает свежий.
  let symptomsLoadSeq = 0;

  // Не бросает никогда: сбой отметок не должен мешать циклам и календарю. Тоста
  // нет намеренно, женщина ещё ничего не просила; что отметки не загрузились,
  // скажет превью дня. 401 уже обработан в auth.js экраном доступа.
  async function loadSymptoms() {
    const seq = ++symptomsLoadSeq;
    state.symptomsStatus = 'loading';
    try {
      const res = await CyclesApi.symptomsList(getSymptomsRange(getToday()));
      if (seq !== symptomsLoadSeq) return;
      const map = new Map();
      const days = (res && Array.isArray(res.days)) ? res.days : [];
      for (const d of days) {
        if (!d || typeof d.date !== 'string') continue;
        map.set(d.date, normalizeSymptomDay(d));
      }
      state.symptomsByDate = map;
      state.symptomsStatus = 'ok';
    } catch {
      if (seq !== symptomsLoadSeq) return;
      state.symptomsStatus = 'error';
    }
    // Календарь мог отрисоваться раньше ответа: доставить точки на место.
    paintSymptomDots();
    // Превью могли открыть, пока шли отметки: перерисовать его с настоящим ответом.
    refreshOpenDayModal();
  }

  // === Init ===

  async function init() {
    cacheDom();
    bindEvents();

    const ok = await IrenaAuth.checkAccess();
    if (!ok) return;

    // Отметки идут параллельно с циклами и первый показ НЕ ждут: медленный ответ
    // не должен задерживать календарь. Ошибки loadSymptoms гасит сама.
    loadSymptoms();

    try {
      await loadCycles();
    } catch {
      // toast уже показан в loadCycles (если не token_expired).
    }

    let defaultScreen = state.cycles.length > 0 ? 'calendar' : 'main';
    // С отметками приложение открывается на календаре, и вопрос с "Сегодня" никто
    // бы не увидел. Поэтому раз за окно открываем "Сегодня". Только первый заход:
    // иначе карточка стала бы заслоном, который проще убрать случайным числом.
    // Если флажок не сохраняется, не перебрасываем вовсе: без памяти на
    // "Сегодня" вело бы каждое открытие.
    const ask = getLengthAskCycle(getToday());
    if (ask && readFlag(LEN_ASK_LANDED_KEY) !== String(ask.id)
        && writeFlag(LEN_ASK_LANDED_KEY, String(ask.id))) {
      defaultScreen = 'main';
    }
    setScreen(defaultScreen);
    $.app.removeAttribute('hidden');

    // Веб-заход (нет Telegram initData): показать кнопку возврата в приложение. В ТГ скрыта.
    if (!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)) {
      const ab = document.getElementById('appBackBtn');
      if (ab) ab.style.display = 'inline-flex';
    }

    // Кольцо под карточкой меряется только на видимой странице: при первом рендере
    // .app ещё скрыт, а кнопка возврата выше отнимает высоту. Шрифты меняют
    // перенос строк в карточке, после их загрузки меряем ещё раз.
    fitRingToLengthAsk();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fitRingToLengthAsk).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
