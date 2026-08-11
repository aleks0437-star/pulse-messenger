"use client";
import { useState } from "react";
import {
  Copy,
  Link2,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
  VolumeX,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

export type GroupMember = {
  userId?: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  isMuted?: boolean;
  mutedUntil?: string | null;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    online?: boolean;
  };
};
type Invite = {
  code: string;
  url: string;
  usesCount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
};

export function GroupManagement({
  chatId,
  members,
  meId,
  onMember,
  onRemove,
  onError,
}: {
  chatId: string;
  members: GroupMember[];
  meId: string;
  onMember: (member: GroupMember) => void;
  onRemove: (userId: string) => void;
  onError: (message: string) => void;
}) {
  const me = members.find((member) => member.user.id === meId);
  const isAdmin = me?.role === "OWNER" || me?.role === "ADMIN";
  const [invite, setInvite] = useState<Invite | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [durations, setDurations] = useState<Record<string, string>>({});
  async function openInvite() {
    setBusy(true);
    try {
      setInvite(
        await api<Invite>(`/chats/${chatId}/invites`, {
          method: "POST",
          body: "{}",
        }),
      );
      setDialog(true);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rotate() {
    setBusy(true);
    try {
      setInvite(
        await api<Invite>(`/chats/${chatId}/invites/rotate`, {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      await api(`/chats/${chatId}/invites`, { method: "DELETE" });
      setInvite(null);
      setDialog(false);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
    } catch {
      onError("Не удалось скопировать ссылку");
    }
  }
  async function kick(userId: string) {
    if (!confirm("Исключить участника из группы?")) return;
    try {
      await api(`/chats/${chatId}/members/${userId}/kick`, { method: "POST" });
      onRemove(userId);
    } catch (error) {
      onError((error as Error).message);
    }
  }
  async function role(member: GroupMember) {
    const next = member.role === "ADMIN" ? "MEMBER" : "ADMIN";
    try {
      onMember(
        await api<GroupMember>(
          `/chats/${chatId}/members/${member.user.id}/role`,
          { method: "PATCH", body: JSON.stringify({ role: next }) },
        ),
      );
    } catch (error) {
      onError((error as Error).message);
    }
  }
  async function mute(member: GroupMember) {
    const active = Boolean(
      member.isMuted &&
        (!member.mutedUntil || new Date(member.mutedUntil) > new Date()),
    );
    const selected = durations[member.user.id] ?? "60";
    const payload = active
      ? { muted: false }
      : {
          muted: true,
          ...(selected === "forever"
            ? {}
            : { durationMinutes: Number(selected) }),
        };
    try {
      onMember(
        await api<GroupMember>(
          `/chats/${chatId}/members/${member.user.id}/mute`,
          { method: "PATCH", body: JSON.stringify(payload) },
        ),
      );
    } catch (error) {
      onError((error as Error).message);
    }
  }
  return (
    <>
      <div className="mt-7 flex items-center">
        <h3 className="font-bold">Участники · {members.length}</h3>
        {isAdmin && (
          <button
            onClick={openInvite}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-600 disabled:opacity-50 dark:bg-indigo-950/40"
          >
            <Link2 size={16} />
            Пригласить
          </button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {members.map((member) => {
          const activeMute = Boolean(
            member.isMuted &&
              (!member.mutedUntil || new Date(member.mutedUntil) > new Date()),
          );
          return (
            <div
              key={member.user.id}
              className="rounded-2xl p-2 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div className="flex items-center gap-3">
                <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 font-bold text-white">
                  {member.user.avatarUrl ? (
                    <img
                      src={member.user.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    member.user.displayName[0]
                  )}
                  {member.user.online&&<i className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-900"/>}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{member.user.displayName}</b>
                  <small className="block text-slate-500">
                    @{member.user.username} ·{" "}
                    {member.role === "OWNER"
                      ? "владелец"
                      : member.role === "ADMIN"
                        ? "администратор"
                        : "участник"}
                    {activeMute ? " · без права писать" : ""}
                  </small>
                </span>
              </div>
              {isAdmin &&
                member.user.id !== meId &&
                member.role !== "OWNER" && (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                    {member.role === "MEMBER" && (
                      <>
                        <select
                          value={durations[member.user.id] ?? "60"}
                          onChange={(event) =>
                            setDurations((value) => ({
                              ...value,
                              [member.user.id]: event.target.value,
                            }))
                          }
                          disabled={activeMute}
                          className="rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-700"
                          aria-label={`Срок mute для ${member.user.displayName}`}
                        >
                          <option value="15">15 минут</option>
                          <option value="60">1 час</option>
                          <option value="1440">1 день</option>
                          <option value="forever">До отмены</option>
                        </select>
                        <button
                          onClick={() => mute(member)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                          title={activeMute ? "Снять mute" : "Запретить писать"}
                          aria-label={activeMute ? "Снять mute" : "Запретить писать"}
                        >
                          {activeMute ? <ShieldOff size={16} /> : <VolumeX size={16} />}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => role(member)}
                      className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                      title={
                        member.role === "ADMIN"
                          ? "Снять права администратора"
                          : "Назначить администратором"
                      }
                      aria-label={
                        member.role === "ADMIN"
                          ? "Снять права администратора"
                          : "Назначить администратором"
                      }
                    >
                      {member.role === "ADMIN" ? (
                        <ShieldOff size={16} />
                      ) : (
                        <Shield size={16} />
                      )}
                    </button>
                    {member.role === "MEMBER" && (
                      <button
                        onClick={() => kick(member.user.id)}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Исключить"
                        aria-label="Исключить участника"
                      >
                        <UserMinus size={16} />
                      </button>
                    )}
                  </div>
                )}
            </div>
          );
        })}
      </div>
      {dialog && invite && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4"
          onMouseDown={(event) =>
            event.currentTarget === event.target && setDialog(false)
          }
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Приглашение в группу"
            className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900"
          >
            <header className="flex items-center">
              <div>
                <h2 className="text-lg font-bold">Пригласить в группу</h2>
                <p className="text-sm text-slate-500">
                  Ссылка действует, пока вы её не отзовёте
                </p>
              </div>
              <button
                onClick={() => setDialog(false)}
                className="ml-auto rounded-xl p-2"
                aria-label="Закрыть"
              >
                <X />
              </button>
            </header>
            <div className="mt-5 flex gap-2 rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
              <code className="min-w-0 flex-1 truncate text-sm">
                {invite.url}
              </code>
              <button
                onClick={copy}
                className="rounded-xl bg-indigo-500 p-2 text-white"
                aria-label="Скопировать ссылку"
              >
                <Copy size={18} />
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={revoke}
                disabled={busy}
                className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
              >
                <Trash2 size={16} />
                Отозвать
              </button>
              <button
                onClick={rotate}
                disabled={busy}
                className="flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-600 disabled:opacity-50 dark:bg-indigo-950/40"
              >
                <RefreshCw size={16} />
                Перевыпустить
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
