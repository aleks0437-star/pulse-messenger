'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, FileAudio, FileText, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react';
import { formatBytes, uploadFile, UploadScope } from '@/lib/uploads';

export function fileIcon(type?: string, size = 22) {
  if (type?.startsWith('image/')) return <ImageIcon size={size}/>;
  if (type?.startsWith('audio/')) return <FileAudio size={size}/>;
  if (type?.includes('zip')) return <FileArchive size={size}/>;
  return <FileText size={size}/>;
}

export function AttachmentPreview({ file, progress, uploading, onRemove }: { file: File; progress: number; uploading: boolean; onRemove: () => void }) {
  const [preview, setPreview] = useState('');
  useEffect(() => { if (!file.type.startsWith('image/')) return; const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  return <div className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
    <div className="relative flex items-center gap-3 rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
      {preview ? <img src={preview} alt="Предпросмотр вложения" className="h-16 w-16 rounded-xl object-cover"/> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950">{fileIcon(file.type)}</span>}
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{file.name}</p><p className="text-xs text-slate-500">{formatBytes(file.size)}{uploading ? ` · загрузка ${progress}%` : ''}</p>{uploading && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress}%` }}/></div>}</div>
      <button type="button" onClick={onRemove} className="rounded-xl p-2 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label={uploading ? 'Отменить загрузку' : 'Убрать вложение'}><X size={19}/></button>
    </div>
  </div>;
}

export function MessageMedia({ url, name, type, size, onOpen }: { url: string; name?: string; type?: string; size?: number; onOpen: (url: string, name: string) => void }) {
  if (type?.startsWith('image/')) return <button type="button" onClick={() => onOpen(url, name ?? 'Изображение')} className="mb-2 block overflow-hidden rounded-xl focus-visible:outline-white"><img src={url} alt={name ?? 'Вложенное изображение'} loading="lazy" className="max-h-80 w-full max-w-sm object-cover transition hover:scale-[1.01]"/></button>;
  return <a href={url} target="_blank" rel="noreferrer" download={name} className="mb-2 flex min-w-[220px] items-center gap-3 rounded-xl bg-black/5 p-3 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/70 text-indigo-600 dark:bg-slate-900/50">{fileIcon(type)}</span><span className="min-w-0 flex-1 text-left"><b className="block truncate text-sm">{name ?? 'Файл'}</b><small className="opacity-70">{formatBytes(size)}</small></span><Download size={19}/></a>;
}

export function ImageViewer({ image, onClose }: { image: { url: string; name: string } | null; onClose: () => void }) {
  const touch = useRef(0);
  useEffect(() => { if (!image) return; const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [image, onClose]);
  if (!image) return null;
  return <div role="dialog" aria-modal="true" aria-label={`Просмотр ${image.name}`} onMouseDown={event => event.currentTarget === event.target && onClose()} onTouchStart={e => touch.current = e.touches[0].clientY} onTouchEnd={e => Math.abs(e.changedTouches[0].clientY - touch.current) > 80 && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/90 p-0 backdrop-blur-sm sm:p-8"><button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-black/40 p-3 text-white" aria-label="Закрыть просмотр"><X/></button><img src={image.url} alt={image.name} className="max-h-[100dvh] max-w-full object-contain sm:max-h-[90vh] sm:rounded-2xl"/></div>;
}

export function AvatarUploader({ scope, chatId, onUploaded, onError, children }: { scope: Exclude<UploadScope, 'MESSAGE'>; chatId?: string; onUploaded: (url: string) => void; onError: (message: string) => void; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(''); const controller = useRef<AbortController|null>(null);
  async function select(file?: File) { if (!file) return; const localPreview = URL.createObjectURL(file); setPreview(localPreview); controller.current = new AbortController(); setBusy(true); try { const uploaded = await uploadFile(file, scope, chatId, () => {}, controller.current.signal); const path = scope === 'USER_AVATAR' ? '/uploads/avatars/me' : `/uploads/avatars/chats/${chatId}`; await apiAvatar(path, uploaded.fileUrl); onUploaded(uploaded.fileUrl); } catch (error) { if ((error as Error).name !== 'AbortError') onError((error as Error).message); } finally { URL.revokeObjectURL(localPreview); setPreview(''); setBusy(false); } }
  return <label className="group relative cursor-pointer" title="Сменить аватар">{children}{preview&&<img src={preview} alt="Предпросмотр нового аватара" className="absolute inset-0 h-full w-full rounded-full object-cover"/>}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={busy} onChange={e => { select(e.target.files?.[0]); e.currentTarget.value = ''; }}/><span className="absolute inset-0 grid place-items-center rounded-full bg-slate-950/50 text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">{busy ? <span className="animate-pulse text-xs">…</span> : <Upload size={18}/>}</span></label>;
}

async function apiAvatar(path: string, avatarUrl: string) {
  const { api } = await import('@/lib/api');
  return api(path, { method: 'PATCH', body: JSON.stringify({ avatarUrl }) });
}
