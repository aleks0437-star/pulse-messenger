import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorageService, UploadScope } from '../src/storage';

function harness(member: any = { role: 'MEMBER' }) {
  const config: any = {
    get: jest.fn((key: string, fallback: unknown) => ({
      S3_ENDPOINT: 'http://localhost:9000', S3_BUCKET: 'pulse-media', S3_PUBLIC_URL: 'http://localhost:9000/pulse-media',
      MEDIA_IMAGE_MAX_BYTES: 10 * 1024 * 1024, MEDIA_FILE_MAX_BYTES: 25 * 1024 * 1024, MEDIA_AVATAR_MAX_BYTES: 5 * 1024 * 1024,
      MEDIA_PRESIGN_TTL_SECONDS: 300, S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true',
    } as Record<string, unknown>)[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => key === 'S3_ACCESS_KEY' ? 'minio' : 'miniosecret'),
  };
  const db: any = { chatMember: { findUnique: jest.fn().mockResolvedValue(member) } };
  return { db, service: new StorageService(config, db) };
}

describe('StorageService presigned uploads', () => {
  it('returns a short-lived signed URL for a chat member', async () => {
    const { service } = harness();
    const result = await service.presign({ scope: UploadScope.MESSAGE, chatId: 'chat-1', fileName: 'photo.png', mimeType: 'image/png', size: 1024 }, 'user-1');
    expect(result.uploadUrl).toContain('X-Amz-Signature=');
    expect(result.fileUrl).toContain('/message/chat-1/');
    expect(result.expiresIn).toBe(300);
  });

  it('rejects an upload to a foreign chat', async () => {
    const { service } = harness(null);
    await expect(service.presign({ scope: UploadScope.MESSAGE, chatId: 'foreign', fileName: 'a.png', mimeType: 'image/png', size: 100 }, 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsupported MIME types and oversized files', async () => {
    const { service } = harness();
    await expect(service.presign({ scope: UploadScope.MESSAGE, chatId: 'chat-1', fileName: 'payload.exe', mimeType: 'application/x-msdownload', size: 100 }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.presign({ scope: UploadScope.MESSAGE, chatId: 'chat-1', fileName: 'huge.png', mimeType: 'image/png', size: 10 * 1024 * 1024 + 1 }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sanitizes traversal, null bytes and overlong names', () => {
    const { service } = harness();
    expect(service.sanitizeFileName('../../folder/evil\0 name.pdf')).toBe('evil-name.pdf');
    expect(service.sanitizeFileName('a'.repeat(300) + '.pdf')).toHaveLength(120);
    expect(() => service.sanitizeFileName('../')).toThrow(BadRequestException);
  });
});
