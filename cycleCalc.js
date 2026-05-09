// Mini App: Цикл - cycleCalc.js
// Чистая логика расчёта менструального цикла. Без DOM, без fetch, без Telegram SDK.
// Все функции детерминированы: принимают `today` (или другие даты) параметром,
// внутри не вызывают new Date() и Date.now().
// Используется в app.js для подсчёта дня цикла, фазы, прогноза, истории и календаря.
// Регистрируется в global как window.CycleCalc.

(function () {
  // Константы

  const LUTEAL_PHASE_DAYS = 14;
  const DEFAULT_CYCLE_LENGTH = 28;
  const DEFAULT_MENSTRUATION_LENGTH = 5;
  const MIN_VALID_CYCLE_LENGTH = 21;
  const MAX_VALID_CYCLE_LENGTH = 45;
  const HISTORY_WINDOW = 6;
  const OVULATION_WINDOW_DAYS = 3; // День овуляции +/- 1, всего 3 дня

  const PHASES = Object.freeze({
    MENSTRUATION: "menstruation",
    FOLLICULAR: "follicular",
    OVULATION: "ovulation",
    LUTEAL: "luteal",
  });

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MS_PER_DAY = 86400000;

  // Date utilities (все даты в UTC полночь, чтобы не ловить DST)

  function parseDate(str) {
    if (typeof str !== "string" || !DATE_RE.test(str)) {
      throw new Error("parseDate: expected YYYY-MM-DD, got " + JSON.stringify(str));
    }
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(5, 7), 10);
    const d = parseInt(str.slice(8, 10), 10);
    const date = new Date(Date.UTC(y, m - 1, d));
    // Roundtrip защищает от невалидных дат вроде 2026-02-31 (которые Date.UTC иначе молча округлит)
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      throw new Error("parseDate: invalid calendar date " + str);
    }
    return date;
  }

  function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new Error("formatDate: expected valid Date");
    }
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(date, n) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new Error("addDays: expected valid Date");
    }
    if (!Number.isInteger(n)) {
      throw new Error("addDays: n must be integer, got " + n);
    }
    return new Date(date.getTime() + n * MS_PER_DAY);
  }

  function daysBetween(a, b) {
    if (!(a instanceof Date) || isNaN(a.getTime())) {
      throw new Error("daysBetween: a must be valid Date");
    }
    if (!(b instanceof Date) || isNaN(b.getTime())) {
      throw new Error("daysBetween: b must be valid Date");
    }
    return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
  }

  // Cycle calculations

  function computeAverageCycleLength(cycles) {
    if (!Array.isArray(cycles) || cycles.length < 2) {
      return DEFAULT_CYCLE_LENGTH;
    }
    // cycles отсортированы desc по start_date. Длина cycles[i] = дни от cycles[i] до cycles[i-1].
    // cycles[0] (текущий) длины не имеет - он ещё идёт.
    const lengths = [];
    for (let i = 1; i < cycles.length; i++) {
      const olderStart = parseDate(cycles[i].start_date);
      const newerStart = parseDate(cycles[i - 1].start_date);
      const len = daysBetween(olderStart, newerStart);
      if (len >= MIN_VALID_CYCLE_LENGTH && len <= MAX_VALID_CYCLE_LENGTH) {
        lengths.push(len);
      }
    }
    if (lengths.length === 0) {
      return DEFAULT_CYCLE_LENGTH;
    }
    // lengths идут от более новых к более старым (i растёт = смотрим всё дальше в прошлое).
    // Берём 6 самых новых валидных.
    const recent = lengths.slice(0, HISTORY_WINDOW);
    const sum = recent.reduce((a, b) => a + b, 0);
    return Math.round(sum / recent.length);
  }

  function getCurrentCycle(cycles, today) {
    if (!Array.isArray(cycles) || cycles.length === 0) return null;
    if (!(today instanceof Date) || isNaN(today.getTime())) {
      throw new Error("getCurrentCycle: today must be valid Date");
    }
    const todayTs = today.getTime();
    // cycles desc - первый, чей start_date <= today, и есть текущий
    for (const c of cycles) {
      const start = parseDate(c.start_date);
      if (start.getTime() <= todayTs) return c;
    }
    return null;
  }

  function getCurrentCycleDay(cycle, today) {
    if (!cycle) return null;
    if (!(today instanceof Date) || isNaN(today.getTime())) {
      throw new Error("getCurrentCycleDay: today must be valid Date");
    }
    const start = parseDate(cycle.start_date);
    return daysBetween(start, today) + 1;
  }

  function getPhaseForDay(dayNum, menstruationLength, avgLength) {
    if (!Number.isInteger(dayNum) || dayNum < 1) {
      return null;
    }
    const menstrLen = Number.isInteger(menstruationLength) && menstruationLength > 0
      ? menstruationLength
      : DEFAULT_MENSTRUATION_LENGTH;
    const cycleLen = Number.isInteger(avgLength) && avgLength > 0
      ? avgLength
      : DEFAULT_CYCLE_LENGTH;

    // Менструация имеет приоритет (если параметры неконсистентны и пересеклись с овуляцией)
    if (dayNum <= menstrLen) {
      return PHASES.MENSTRUATION;
    }

    const ovulationDay = cycleLen - LUTEAL_PHASE_DAYS;
    const halfWindow = Math.floor(OVULATION_WINDOW_DAYS / 2);
    const ovulationStart = ovulationDay - halfWindow;
    const ovulationEnd = ovulationDay + halfWindow;

    if (dayNum >= ovulationStart && dayNum <= ovulationEnd) {
      return PHASES.OVULATION;
    }
    if (dayNum < ovulationStart) {
      return PHASES.FOLLICULAR;
    }
    return PHASES.LUTEAL;
  }

  function predictNextMenstruation(currentCycle, avgLength) {
    if (!currentCycle) return null;
    const cycleLen = Number.isInteger(avgLength) && avgLength > 0
      ? avgLength
      : DEFAULT_CYCLE_LENGTH;
    return addDays(parseDate(currentCycle.start_date), cycleLen);
  }

  function getCycleHistory(cycles, n) {
    if (!Array.isArray(cycles)) return [];
    const limit = Number.isInteger(n) && n > 0 ? n : HISTORY_WINDOW;
    const avgLength = computeAverageCycleLength(cycles);
    const out = [];
    const upTo = Math.min(cycles.length, limit);
    for (let i = 0; i < upTo; i++) {
      const c = cycles[i];
      // Длина определяется СЛЕДУЮЩИМ циклом (тем, что начался позже).
      // В desc-массиве это cycles[i-1] (более новый).
      let length = null;
      let deviation = null;
      if (i > 0) {
        const thisStart = parseDate(c.start_date);
        const nextStart = parseDate(cycles[i - 1].start_date);
        length = daysBetween(thisStart, nextStart);
        deviation = length - avgLength;
      }
      out.push({
        id: c.id,
        start_date: c.start_date,
        menstruation_length_days: c.menstruation_length_days,
        notes: c.notes,
        length: length,
        deviation: deviation,
      });
    }
    return out;
  }

  function getCalendarPhases(cycles, fromDate, toDate, avgLength) {
    const result = new Map();
    if (!Array.isArray(cycles) || cycles.length === 0) return result;
    if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
      throw new Error("getCalendarPhases: fromDate must be valid Date");
    }
    if (!(toDate instanceof Date) || isNaN(toDate.getTime())) {
      throw new Error("getCalendarPhases: toDate must be valid Date");
    }
    const totalDays = daysBetween(fromDate, toDate);
    if (totalDays < 0) return result;

    const cycleLen = Number.isInteger(avgLength) && avgLength > 0
      ? avgLength
      : DEFAULT_CYCLE_LENGTH;

    // Заранее парсим старты всех циклов один раз, чтобы не делать это в цикле по дням.
    const parsed = cycles.map(c => ({
      start: parseDate(c.start_date),
      menstrLen: Number.isInteger(c.menstruation_length_days) && c.menstruation_length_days > 0
        ? c.menstruation_length_days
        : DEFAULT_MENSTRUATION_LENGTH,
    }));
    // Порядок desc сохраняется - первый в массиве самый новый.

    for (let offset = 0; offset <= totalDays; offset++) {
      const date = addDays(fromDate, offset);
      const dateTs = date.getTime();
      // Находим самый новый цикл, чей start <= date (благодаря desc - первый подошедший)
      let owning = null;
      for (const p of parsed) {
        if (p.start.getTime() <= dateTs) {
          owning = p;
          break;
        }
      }
      if (!owning) continue;
      const dayNum = daysBetween(owning.start, date) + 1;
      // Wrap: день 29 при cycleLen=28 интерпретируется как день 1
      // следующего цикла. Это даёт прогноз в календаре (овуляция,
      // следующая менструация). main экран использует getPhaseForDay
      // напрямую без wrap - там при задержке цикла остаётся
      // лютеиновая, что семантически правильно.
      const wrappedDay = ((dayNum - 1) % cycleLen) + 1;
      const phase = getPhaseForDay(wrappedDay, owning.menstrLen, cycleLen);
      if (phase) {
        result.set(formatDate(date), phase);
      }
    }
    return result;
  }

  // Export

  if (typeof window !== "undefined") {
    window.CycleCalc = {
      // constants
      PHASES,
      // utilities
      parseDate,
      formatDate,
      addDays,
      daysBetween,
      // calculations
      computeAverageCycleLength,
      getCurrentCycle,
      getCurrentCycleDay,
      getPhaseForDay,
      predictNextMenstruation,
      getCycleHistory,
      getCalendarPhases,
    };
  }
})();
