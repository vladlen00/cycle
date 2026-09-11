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

  // === State ===

  const state = {
    cycles: [],
    avgLength: 28,
    isLoading: false,
    pendingConfirmAction: null, // callback для modal-confirm
    undoCreate: null,           // { id, el, timer } последней созданной отметки, пока жив тост
  };

  const $ = {}; // DOM cache

  // === DOM cache ===

  function cacheDom() {
    $.app = document.querySelector('.app');
    $.screens = document.querySelectorAll('.screen');
    $.navBtns = document.querySelectorAll('.nav-btn');

    $.cycleDay = document.getElementById('cycle-day');
    $.cyclePhase = document.getElementById('cycle-phase');
    $.cyclePrediction = document.getElementById('cycle-prediction');
    $.ringProgress = document.querySelector('.ring-progress');
    $.ringWrap = document.querySelector('.cycle-ring-wrap');

    $.calendarList = document.getElementById('calendar-list');

    $.historyList = document.getElementById('history-list');
    $.historyEmpty = document.getElementById('history-empty');

    $.modalRecord = document.getElementById('modal-record');
    $.recordTitle = document.getElementById('record-title');
    $.formRecord = document.getElementById('form-record');
    $.btnDeleteRecord = $.formRecord.querySelector('[data-action="delete-record"]');

    $.modalConfirm = document.getElementById('modal-confirm');
    $.confirmTitle = document.getElementById('confirm-title');
    $.confirmText = document.getElementById('confirm-text');

    $.modalDay = document.getElementById('modal-day');
    $.dayTitle = document.getElementById('day-title');
    $.dayInfo = document.getElementById('day-info');
    $.dayEditBtn = $.modalDay.querySelector('[data-action="day-edit"]');

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
    state.avgLength = CycleCalc.computeAverageCycleLength(state.cycles);
    const active = document.querySelector('.screen.is-active');
    const name = active ? active.dataset.screen : 'main';
    if (name === 'main') renderMain();
    else if (name === 'calendar') renderCalendar();
    else if (name === 'history') renderHistory();
  }

  function renderMain() {
    const today = getToday();
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
    const phase = CycleCalc.getPhaseForDay(
      day,
      current.menstruation_length_days,
      state.avgLength
    );
    const next = CycleCalc.predictNextMenstruation(current, state.avgLength);

    $.cycleDay.textContent = String(day);
    $.cyclePhase.textContent = PHASE_LABEL[phase] || '';
    $.cyclePrediction.textContent = next ? 'Следующая ~ ' + formatDateRu(next) : '';

    const progress = Math.max(0, Math.min(1, day / state.avgLength));
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    $.ringProgress.setAttribute('stroke-dashoffset', offset.toFixed(1));

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
    if (state.cycles.length === 0) return;

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
      state.cycles, fromDate, toDate, state.avgLength, today
    );

    let currentMonthEl = null;
    for (const monthDate of months) {
      const el = renderCalendarMonth(monthDate, today, phasesMap);
      $.calendarList.appendChild(el);
      if (monthDate.getUTCFullYear() === todayY && monthDate.getUTCMonth() === todayM) {
        currentMonthEl = el;
      }
    }

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
        cycleLenForPhase = state.avgLength || 28;
        barLen = Math.max(cycleLenForPhase, todayDay);
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
        const phase = CycleCalc.getPhaseForDay(
          d, item.menstruation_length_days, cycleLenForPhase
        );
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
          // phase === null (задержка за пределами avgLength) - продолжение лютеиновой
          const dot = document.createElement('span');
          dot.className = 'hist-bd hist-bd-luteal';
          bar.appendChild(dot);
        }
      }

      li.appendChild(bar);
      $.historyList.appendChild(li);
    }
  }

  // === Modals ===

  function openRecordModal(opts) {
    const cycle = (opts && opts.cycle) || null;
    const form = $.formRecord;

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

  // Превью дня. Только чтение: ни полей ввода, ни "Сохранить".
  function openDayModal(iso) {
    let date;
    try {
      date = CycleCalc.parseDate(iso);
    } catch {
      return;
    }
    const today = getToday();
    // Фаза берётся тем же расчётом, что и раскраска календаря, на одну дату
    // и с теми же входами. Своей копии логики фаз здесь нет.
    const info = CycleCalc.getCalendarPhases(
      state.cycles, date, date, state.avgLength, today
    ).get(iso) || null;

    const weekday = WEEKDAY_NAMES_RU[getMondayWeekday(date)];
    const isToday = isSameUTCDate(date, today);
    $.dayTitle.textContent = formatDateRu(date) + ', ' + weekday + (isToday ? ', сегодня' : '');

    $.dayInfo.innerHTML = '';
    if (!info) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = 'Нет данных';
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

  // === Action handlers ===

  async function handleSubmitRecord(form) {
    if (state.isLoading) return;

    const id = form.elements.id.value.trim();
    const start_date = form.elements.start_date.value;
    const lenRaw = form.elements.menstruation_length_days.value;
    const notesRaw = form.elements.notes.value.trim();

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
      }
    });

    $.formRecord.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmitRecord(e.target);
    });
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

  // === Init ===

  async function init() {
    cacheDom();
    bindEvents();

    const ok = await IrenaAuth.checkAccess();
    if (!ok) return;

    try {
      await loadCycles();
    } catch {
      // toast уже показан в loadCycles (если не token_expired).
    }

    const defaultScreen = state.cycles.length > 0 ? 'calendar' : 'main';
    setScreen(defaultScreen);
    $.app.removeAttribute('hidden');

    // Веб-заход (нет Telegram initData): показать кнопку возврата в приложение. В ТГ скрыта.
    if (!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)) {
      const ab = document.getElementById('appBackBtn');
      if (ab) ab.style.display = 'inline-flex';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
