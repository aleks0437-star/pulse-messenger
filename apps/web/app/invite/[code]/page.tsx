"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, MessageCircle, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

type Preview = { title: string; avatarUrl?: string; memberCount: number };
type AuthResult = { accessToken: string; refreshToken: string };

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const attempted = useRef(false);
  async function join() {
    setBusy(true);
    setError("");
    try {
      const chat = await api<{ id: string }>(
        `/invites/${encodeURIComponent(code)}/join`,
        { method: "POST" },
      );
      location.replace(`/?chatId=${encodeURIComponent(chat.id)}`);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!code) return;
    api<Preview>(`/invites/${encodeURIComponent(code)}`)
      .then((value) => {
        setPreview(value);
        const hasToken = Boolean(localStorage.getItem("pulse_token"));
        setAuthenticated(hasToken);
        if (hasToken && !attempted.current) {
          attempted.current = true;
          void join();
        }
      })
      .catch((reason) => setError((reason as Error).message));
  }, [code]);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
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
      localStorage.setItem("pulse_token", result.accessToken);
      localStorage.setItem("pulse_refresh_token", result.refreshToken);
      setAuthenticated(true);
      await join();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-slate-50 p-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-indigo-500 text-2xl font-bold text-white">
          {preview?.avatarUrl ? (
            <img
              src={preview.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <MessageCircle />
          )}
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold">
          {preview?.title ?? "Присоединиться к группе в Pulse"}
        </h1>
        {preview && (
          <p className="mt-1 flex items-center justify-center gap-1 text-sm text-slate-500">
            <Users size={15} />
            {preview.memberCount} участников
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-2xl bg-rose-50 p-3 text-center text-sm text-rose-600 dark:bg-rose-950/30"
          >
            {error}
          </div>
        )}
        {preview && authenticated && (
          <button
            onClick={join}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 p-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Присоединяем…" : "Присоединиться"}
            <ArrowRight size={18} />
          </button>
        )}
        {preview && !authenticated && (
            <>
              <div className="mt-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  onClick={() => setMode("login")}
                  className={`rounded-xl p-2 text-sm font-semibold ${mode === "login" ? "bg-white shadow dark:bg-slate-700" : "text-slate-500"}`}
                >
                  Войти
                </button>
                <button
                  onClick={() => setMode("register")}
                  className={`rounded-xl p-2 text-sm font-semibold ${mode === "register" ? "bg-white shadow dark:bg-slate-700" : "text-slate-500"}`}
                >
                  Регистрация
                </button>
              </div>
              <form onSubmit={authenticate} className="mt-4 space-y-3">
                {mode === "register" && (
                  <>
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Email"
                      className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                    />
                    <input
                      name="username"
                      required
                      minLength={3}
                      placeholder="Username"
                      className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                    />
                    <input
                      name="displayName"
                      required
                      placeholder="Как вас зовут"
                      className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                    />
                  </>
                )}
                {mode === "login" && (
                  <input
                    name="login"
                    required
                    placeholder="Email или username"
                    className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                  />
                )}
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  placeholder="Пароль"
                  className="w-full rounded-2xl bg-slate-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                />
                <button
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 p-3 font-semibold text-white disabled:opacity-50"
                >
                  {busy
                    ? "Подождите…"
                    : mode === "login"
                      ? "Войти и присоединиться"
                      : "Создать аккаунт и присоединиться"}
                  <ArrowRight size={18} />
                </button>
              </form>
            </>
          )}
      </section>
    </main>
  );
}
