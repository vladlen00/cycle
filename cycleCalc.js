// Mini App: Цикл - cycleCalc.js
// Чистая логика расчёта менструального цикла. Без DOM, без fetch, без Telegram SDK.
// Все функции детерминированы: принимают `today` (или другие даты) параметром,
// внутри не вызывают new Date() и Date.now().
// Используется в app.js для подсчёта дня цикла, фазы, прогноза, истории и календаря.
// Регистрируется в global как window.CycleCalc.
//
// КОНТРАКТ СИНХРОНИЗАЦИИ С ТРЕКЕРОМ (biohack/src/cycleContext.js)
// У ИИ-подружки в трекере своя автономная копия расчёта: репозитории разные.
// Копии уже расходились - здесь отбрасывались интервалы вне 21..45, там вне
// 18..45, и на отметках 51/28/20 женщина видела 28 в приложении и 24 у
// подружки. Одно число продукта в двух местах.
//
//   Совпадать обязаны три помеченных участка SHARED-CALC: константы,
//   computeTypicalCycleLength (порядок операций и формула медианы) и
//   getPhaseForDay. Здесь они разнесены по файлу между функциями, которых в
//   трекере нет; там лежат одним блоком.
//   Правишь здесь - правь и там. Правка в одном репозитории это уже баг,
//   даже если ничего не упало.
//
//   Сверять ПО СМЫСЛУ, не текстом. Тексты уже различаются форматированием:
//   в трекере по файлу прошёлся prettier, часть if стоит без фигурных скобок
//   и переносы строк другие. Проверено 2026-09-11: после снятия комментариев,
//   фигурных скобок и пробелов тела getPhaseForDay совпадают символ в символ,
//   769 знаков. Выравнивать форматирование намеренно не стали: перетасовка
//   работающей функции ради косметики дороже, чем эта оговорка.

(function () {
  // Константы

  // --- SHARED-CALC BEGIN: константы, синхронно с трекером ---

  const LUTEAL_PHASE_DAYS = 14;
  const DEFAULT_CYCLE_LENGTH = 28;
  const DEFAULT_MENSTRUATION_LENGTH = 5;

  // Границы валидного интервала между отметками. Обе защищают от ошибок ввода,
  // а НЕ от нездоровья, и путать это нельзя.
  //
  // 15 снизу: настоящий мусор на коротком конце это не короткий цикл, а второй
  // старт на ту же менструацию (мазанье отмечено как новый цикл), такие
  // интервалы дают 1-10 дней. Цикл в 20 дней редкость, но он реален, и его
  // надо учитывать: при прежнем пороге 21 у женщины с циклами 19-20 дней
  // выбрасывались ВСЕ интервалы, и она читала выдуманные 28 как свои.
  // 45 сверху: отсекает не длинный цикл, а пропущенную отметку, когда один
  // интервал стал суммой двух циклов. Два коротких цикла это уже 30+, поэтому
  // склейка начинается примерно здесь. Настоящий цикл 45+ дней бывает, и мы
  // платим этим сознательно: различить его от пропуска по данным нельзя.
  const MIN_VALID_CYCLE_LENGTH = 15;
  const MAX_VALID_CYCLE_LENGTH = 45;

  const HISTORY_WINDOW = 6;
  const OVULATION_WINDOW_DAYS = 3; // День овуляции +/- 1, всего 3 дня

  // --- SHARED-CALC END ---

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

  // --- SHARED-CALC BEGIN: computeTypicalCycleLength, синхронно с трекером ---

  // Медиана целых чисел, округлённая. Формула чётного случая обязана совпадать
  // с трекером: при двух интервалах любое другое соглашение снова разведёт
  // числа. Math.round здесь не "правильнее" других округлений, он просто
  // ОДИНАКОВЫЙ в двух местах, и это важнее.
  function medianRounded(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const half = Math.floor(n / 2);
    const raw = n % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
    return Math.round(raw);
  }

  // Типичная длина цикла по датам соседних отметок.
  // Возвращает число либо null. null значит "посчитать не из чего", и это НЕ
  // повод подставить 28: выдуманное число женщина читает как своё.
  // Медиана, а не средняя: на выборке из трёх одно нетипичное значение двигает
  // среднюю на 5-9 дней, медиану не двигает вовсе.
  function computeTypicalCycleLength(cycles) {
    if (!Array.isArray(cycles) || cycles.length < 2) {
      return null;
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
      return null;
    }
    // lengths идут от более новых к более старым (i растёт = смотрим всё дальше в прошлое).
    // Обрезка ДО сортировки: окно это "шесть самых новых", а не "шесть самых
    // коротких". Перестановка этих двух шагов молча меняет результат.
    const recent = lengths.slice(0, HISTORY_WINDOW);
    return medianRounded(recent);
  }

  // --- SHARED-CALC END ---

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

  // --- SHARED-CALC BEGIN: getPhaseForDay, совпадает с трекером по смыслу ---

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

  // --- SHARED-CALC END ---

  function predictNextMenstruation(currentCycle, avgLength) {
    if (!currentCycle) return null;
    // Типичная длина неизвестна - прогноза нет. Прежде здесь подставлялись
    // DEFAULT_CYCLE_LENGTH, и женщина читала дату, выведенную из чужих 28.
    if (!Number.isInteger(avgLength) || avgLength <= 0) return null;
    return addDays(parseDate(currentCycle.start_date), avgLength);
  }

  function getCycleHistory(cycles, n) {
    if (!Array.isArray(cycles)) return [];
    const limit = Number.isInteger(n) && n > 0 ? n : HISTORY_WINDOW;
    const avgLength = computeTypicalCycleLength(cycles);
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
        // Отклонение не от чего считать, пока типичная длина неизвестна.
        deviation = avgLength === null ? null : length - avgLength;
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

  function getCalendarPhases(cycles, fromDate, toDate, avgLength, today) {
    const result = new Map();
    if (!Array.isArray(cycles) || cycles.length === 0) return result;
    if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
      throw new Error("getCalendarPhases: fromDate must be valid Date");
    }
    if (!(toDate instanceof Date) || isNaN(toDate.getTime())) {
      throw new Error("getCalendarPhases: toDate must be valid Date");
    }
    if (!(today instanceof Date) || isNaN(today.getTime())) {
      throw new Error("getCalendarPhases: today must be valid Date");
    }
    const totalDays = daysBetween(fromDate, toDate);
    if (totalDays < 0) return result;

    // Типичная длина неизвестна - режим "только отметки": прогноз не рисуем
    // вовсе, по прожитым дням показываем одну менструацию. Подставлять
    // DEFAULT_CYCLE_LENGTH нельзя: календарь рисовал бы фазы и прогноз от
    // чужих 28, и женщина читала бы их как свои.
    const cycleLen = Number.isInteger(avgLength) && avgLength > 0
      ? avgLength
      : null;

    const todayTs = today.getTime();

    // Заранее парсим старты всех циклов один раз, чтобы не делать это в цикле по дням.
    // realLength - фактическая длина цикла до следующей реальной отметки. В desc-массиве
    // следующая отметка это cycles[i - 1]. У самого нового цикла её нет (realLength = null),
    // только он и может прогнозироваться.
    const parsed = cycles.map((c, i) => {
      const start = parseDate(c.start_date);
      return {
        id: c.id,
        start: start,
        menstrLen: Number.isInteger(c.menstruation_length_days) && c.menstruation_length_days > 0
          ? c.menstruation_length_days
          : DEFAULT_MENSTRUATION_LENGTH,
        realLength: i > 0 ? daysBetween(start, parseDate(cycles[i - 1].start_date)) : null,
      };
    });
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

      let phase;
      let predicted;
      if (cycleLen === null) {
        // Фазу без типичной длины разместить не от чего: день овуляции
        // считается именно от неё. Показываем только менструацию, она
        // отсчитывается от дня 1 и от длины цикла не зависит.
        if (dateTs > todayTs) continue; // прогноза нет, рисовать нечего
        phase = dayNum <= owning.menstrLen ? PHASES.MENSTRUATION : null;
        predicted = false;
      } else if (owning.realLength !== null) {
        // Закрытый цикл: следующая реальная отметка уже есть, прогнозировать нечего.
        // Wrap запрещён - иначе хвост прогноза предыдущего цикла рисуется поверх дней,
        // которые женщина уже прожила, и выглядит как её отметка.
        // Фазы считаем по тому же среднему, что и раньше: фикс не должен двигать
        // день овуляции в уже закрытых циклах.
        phase = getPhaseForDay(dayNum, owning.menstrLen, cycleLen);
        predicted = false;
      } else if (dateTs <= todayTs) {
        // Текущий цикл, день уже прожит. Wrap запрещён: при задержке
        // getPhaseForDay отдаёт лютеиновую, и это правда, а не начало нового цикла.
        phase = getPhaseForDay(dayNum, owning.menstrLen, cycleLen);
        predicted = false;
      } else {
        // Будущее. Wrap: день 29 при cycleLen=28 читается как день 1 следующего
        // цикла - это и есть прогноз (овуляция, следующая менструация).
        const wrappedDay = ((dayNum - 1) % cycleLen) + 1;
        phase = getPhaseForDay(wrappedDay, owning.menstrLen, cycleLen);
        predicted = true;
      }
      if (phase) {
        result.set(formatDate(date), {
          phase: phase,
          predicted: predicted,
          cycleId: predicted ? null : owning.id,
        });
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
      computeTypicalCycleLength,
      getCurrentCycle,
      getCurrentCycleDay,
      getPhaseForDay,
      predictNextMenstruation,
      getCycleHistory,
      getCalendarPhases,
    };
  }
})();
