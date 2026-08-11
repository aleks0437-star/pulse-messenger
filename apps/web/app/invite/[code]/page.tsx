"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, MessageCircle, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { api, getAccessToken } from "@/lib/api";

type Preview = { title: string; avatarUrl?: string; memberCount: number };

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
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
    const hasToken = Boolean(getAccessToken());
    setAuthenticated(hasToken);
    api<Preview>(`/invites/${encodeURIComponent(code)}`)
      .then((value) => {
        setPreview(value);
        if (hasToken && !attempted.current) {
          attempted.current = true;
          void join();
        }
      })
      .catch((reason) => {
        if (hasToken && !attempted.current) {
          attempted.current = true;
          void join();
        } else setError((reason as Error).message);
      });
  }, [code]);
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
          <div className="mt-5">
            <AuthForm
              onAuthenticated={() => {
                setAuthenticated(true);
                attempted.current = true;
                return join();
              }}
            />
          </div>
        )}
      </section>
    </main>
  );
}
