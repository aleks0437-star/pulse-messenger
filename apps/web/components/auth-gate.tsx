"use client";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import {
  api,
  accessTokenExpiresAt,
  AUTH_EVENT,
  ensureFreshAccessToken,
  getRefreshToken,
} from "@/lib/api";
import { AuthForm } from "./auth-form";
import { Messenger } from "./messenger";

export function AuthGate() {
  const [state, setState] = useState<"checking" | "authenticated" | "guest">(
    "checking",
  );
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const lead = getRefreshToken() ? 120_000 : 0;
      const delay = Math.max(1000, accessTokenExpiresAt() - Date.now() - lead);
      timer = setTimeout(() => void check(false), delay);
    };
    const check = async (showLoading = true) => {
      if (showLoading && active) setState("checking");
      const token = await ensureFreshAccessToken(120);
      if (!token) {
        if (active) setState("guest");
        return;
      }
      try {
        await api("/auth/me");
        if (active) {
          setState("authenticated");
          schedule();
        }
      } catch {
        if (active) setState("guest");
      }
    };
    const changed = () => void check(false);
    const visible = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    window.addEventListener(AUTH_EVENT, changed);
    document.addEventListener("visibilitychange", visible);
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener(AUTH_EVENT, changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  if (state === "checking")
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center text-slate-500">
          <span className="mx-auto mb-3 grid h-12 w-12 animate-pulse place-items-center rounded-2xl bg-indigo-500 text-white">
            <MessageCircle />
          </span>
          Проверяем сессию…
        </div>
      </main>
    );
  if (state === "guest")
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-slate-50 p-4 dark:bg-slate-950">
        <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-900">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-500 text-white">
            <MessageCircle size={30} />
          </div>
          <h1 className="mt-4 text-center text-3xl font-bold">Pulse</h1>
          <p className="mb-5 mt-1 text-center text-sm text-slate-500">
            Войдите, чтобы продолжить общение
          </p>
          <AuthForm onAuthenticated={() => setState("authenticated")} />
        </section>
      </main>
    );
  return (
    <main>
      <Messenger />
    </main>
  );
}
