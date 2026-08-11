"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Search, UserRound, Users, X } from "lucide-react";
import { api } from "@/lib/api";

type FoundUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
};

export function NewChatDialog({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (chat: any) => void;
  onError: (message: string) => void;
}) {
  const [type, setType] = useState<"DIRECT" | "GROUP">("DIRECT");
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [selected, setSelected] = useState<FoundUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const users = await api<FoundUser[]>(
          `/users/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        setResults(users);
      } catch (error) {
        if ((error as Error).name !== "AbortError")
          onError((error as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, onError]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setQuery("");
    setResults([]);
    setSelected([]);
    setType("DIRECT");
  }, [open]);

  function toggle(user: FoundUser) {
    if (type === "DIRECT") {
      setSelected([user]);
      return;
    }
    setSelected((items) =>
      items.some((item) => item.id === user.id)
        ? items.filter((item) => item.id !== user.id)
        : [...items, user],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (type === "DIRECT" && selected.length !== 1) {
      onError("Выберите собеседника");
      return;
    }
    if (type === "GROUP" && !title.trim()) {
      onError("Укажите название группы");
      return;
    }
    setBusy(true);
    try {
      const chat = await api("/chats", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: type === "GROUP" ? title.trim() : undefined,
          memberIds: selected.map((user) => user.id),
        }),
      });
      onCreated(chat);
      onClose();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Новый чат"
        className="flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="flex items-center border-b border-slate-200 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-bold">Новый чат</h2>
            <p className="text-sm text-slate-500">Найдите друзей по имени или username</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-xl p-2" aria-label="Закрыть">
            <X />
          </button>
        </header>
        <div className="scrollbar flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Тип чата">
            {([
              ["DIRECT", UserRound, "Личный чат"],
              ["GROUP", Users, "Группа"],
            ] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={type === value}
                onClick={() => {
                  setType(value);
                  setSelected((items) => (value === "DIRECT" ? items.slice(0, 1) : items));
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl p-3 font-semibold ${type === value ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-800"}`}
              >
                <Icon size={18} /> {label}
              </button>
            ))}
          </div>
          {type === "GROUP" && (
            <label className="block text-sm font-semibold">
              Название группы
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                className="mt-1 w-full rounded-2xl bg-slate-100 px-4 py-3 font-normal outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800"
                placeholder="Например, Поход на выходных"
              />
            </label>
          )}
          <label className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent outline-none"
              placeholder="Имя, username или email"
              aria-label="Найти пользователя"
            />
          </label>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Выбранные пользователи">
              {selected.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggle(user)}
                  className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 dark:bg-indigo-950/40"
                >
                  {user.displayName} ×
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {query.trim().length < 2 ? (
              <p className="py-6 text-center text-sm text-slate-500">Введите минимум два символа для поиска</p>
            ) : searching ? (
              <p className="py-6 text-center text-sm text-slate-500">Ищем…</p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Никого не найдено</p>
            ) : (
              results.map((user) => {
                const checked = selected.some((item) => item.id === user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => toggle(user)}
                    className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-indigo-100 font-bold text-indigo-600">
                      {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : user.displayName[0]}
                    </span>
                    <span className="min-w-0 flex-1"><b className="block truncate">{user.displayName}</b><small className="text-slate-500">@{user.username}</small></span>
                    {checked && <Check className="text-indigo-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <footer className="border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            disabled={busy || (type === "DIRECT" ? selected.length !== 1 : !title.trim())}
            className="w-full rounded-2xl bg-indigo-500 p-3 font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Создаём…" : type === "DIRECT" ? "Начать общение" : "Создать группу"}
          </button>
        </footer>
      </form>
    </div>
  );
}
