// Supabase Edge Function: cycles-api
// CRUD-прокси к таблицам cycles и cycle_symptoms. Авторизация через JWT от verify-access.
// Использует service_role для обхода RLS, защита делается явным
// фильтром user_id из JWT в каждом запросе к PostgREST.

const SUPPORTED_ACTIONS = ["list", "create", "update", "delete", "symptoms_list", "symptoms_save"] as const;
type Action = typeof SUPPORTED_ACTIONS[number];

const DEFAULT_MENSTRUATION_LENGTH = 5;
const MIN_MENSTRUATION_LENGTH = 1;
const MAX_MENSTRUATION_LENGTH = 14;
const DEFAULT_LIST_LIMIT = 12;
const MAX_LIST_LIMIT = 100;

const TABLE = "cycles";
const CYCLE_COLUMNS = "id,start_date,menstruation_length_days,notes,created_at";

// Отметки самочувствия по дням. Одна строка на день, у таблицы RLS без политик:
// ходит сюда только эта функция.
//
// Список кодов проверяется здесь, а не в базе: формулировки утверждает Ирена, и
// правка списка не должна требовать миграции. Всё, что база отбила бы своими
// CHECK, отсекаем ДО записи: сработавшая проверка пишет в логи Postgres строку
// целиком, то есть симптомы. По той же причине текст ошибки базы в ответ не уходит.
const SYMPTOMS_TABLE = "cycle_symptoms";
const SYMPTOM_DAY_COLUMNS = "date,symptoms,discharge,note,updated_at";

// Порядок в списке это порядок хранения: набор дня сохраняется в нём, а не в
// порядке тапов, и один и тот же набор всегда лежит одинаково.
const SYMPTOM_CODES = [
  "fine",
  "lower_abdominal_pain",
  "breast_tenderness",
  "headache",
  "acne",
  "back_pain",
  "fatigue",
  "hot_flashes",
  "night_sweats",
  "forgetfulness",
  "joint_pain",
  "increased_appetite",
  "insomnia",
  "vaginal_itching",
  "vaginal_dryness",
  "anxiety",
  "swelling",
  "bloating",
  "low_libido",
] as const;
const DISCHARGE_CODES = [
  "none",
  "creamy",
  "watery",
  "sticky",
  "mucus",
  "spotting",
  "atypical",
  "white_clumpy",
  "grey",
] as const;
// "Всё в порядке" и "Выделений нет" это отметки, а не пустота: с другими
// значениями своего списка не совмещаются. Синхронно с CHECK в базе.
const SYMPTOM_FINE = "fine";
const DISCHARGE_NONE = "none";

const NOTE_MAX_CHARS = 300;               // синхронно с CHECK cycle_symptoms_note_len
const SYMPTOMS_MIN_DATE = "2020-01-01";   // синхронно с CHECK cycle_symptoms_date_sane
// "Сегодня" женщина считает по часам телефона, сервер знает только UTC. Сутки
// запаса, чтобы восток не получал отказ на свой сегодняшний день.
const SYMPTOMS_FUTURE_TOLERANCE_DAYS = 1;
const SYMPTOMS_MAX_RANGE_DAYS = 400;

const ALLOWED_ORIGIN_PATTERNS = [
  // Веб-дверь. Под /cycle/ на своём origin приложение открывается через Service
  // Worker (см. irenabio-app/sw.js), поэтому Origin запроса = app.irenabio.com,
  // а НЕ vladlen00.github.io. Без этой строки функция отдаёт 403, и женщина
  // видит пустой календарь БЕЗ ошибки на экране - поломка тихая.
  // Строка аддитивная: .github.io ниже остаётся, телеграм-дверь не задета.
  /^https:\/\/app\.irenabio\.com$/,
  /\.vercel\.app$/,
  /\.netlify\.app$/,
  /\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^https:\/\/web\.telegram\.org$/,
  /^https:\/\/t\.me$/,
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGIN_PATTERNS.some(re =>
      re.test(url.host) || re.test(url.origin)
    );
  } catch {
    return false;
  }
}

// Base64url helpers (без padding, JWT-совместимые)

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlEncode(data: Uint8Array): string {
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// JWT (HS256) verification

async function verifyJWT(
  token: string,
  secret: string
): Promise<{ valid: boolean; sub?: string; reason?: string }> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, reason: "malformed" };
    }
    const [headerB64, payloadB64, sigB64] = parts;

    const data = `${headerB64}.${payloadB64}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expectedBuf = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(data)
    );
    const expectedSig = b64urlEncode(new Uint8Array(expectedBuf));
    if (expectedSig !== sigB64) {
      return { valid: false, reason: "invalid_signature" };
    }

    const payloadStr = new TextDecoder().decode(b64urlDecode(payloadB64));
    const payload = JSON.parse(payloadStr);

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) {
      return { valid: false, reason: "expired" };
    }

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return { valid: false, reason: "no_sub" };
    }

    return { valid: true, sub: payload.sub };
  } catch (e) {
    console.error("verifyJWT error:", e);
    return { valid: false, reason: "malformed" };
  }
}

// CORS / response helpers

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function okResponse(origin: string | null, data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function errorResponse(
  origin: string | null,
  status: number,
  error: string,
  reason?: string,
  details?: string
): Response {
  const body: Record<string, unknown> = { ok: false, error };
  if (reason) body.reason = reason;
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Supabase PostgREST helper

// @ts-ignore Deno runtime
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// @ts-ignore Deno runtime
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function supabaseFetchJson(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY!,
      "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`supabase ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Validation helpers

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !isNaN(t);
}

function isValidLength(n: unknown): n is number {
  return typeof n === "number"
    && Number.isInteger(n)
    && n >= MIN_MENSTRUATION_LENGTH
    && n <= MAX_MENSTRUATION_LENGTH;
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

// Строгая дата для симптомов. V8 молча перекатывает 2026-02-31 в 2026-03-03,
// и isValidDate выше такую дату пропускает. Поэтому сверяем разобранную дату с
// исходной строкой. Поведение isValidDate для циклов не трогаем.
function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// Дата UTC со сдвигом в днях, строкой YYYY-MM-DD.
function utcDateShifted(days: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

function daysBetweenIso(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000
  );
}

// null - набор годный, иначе причина отказа. Годный: массив строк из списка, без
// повторов, исключающее значение только в одиночку. Повтор отбиваем, а не
// схлопываем: приложение повторов не шлёт, и молча чинить его ошибку незачем.
function checkCodes(value: unknown, allowed: readonly string[], exclusive: string): string | null {
  if (!Array.isArray(value)) return "not_array";
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !allowed.includes(v)) return "unknown_code";
    if (seen.has(v)) return "duplicate_code";
    seen.add(v);
  }
  if (seen.has(exclusive) && seen.size > 1) return "exclusive_conflict";
  return null;
}

function inCanonicalOrder(codes: string[], allowed: readonly string[]): string[] {
  return allowed.filter((c) => codes.includes(c));
}

// Action handlers

async function handleList(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  let limit = DEFAULT_LIST_LIMIT;
  if (payload?.limit !== undefined) {
    if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > MAX_LIST_LIMIT) {
      return errorResponse(origin, 400, "Invalid limit", "invalid_limit");
    }
    limit = payload.limit;
  }

  const params = new URLSearchParams();
  params.set("user_id", `eq.${userId}`);
  params.set("deleted_at", "is.null");
  if (payload?.from !== undefined) {
    if (!isValidDate(payload.from)) {
      return errorResponse(origin, 400, "Invalid from date", "invalid_date");
    }
    params.append("start_date", `gte.${payload.from}`);
  }
  if (payload?.to !== undefined) {
    if (!isValidDate(payload.to)) {
      return errorResponse(origin, 400, "Invalid to date", "invalid_date");
    }
    params.append("start_date", `lte.${payload.to}`);
  }
  params.set("order", "start_date.desc");
  params.set("limit", String(limit));
  params.set("select", CYCLE_COLUMNS);

  try {
    const data = await supabaseFetchJson(`/rest/v1/${TABLE}?${params.toString()}`);
    return okResponse(origin, { cycles: data });
  } catch (e) {
    return errorResponse(origin, 500, "Supabase error", "supabase_error", (e as Error).message);
  }
}

async function handleCreate(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  if (!payload || typeof payload !== "object") {
    return errorResponse(origin, 400, "Missing payload", "missing_payload");
  }
  if (payload.start_date === undefined) {
    return errorResponse(origin, 400, "start_date required", "missing_start_date");
  }
  if (!isValidDate(payload.start_date)) {
    return errorResponse(origin, 400, "Invalid start_date", "invalid_date");
  }

  let length = DEFAULT_MENSTRUATION_LENGTH;
  if (payload.menstruation_length_days !== undefined) {
    if (!isValidLength(payload.menstruation_length_days)) {
      return errorResponse(origin, 400, "Invalid menstruation_length_days", "invalid_length");
    }
    length = payload.menstruation_length_days;
  }

  let notes: string | null = null;
  if (payload.notes !== undefined) {
    if (!isStringOrNull(payload.notes)) {
      return errorResponse(origin, 400, "Invalid notes", "invalid_notes");
    }
    notes = payload.notes;
  }

  const body = {
    user_id: userId,
    start_date: payload.start_date,
    menstruation_length_days: length,
    notes,
    deleted_at: null,   // merge-duplicates upsert реанимирует soft-deleted строку на эту дату
  };

  try {
    const data = await supabaseFetchJson(
      `/rest/v1/${TABLE}?on_conflict=user_id,start_date&select=${CYCLE_COLUMNS}`,
      {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body),
      }
    );
    const arr = Array.isArray(data) ? data : [];
    const cycle = arr[0] ?? null;
    return okResponse(origin, { cycle });
  } catch (e) {
    return errorResponse(origin, 500, "Supabase error", "supabase_error", (e as Error).message);
  }
}

async function handleUpdate(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  if (!payload || typeof payload !== "object") {
    return errorResponse(origin, 400, "Missing payload", "missing_payload");
  }
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return errorResponse(origin, 400, "Missing id", "missing_id");
  }

  const updateBody: Record<string, unknown> = {};

  if (payload.start_date !== undefined) {
    if (!isValidDate(payload.start_date)) {
      return errorResponse(origin, 400, "Invalid start_date", "invalid_date");
    }
    updateBody.start_date = payload.start_date;
  }

  if (payload.menstruation_length_days !== undefined) {
    if (!isValidLength(payload.menstruation_length_days)) {
      return errorResponse(origin, 400, "Invalid menstruation_length_days", "invalid_length");
    }
    updateBody.menstruation_length_days = payload.menstruation_length_days;
  }

  if (payload.notes !== undefined) {
    if (!isStringOrNull(payload.notes)) {
      return errorResponse(origin, 400, "Invalid notes", "invalid_notes");
    }
    updateBody.notes = payload.notes;
  }

  if (Object.keys(updateBody).length === 0) {
    return errorResponse(origin, 400, "Nothing to update", "nothing_to_update");
  }

  const params = new URLSearchParams();
  params.set("id", `eq.${payload.id}`);
  params.set("user_id", `eq.${userId}`);
  params.set("select", CYCLE_COLUMNS);

  try {
    const data = await supabaseFetchJson(
      `/rest/v1/${TABLE}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify(updateBody),
      }
    );
    const arr = Array.isArray(data) ? data : [];
    if (arr.length === 0) {
      return okResponse(origin, { cycle: null, affected: 0 });
    }
    return okResponse(origin, { cycle: arr[0], affected: 1 });
  } catch (e) {
    return errorResponse(origin, 500, "Supabase error", "supabase_error", (e as Error).message);
  }
}

async function handleDelete(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  if (!payload || typeof payload !== "object") {
    return errorResponse(origin, 400, "Missing payload", "missing_payload");
  }
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return errorResponse(origin, 400, "Missing id", "missing_id");
  }

  // Soft-delete: проставляем deleted_at. Фильтр deleted_at=is.null делает повторный
  // delete по уже удалённой строке идемпотентным (0 строк -> ok:true, deleted:false,
  // без ошибки и без перезаписи исходной метки времени).
  const params = new URLSearchParams();
  params.set("id", `eq.${payload.id}`);
  params.set("user_id", `eq.${userId}`);
  params.set("deleted_at", "is.null");
  params.set("select", "id");

  try {
    const data = await supabaseFetchJson(
      `/rest/v1/${TABLE}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }
    );
    const arr = Array.isArray(data) ? data : [];
    return okResponse(origin, {
      deleted: arr.length > 0,
      id: payload.id,
    });
  } catch (e) {
    return errorResponse(origin, 500, "Supabase error", "supabase_error", (e as Error).message);
  }
}

// Отметки самочувствия за диапазон дат, обе границы включительно, по возрастанию.
// payload: { from, to }. Ответ: { days: [{ date, symptoms, discharge, note, updated_at }] }
async function handleSymptomsList(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  if (!isRealDate(payload?.from) || !isRealDate(payload?.to)) {
    return errorResponse(origin, 400, "Invalid date", "invalid_date");
  }
  const span = daysBetweenIso(payload.from, payload.to);
  if (span < 0 || span > SYMPTOMS_MAX_RANGE_DAYS) {
    return errorResponse(origin, 400, "Invalid range", "invalid_range");
  }

  const params = new URLSearchParams();
  params.set("user_id", `eq.${userId}`);
  params.append("date", `gte.${payload.from}`);
  params.append("date", `lte.${payload.to}`);
  params.set("order", "date.asc");
  // Строка на день, поэтому в диапазоне не больше span + 1 строк.
  params.set("limit", String(SYMPTOMS_MAX_RANGE_DAYS + 1));
  params.set("select", SYMPTOM_DAY_COLUMNS);

  try {
    const data = await supabaseFetchJson(`/rest/v1/${SYMPTOMS_TABLE}?${params.toString()}`);
    return okResponse(origin, { days: Array.isArray(data) ? data : [] });
  } catch {
    return errorResponse(origin, 500, "Supabase error", "supabase_error");
  }
}

// Сохранение дня целиком: присланный набор заменяет прежний.
// payload: { date, symptoms: string[], discharge: string[], note?: string | null }
// Пустой день (ни одного кода и нет текста) удаляется НАСТОЯЩИМ удалением:
// медицинские данные не хранятся "на всякий случай". Повтор удаления идемпотентен.
// Ответ: { day: {...} | null, deleted: boolean }
async function handleSymptomsSave(
  origin: string | null,
  userId: string,
  payload: any
): Promise<Response> {
  if (!payload || typeof payload !== "object") {
    return errorResponse(origin, 400, "Missing payload", "missing_payload");
  }
  if (!isRealDate(payload.date)) {
    return errorResponse(origin, 400, "Invalid date", "invalid_date");
  }
  if (payload.date < SYMPTOMS_MIN_DATE || payload.date > utcDateShifted(SYMPTOMS_FUTURE_TOLERANCE_DAYS)) {
    return errorResponse(origin, 400, "Date out of range", "date_out_of_range");
  }

  const symptomsProblem = checkCodes(payload.symptoms, SYMPTOM_CODES, SYMPTOM_FINE);
  if (symptomsProblem) {
    return errorResponse(origin, 400, "Invalid symptoms", "invalid_symptoms", symptomsProblem);
  }
  const dischargeProblem = checkCodes(payload.discharge, DISCHARGE_CODES, DISCHARGE_NONE);
  if (dischargeProblem) {
    return errorResponse(origin, 400, "Invalid discharge", "invalid_discharge", dischargeProblem);
  }

  let note: string | null = null;
  if (payload.note !== undefined && payload.note !== null) {
    if (typeof payload.note !== "string" || payload.note.includes(String.fromCharCode(0))) {
      return errorResponse(origin, 400, "Invalid note", "invalid_note");
    }
    const trimmed = payload.note.trim();
    // Длину считаем по символам, как char_length в базе: у эмодзи .length даёт 2.
    if ([...trimmed].length > NOTE_MAX_CHARS) {
      return errorResponse(origin, 400, "Note too long", "note_too_long");
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  const symptoms = inCanonicalOrder(payload.symptoms, SYMPTOM_CODES);
  const discharge = inCanonicalOrder(payload.discharge, DISCHARGE_CODES);

  if (symptoms.length === 0 && discharge.length === 0 && note === null) {
    const params = new URLSearchParams();
    params.set("user_id", `eq.${userId}`);
    params.set("date", `eq.${payload.date}`);
    params.set("select", "date");
    try {
      const data = await supabaseFetchJson(
        `/rest/v1/${SYMPTOMS_TABLE}?${params.toString()}`,
        {
          method: "DELETE",
          headers: { "Prefer": "return=representation" },
        }
      );
      const arr = Array.isArray(data) ? data : [];
      return okResponse(origin, { day: null, deleted: arr.length > 0 });
    } catch {
      return errorResponse(origin, 500, "Supabase error", "supabase_error");
    }
  }

  const body = {
    user_id: userId,
    date: payload.date,
    symptoms,
    discharge,
    note,
    // Триггера на updated_at в базе нет: ставит единственный писатель, эта функция.
    updated_at: new Date().toISOString(),
  };

  try {
    const data = await supabaseFetchJson(
      `/rest/v1/${SYMPTOMS_TABLE}?on_conflict=user_id,date&select=${SYMPTOM_DAY_COLUMNS}`,
      {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body),
      }
    );
    const arr = Array.isArray(data) ? data : [];
    return okResponse(origin, { day: arr[0] ?? null, deleted: false });
  } catch {
    return errorResponse(origin, 500, "Supabase error", "supabase_error");
  }
}

// Main handler

// @ts-ignore Deno runtime
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  // 0. CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  // 1. Method
  if (req.method !== "POST") {
    return errorResponse(origin, 405, "Method not allowed", "method_not_allowed");
  }

  // 2. Origin
  if (!isOriginAllowed(origin)) {
    return errorResponse(origin, 403, "Origin not allowed", "origin_not_allowed");
  }

  // 3. Env
  // @ts-ignore Deno runtime
  const jwtSecret = Deno.env.get("JWT_SECRET");
  if (!jwtSecret || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(origin, 500, "Server misconfigured", "server_misconfigured");
  }

  // 4. Auth header
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(origin, 401, "Missing Authorization header", "missing_auth_header");
  }
  const token = authHeader.slice("Bearer ".length).trim();

  // 5. JWT
  const verified = await verifyJWT(token, jwtSecret);
  if (!verified.valid || !verified.sub) {
    return errorResponse(origin, 401, "Invalid token", verified.reason);
  }
  const userId = verified.sub;

  // 6. Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(origin, 400, "Invalid JSON body", "bad_json");
  }

  // 7. Action
  const action = body?.action;
  if (typeof action !== "string" || action.length === 0) {
    return errorResponse(origin, 400, "Missing action", "missing_action");
  }
  if (!SUPPORTED_ACTIONS.includes(action as Action)) {
    return errorResponse(origin, 400, "Unknown action", "unknown_action");
  }

  // 8 + 9. Dispatch
  const payload = body?.payload ?? {};
  switch (action as Action) {
    case "list":   return handleList(origin, userId, payload);
    case "create": return handleCreate(origin, userId, payload);
    case "update": return handleUpdate(origin, userId, payload);
    case "delete": return handleDelete(origin, userId, payload);
    case "symptoms_list": return handleSymptomsList(origin, userId, payload);
    case "symptoms_save": return handleSymptomsSave(origin, userId, payload);
  }

  return errorResponse(origin, 500, "Internal error", "unreachable");
});
