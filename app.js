// Mini App: Цикл - app.js
// UI-слой и оркестрация. Зависит от cycleCalc.js (CycleCalc) и auth.js (IrenaAuth, CyclesApi).
// Все даты внутри - UTC midnight (синхронно с cycleCalc.js).

(function () {
  'use strict';

  // === Конфиг ===

  const FETCH_LIMIT = 12;        // с запасом сверх HISTORY_LIMIT для устойчивого avg
  const HISTORY_LIMIT = 6;
  const CALENDAR_MONTHS = 3;
  const RING_CIRCUMFERENCE = 540.4; // 2*pi*86, синхронно с stroke-dasharray в HTML

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

    $.toasts = document.getElementById('toasts');
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

  function showToast(message) {
    if (!$.toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 3000);
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
    const current = state.cycles[0];
    const currentStart = CycleCalc.parseDate(current.start_date);

    const upperBound = CycleCalc.addDays(currentStart, state.avgLength + 7);
    const toDate = upperBound;

    const todayY = today.getUTCFullYear();
    const todayM = today.getUTCMonth();
    const months = [];
    for (let off = CALENDAR_MONTHS - 1; off >= 0; off--) {
      months.push(new Date(Date.UTC(todayY, todayM - off, 1)));
    }

    const fromDate = months[0];
    const phasesMap = CycleCalc.getCalendarPhases(
      state.cycles, fromDate, toDate, state.avgLength
    );

    for (const monthDate of months) {
      $.calendarList.appendChild(renderCalendarMonth(monthDate, today, phasesMap));
    }

    const currentMonthEl = $.calendarList.lastElementChild;
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
      const phase = phasesMap.get(iso);
      const isPredicted = dayDate.getTime() > today.getTime();

      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      if (isSameUTCDate(dayDate, today)) cell.classList.add('is-today');
      if (isPredicted) cell.classList.add('is-predicted');
      if (phase) cell.dataset.phase = phase;

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
      form.elements.start_date.value = CycleCalc.formatDate(getToday());
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
        await CyclesApi.create(payload);
      }
      closeRecordModal();
      await loadCycles();
      render();
    } catch (err) {
      if (err && err.message !== 'token_expired') {
        showToast('Не удалось сохранить');
      }
    } finally {
      state.isLoading = false;
    }
  }

  function handleDeleteRecord() {
    const id = $.formRecord.elements.id.value.trim();
    if (!id) return;
    openConfirmModal({
      title: 'Точно удалить?',
      text: 'Эту запись нельзя будет вернуть.',
      onConfirm: () => doDelete(id),
    });
  }

  async function doDelete(id) {
    if (state.isLoading) return;
    state.isLoading = true;
    try {
      await CyclesApi.delete({ id: id });
      closeConfirmModal();
      closeRecordModal();
      await loadCycles();
      render();
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

    setScreen('main');
    $.app.removeAttribute('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
