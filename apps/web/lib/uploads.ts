import { api } from './api';

export type UploadScope = 'MESSAGE' | 'USER_AVATAR' | 'CHAT_AVATAR';
export type UploadedObject = { fileUrl: string; fileName: string; objectKey: string; mimeType: string; size: number };
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const FILE_TYPES = new Set([
  'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
]);
const IMAGE_MAX = Number(process.env.NEXT_PUBLIC_MEDIA_IMAGE_MAX_BYTES ?? 10 * 1024 * 1024);
const FILE_MAX = Number(process.env.NEXT_PUBLIC_MEDIA_FILE_MAX_BYTES ?? 25 * 1024 * 1024);
const AVATAR_MAX = Number(process.env.NEXT_PUBLIC_MEDIA_AVATAR_MAX_BYTES ?? 5 * 1024 * 1024);

export function formatBytes(value?: number) {
  if (!value) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ']; let n = value; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function validateUpload(file: File, scope: UploadScope) {
  const image = IMAGE_TYPES.has(file.type);
  if (scope !== 'MESSAGE' && !image) throw new Error('Для аватара выберите JPG, PNG, WebP или GIF');
  if (scope === 'MESSAGE' && !image && !FILE_TYPES.has(file.type)) throw new Error('Этот тип файла не поддерживается');
  const limit = scope === 'MESSAGE' ? (image ? IMAGE_MAX : FILE_MAX) : AVATAR_MAX;
  if (file.size > limit) throw new Error(`Файл превышает лимит ${Math.round(limit / 1024 / 1024)} МБ`);
  if (!file.size) throw new Error('Нельзя загрузить пустой файл');
}

export async function uploadFile(file: File, scope: UploadScope, chatId: string | undefined, onProgress: (value: number) => void, signal: AbortSignal): Promise<UploadedObject> {
  validateUpload(file, scope); onProgress(3);
  const signed = await api<{ uploadUrl: string; fileUrl: string; objectKey: string; fileName: string; headers: Record<string, string> }>('/uploads/presign', { method: 'POST', body: JSON.stringify({ scope, chatId, fileName: file.name, mimeType: file.type, size: file.size }) });
  if (signal.aborted) throw new DOMException('Загрузка отменена', 'AbortError');
  onProgress(8);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signed.uploadUrl);
    Object.entries(signed.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => event.lengthComputable && onProgress(8 + Math.round(event.loaded / event.total * 90));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Хранилище отклонило загрузку (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Сеть прервалась во время загрузки'));
    xhr.onabort = () => reject(new DOMException('Загрузка отменена', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  onProgress(100);
  return { fileUrl: signed.fileUrl, fileName: signed.fileName, objectKey: signed.objectKey, mimeType: file.type, size: file.size };
}
