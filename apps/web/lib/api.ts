export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const AUTH_EVENT = "pulse:auth-changed";
const ACCESS_KEY = "pulse_token";
const REFRESH_KEY = "pulse_refresh_token";
type TokenPair = { accessToken: string; refreshToken: string };
let refreshPromise: Promise<string | null> | null = null;

function browser() {
  return typeof window !== "undefined";
}
function emitAuthChange() {
  if (browser()) window.dispatchEvent(new Event(AUTH_EVENT));
}
export function getAccessToken() {
  return browser() ? localStorage.getItem(ACCESS_KEY) : null;
}
export function getRefreshToken() {
  return browser() ? localStorage.getItem(REFRESH_KEY) : null;
}
export function storeSession(tokens: TokenPair) {
  if (!browser()) return;
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  emitAuthChange();
}
export function clearSession() {
  if (!browser()) return;
  const hadSession = Boolean(
    localStorage.getItem(ACCESS_KEY) || localStorage.getItem(REFRESH_KEY),
  );
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  if (hadSession) emitAuthChange();
}
export function accessTokenExpiresAt(token = getAccessToken()) {
  if (!token) return 0;
  try {
    const part = token.split(".")[1];
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}
async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  const message = body?.message;
  return Array.isArray(message)
    ? message.join(". ")
    : typeof message === "string"
      ? message
      : "Ошибка запроса";
}
export async function refreshSession() {
  if (!browser()) return null;
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return null;
  }
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const tokens = (await response.json()) as TokenPair;
      if (!tokens.accessToken || !tokens.refreshToken)
        throw new Error("Сервер не вернул токены");
      storeSession(tokens);
      return tokens.accessToken;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
export async function ensureFreshAccessToken(minValiditySeconds = 0) {
  const token = getAccessToken();
  const expiresAt = accessTokenExpiresAt(token);
  if (token && expiresAt > Date.now() + minValiditySeconds * 1000) return token;
  if (!getRefreshToken()) {
    if (token && expiresAt > Date.now()) return token;
    clearSession();
    return null;
  }
  return refreshSession();
}
function mayRefresh(path: string) {
  return ![
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/logout",
  ].includes(path);
}
async function timedFetch(url:string,options:RequestInit,timeoutMs=20_000){
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort(options.signal?.reason);
  if(options.signal?.aborted)abort();else options.signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal})}
  catch(error){if(timedOut)throw new Error("Сервер не ответил вовремя. Проверьте соединение");throw error}
  finally{clearTimeout(timer);options.signal?.removeEventListener("abort",abort)}
}
export async function api<T>(path: string, options: RequestInit = {}) {
  let token = getAccessToken();
  if (mayRefresh(path) && (!token || accessTokenExpiresAt(token) <= Date.now()))
    token = await ensureFreshAccessToken();
  const request = (access: string | null) =>
    timedFetch(`${API}/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...options.headers,
      },
    });
  let response = await request(token);
  if (response.status === 401 && mayRefresh(path)) {
    const refreshed = await refreshSession();
    if (refreshed) response = await request(refreshed);
    if (response.status === 401) clearSession();
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}
