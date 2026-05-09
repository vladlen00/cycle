// Supabase Edge Function: cycles-api
// CRUD-прокси к таблице cycles. Авторизация через JWT от verify-access.
// Использует service_role для обхода RLS, защита делается явным
// фильтром user_id из JWT в каждом запросе к PostgREST.

const SUPPORTED_ACTIONS = ["list", "create", "update", "delete"] as const;
type Action = typeof SUPPORTED_ACTIONS[number];

const DEFAULT_MENSTRUATION_LENGTH = 5;
const MIN_MENSTRUATION_LENGTH = 1;
const MAX_MENSTRUATION_LENGTH = 14;
const DEFAULT_LIST_LIMIT = 12;
const MAX_LIST_LIMIT = 100;

const TABLE = "cycles";
const CYCLE_COLUMNS = "id,start_date,menstruation_length_days,notes,created_at";

const ALLOWED_ORIGIN_PATTERNS = [
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

  const params = new URLSearchParams();
  params.set("id", `eq.${payload.id}`);
  params.set("user_id", `eq.${userId}`);
  params.set("select", "id");

  try {
    const data = await supabaseFetchJson(
      `/rest/v1/${TABLE}?${params.toString()}`,
      {
        method: "DELETE",
        headers: { "Prefer": "return=representation" },
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
  }

  return errorResponse(origin, 500, "Internal error", "unreachable");
});
