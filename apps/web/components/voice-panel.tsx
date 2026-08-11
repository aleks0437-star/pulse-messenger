"use client";

import "@livekit/components-styles";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";

function RoomBody({ onLeave }: { onLeave: () => void }) {
  const people = useParticipants();
  const speaking = useSpeakingParticipants();
  const { isMicrophoneEnabled } = useLocalParticipant();
  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="border-b border-slate-200 p-5 dark:border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500">Голосовой чат</p>
        <h2 className="mt-1 text-lg font-bold">В эфире · {people.length}</h2>
      </div>
      <div className="scrollbar flex-1 space-y-2 overflow-y-auto p-4">
        {people.map((participant) => (
          <div
            key={participant.identity}
            className={`flex items-center gap-3 rounded-2xl p-3 transition ${speaking.includes(participant) ? "bg-emerald-50 ring-2 ring-emerald-400 dark:bg-emerald-950/30" : "bg-slate-50 dark:bg-slate-800"}`}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-600">{participant.name?.[0] ?? "?"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{participant.name ?? participant.identity}</p>
              <p className="text-xs text-slate-500">{speaking.includes(participant) ? "говорит" : "слушает"}</p>
            </div>
            {speaking.includes(participant) && <Volume2 className="text-emerald-500" />}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-3 border-t border-slate-200 p-4 dark:border-slate-700">
        <TrackToggle
          source={Track.Source.Microphone}
          className="!rounded-full !border-0 !bg-slate-200 !p-3 !text-slate-700 dark:!bg-slate-700 dark:!text-white"
          aria-label={isMicrophoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
        >
          {isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </TrackToggle>
        <button onClick={onLeave} className="rounded-full bg-rose-500 p-3 text-white" aria-label="Покинуть голосовой чат">
          <PhoneOff />
        </button>
      </div>
      <RoomAudioRenderer />
      <StartAudio label="Включить звук" />
    </div>
  );
}

export function VoicePanel({
  token,
  url,
  onLeave,
  onError,
}: {
  token: string;
  url: string;
  onLeave: () => void;
  onError: (message: string) => void;
}) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect
      audio
      video={false}
      onDisconnected={onLeave}
      onError={(error) => onError(`Ошибка голосового чата: ${error.message}`)}
      className="h-full"
    >
      <RoomBody onLeave={onLeave} />
    </LiveKitRoom>
  );
}
