"use client";
import { FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, storeSession } from "@/lib/api";

type AuthResult = { accessToken: string; refreshToken: string };
export function AuthForm({
  onAuthenticated,
}: {
  onAuthenticated?: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const body =
        mode === "login"
          ? { login: data.get("login"), password: data.get("password") }
          : {
              email: data.get("email"),
              username: data.get("username"),
              displayName: data.get("displayName"),
              password: data.get("password"),
            };
      const result = await api<AuthResult>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      storeSession(result);
      await onAuthenticated?.();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError("");
          }}
          className={`rounded-xl p-2 text-sm font-semibold ${mode === "login" ? "bg-white shadow dark:bg-slate-700" : "text-slate-500"}`}
        >
          Войти
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError("");
          }}
          className={`rounded-xl p-2 text-sm font-semibold ${mode === "register" ? "bg-white shadow dark:bg-slate-700" : "text-slate-500"}`}
        >
          Регистрация
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-rose-50 p-3 text-center text-sm text-rose-600 dark:bg-rose-950/30"
        >
          {error}
        </div>
      )}
      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === "register" && (
          <>
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              placeholder="Email"
              aria-label="Email"
              className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
            />
            <input
              name="username"
              required
              minLength={3}
              maxLength={32}
              placeholder="Username"
              aria-label="Username"
              className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
            />
            <input
              name="displayName"
              required
              minLength={2}
              maxLength={80}
              placeholder="Как вас зовут"
              aria-label="Как вас зовут"
              className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
            />
          </>
        )}
        {mode === "login" && (
          <input
            name="login"
            required
            placeholder="Email или username"
            aria-label="Email или username"
            className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
          />
        )}
        <input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 10 : 1}
          maxLength={128}
          placeholder="Пароль"
          aria-label="Пароль"
          className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
        />
        {mode === "register" && (
          <small className="block text-slate-500">
            Не менее 10 символов, включая буквы и цифры
          </small>
        )}
        <button
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 p-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
          <ArrowRight size={18} />
        </button>
      </form>
    </>
  );
}
