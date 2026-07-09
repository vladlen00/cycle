// Mini App: Цикл - auth.js
// Авторизация и API-обёртка для cycles-api Edge Function.
// Регистрирует:
//   window.IrenaAuth - проверка доступа через verify-access (членство в платном канале),
//                      хранение и валидация JWT в localStorage.
//   window.CyclesApi - тонкая обёртка для CRUD-запросов к cycles-api с автоподстановкой
//                      Bearer-токена из IrenaAuth.
//
// Зависимости: window.Telegram.WebApp (грузится через telegram-web-app.js до этого файла).
// app.js должен сам вызвать IrenaAuth.checkAccess() в своём init - этот файл ничего
// автоматически не делает при загрузке.

(function () {
  // === IrenaAuth ===

  const VERIFY_URL = "https://kjzxrpwqyyjcykwbqskn.supabase.co/functions/v1/verify-access";
  const TOKEN_KEY = "irena_access_token";
  const TOKEN_EXPIRES_KEY = "irena_access_token_expires_at";
  const SUBSCRIBE_URL = "https://t.me/Biochakirena_bot";
  // Веб-развязка: на вебе (нет initData) blocked-экран ведёт не в бот, а на корень
  // app.irenabio.com - там routeHomeOrCheckout сперва проверяет Supabase-сессию и
  // отдаёт залогиненному подписчику его ДОМ (повторной оплаты не будет), а не чекаут.
  const WEB_APP_URL = "https://app.irenabio.com/";
  const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // минута запаса перед expires_at
  // 7 дней - совпадает с JWT_TTL_SECONDS в verify-access. Если сервер не пришлёт
  // expiresIn в ответе, локальный кэш должен жить ровно столько же, сколько реальный JWT
  // на сервере (иначе клиент будет принудительно ходить в verify-access чаще, чем нужно).
  const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

  function getStoredToken() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const expiresAt = parseInt(localStorage.getItem(TOKEN_EXPIRES_KEY) || "0", 10);
      if (!token || !expiresAt) return null;
      if (Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS) return null;
      return token;
    } catch {
      return null;
    }
  }

  function storeToken(token, ttlSeconds) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRES_KEY, String(Date.now() + ttlSeconds * 1000));
    } catch {
      // localStorage может быть недоступен (приватный режим, ограничения) - тихо игнорируем
    }
  }

  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRES_KEY);
    } catch {
      // тихо игнорируем
    }
  }

  // ДВЕРЬ 2: веб-токен из фрагмента URL. Активна только на веб-платформе (там нет Telegram
  // initData). В Телеграме irena_token в хэше нет -> no-op, initData-ветка не затрагивается.
  function consumeWebToken() {
    try {
      let raw = window.location.hash || "";
      if (raw.charAt(0) === "#") raw = raw.slice(1);
      if (!raw) return false;
      const params = new URLSearchParams(raw);
      const token = params.get("irena_token");
      if (!token) return false;
      let ttl = parseInt(params.get("exp") || "0", 10);
      if (!ttl || ttl <= 0) ttl = 900; // дефолт 15 мин (реальный TTL задаёт сервер mint-app-token)
      storeToken(token, ttl);
      // вычистить токен из URL, чтобы не остался в истории и не шарился ссылкой
      params.delete("irena_token");
      params.delete("exp");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? "#" + rest : ""));
      return true;
    } catch {
      return false;
    }
  }

  function getInitData() {
    try {
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        return window.Telegram.WebApp.initData;
      }
    } catch {
      // Telegram-объект может отсутствовать (открыли вне мессенджера) - вернём null ниже
    }
    return null;
  }

  function showBlocked(reason) {
    document.body.innerHTML = "";
    // Веб-контекст = нет initData. На вебе текст и кнопка ведут в приложение (сессию
    // разрулит корень), в Телеграме - прежний путь в бот за подпиской (870 не тронуты).
    const isTg = !!getInitData();
    const message = isTg
      ? "Трекер цикла доступен только участницам клуба Ирены Пол. Для получения доступа перейди в бот и оформи подписку."
      : "Трекер цикла доступен участницам клуба Ирены Пол. Открой приложение, чтобы продолжить.";
    const ctaHref = isTg ? SUBSCRIBE_URL : WEB_APP_URL;
    const ctaText = isTg ? "Оформить подписку" : "Открыть приложение";
    const ctaAttrs = isTg ? 'target="_blank" rel="noopener"' : "";
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:999999;background:#fbf6f1;color:#3a2a2a;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "padding:24px;box-sizing:border-box;text-align:center;" +
      "font-family:'Raleway',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    overlay.innerHTML = `
      <div style="font-size:64px;margin-bottom:24px;">🌸</div>
      <div style="font-size:22px;font-weight:600;margin-bottom:12px;letter-spacing:0.02em;">Доступ закрыт</div>
      <div style="font-size:15px;line-height:1.6;color:rgba(58,42,42,0.65);margin-bottom:32px;max-width:340px;">${message}</div>
      <a href="${ctaHref}" ${ctaAttrs} style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#e8a5a0,#d88a85);color:#fff;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;box-shadow:0 8px 24px rgba(232,165,160,0.35);">${ctaText}</a>
      ${reason ? `<div style="position:absolute;bottom:12px;left:0;right:0;font-size:10px;color:rgba(58,42,42,0.2);text-align:center;">${reason}</div>` : ""}
    `;
    document.body.appendChild(overlay);
  }

  async function checkAccess() {
    // ДВЕРЬ 2: если в URL свежий #irena_token - ВСЕГДА принять и вычистить URL (даже при живом
    // кэше). В Телеграме это no-op. Ниже initData-ветка (870) дословно прежняя.
    consumeWebToken();
    const cached = getStoredToken();
    if (cached) return true;

    const initData = getInitData();
    if (!initData) {
      showBlocked("no_telegram_context");
      return false;
    }

    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.token) {
        storeToken(data.token, data.expiresIn || DEFAULT_TTL_SECONDS);
        return true;
      }
      const reason =
        res.status === 403 ? "not_a_member" :
        res.status === 401 ? "invalid_init_data" :
        "error_" + res.status;
      showBlocked(reason);
      return false;
    } catch {
      showBlocked("network_error");
      return false;
    }
  }

  // === CyclesApi ===

  const CYCLES_API_URL = "https://kjzxrpwqyyjcykwbqskn.supabase.co/functions/v1/cycles-api";

  async function request(action, payload) {
    const token = getStoredToken();
    if (!token) {
      throw new Error("no_token");
    }

    const res = await fetch(CYCLES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify({ action, payload: payload || {} }),
    });

    // 401 от cycles-api = токен протух или подпись не сошлась.
    // Чистим токен и блокируем UI - пользователь увидит экран подписки.
    if (res.status === 401) {
      clearToken();
      showBlocked("token_expired");
      throw new Error("token_expired");
    }

    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error("bad_response");
    }

    if (body && body.ok === true) {
      return body.data;
    }

    const reason = (body && (body.reason || body.error)) || ("http_" + res.status);
    throw new Error(reason);
  }

  function list(payload)   { return request("list",   payload); }
  function create(payload) { return request("create", payload); }
  function update(payload) { return request("update", payload); }
  function del(payload)    { return request("delete", payload); }

  // === Export ===

  if (typeof window !== "undefined") {
    window.IrenaAuth = {
      VERIFY_URL,
      TOKEN_KEY,
      TOKEN_EXPIRES_KEY,
      SUBSCRIBE_URL,
      getStoredToken,
      storeToken,
      clearToken,
      getInitData,
      showBlocked,
      checkAccess,
    };

    window.CyclesApi = {
      CYCLES_API_URL,
      request,
      list,
      create,
      update,
      delete: del,
    };
  }
})();
