import { BadRequestException, Body, Controller, ForbiddenException, Injectable, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from './auth';
import { PrismaService } from './prisma.service';
import { ChatRealtimeService } from './chat-realtime';

export enum UploadScope { MESSAGE = 'MESSAGE', USER_AVATAR = 'USER_AVATAR', CHAT_AVATAR = 'CHAT_AVATAR' }
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const FILE_TYPES = new Set([
  'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
]);

export class PresignUploadDto {
  @IsEnum(UploadScope) scope!: UploadScope;
  @IsOptional() @IsString() @MaxLength(64) chatId?: string;
  @IsString() @MaxLength(1024) fileName!: string;
  @IsString() @MaxLength(128) mimeType!: string;
  @IsInt() @Min(1) size!: number;
}
class AvatarDto { @IsString() @MaxLength(2048) avatarUrl!: string; }

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;
  readonly imageMax: number;
  readonly fileMax: number;
  readonly avatarMax: number;
  readonly ttl: number;

  constructor(private config: ConfigService, private db: PrismaService, private realtime:ChatRealtimeService) {
    const endpoint = config.get('S3_ENDPOINT', 'http://localhost:9000').replace(/\/$/, '');
    this.bucket = config.get('S3_BUCKET', 'pulse-media');
    this.publicBase = config.get('S3_PUBLIC_URL', `${endpoint}/${this.bucket}`).replace(/\/$/, '');
    this.imageMax = Number(config.get('MEDIA_IMAGE_MAX_BYTES', 10 * 1024 * 1024));
    this.fileMax = Number(config.get('MEDIA_FILE_MAX_BYTES', 25 * 1024 * 1024));
    this.avatarMax = Number(config.get('MEDIA_AVATAR_MAX_BYTES', 5 * 1024 * 1024));
    this.ttl = Number(config.get('MEDIA_PRESIGN_TTL_SECONDS', 300));
    this.client = new S3Client({
      endpoint,
      region: config.get('S3_REGION', 'us-east-1'),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', 'true') === 'true',
      credentials: { accessKeyId: config.getOrThrow('S3_ACCESS_KEY'), secretAccessKey: config.getOrThrow('S3_SECRET_KEY') },
    });
  }

  sanitizeFileName(input: string) {
    const base = input.split(/[\\/]/).pop()?.normalize('NFKC') ?? '';
    const safe = base.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 120);
    if (!safe) throw new BadRequestException('Некорректное имя файла');
    return safe;
  }

  validate(scope: UploadScope, mimeType: string, size: number) {
    const isImage = IMAGE_TYPES.has(mimeType);
    if (scope !== UploadScope.MESSAGE && !isImage) throw new BadRequestException('Для аватара разрешены только JPG, PNG, WebP и GIF');
    if (scope === UploadScope.MESSAGE && !isImage && !FILE_TYPES.has(mimeType)) throw new BadRequestException('Этот тип файла не поддерживается');
    const limit = scope === UploadScope.MESSAGE ? (isImage ? this.imageMax : this.fileMax) : this.avatarMax;
    if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw new BadRequestException(`Файл превышает лимит ${Math.round(limit / 1024 / 1024)} МБ`);
  }

  private prefix(scope: UploadScope, userId: string, chatId?: string) {
    if (scope === UploadScope.MESSAGE) return `message/${chatId}`;
    if (scope === UploadScope.CHAT_AVATAR) return `avatar/chat/${chatId}`;
    return `avatar/user/${userId}`;
  }

  async presign(dto: PresignUploadDto, userId: string) {
    if (dto.scope !== UploadScope.USER_AVATAR) {
      if (!dto.chatId) throw new BadRequestException('chatId обязателен');
      const member = await this.db.chatMember.findUnique({ where: { chatId_userId: { chatId: dto.chatId, userId } } });
      if (!member) throw new ForbiddenException('Вы не состоите в этом чате');
      if (dto.scope === UploadScope.CHAT_AVATAR && !['OWNER', 'ADMIN'].includes(member.role)) throw new ForbiddenException('Аватар группы может менять администратор');
    }
    this.validate(dto.scope, dto.mimeType, dto.size);
    const fileName = this.sanitizeFileName(dto.fileName);
    const objectKey = `${this.prefix(dto.scope, userId, dto.chatId)}/${randomUUID()}-${fileName}`;
    const disposition = `${IMAGE_TYPES.has(dto.mimeType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    const uploadUrl = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: dto.mimeType, ContentDisposition: disposition }), { expiresIn: this.ttl });
    return { uploadUrl, fileUrl: this.urlFor(objectKey), objectKey, fileName, expiresIn: this.ttl, headers: { 'Content-Type': dto.mimeType, 'Content-Disposition': disposition } };
  }

  urlFor(key: string) { return `${this.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`; }
  assertUrlScope(url: string, prefix: string) {
    const expected = `${this.publicBase}/${prefix}/`;
    if (!url.startsWith(expected) || url.includes('..')) throw new BadRequestException('Недопустимый URL вложения');
  }
  assertMessageAttachment(chatId: string, data: { mediaUrl?: string; mediaName?: string; mediaType?: string; mediaSize?: number }) {
    const present = [data.mediaUrl, data.mediaName, data.mediaType, data.mediaSize].filter(v => v !== undefined && v !== null).length;
    if (present === 0) return;
    if (present !== 4) throw new BadRequestException('Для вложения нужны URL, имя, тип и размер');
    this.validate(UploadScope.MESSAGE, data.mediaType!, data.mediaSize!);
    if (this.sanitizeFileName(data.mediaName!) !== data.mediaName) throw new BadRequestException('Некорректное имя вложения');
    this.assertUrlScope(data.mediaUrl!, `message/${chatId}`);
  }
  async updateUserAvatar(userId:string,avatarUrl:string){
    this.assertUrlScope(avatarUrl,`avatar/user/${userId}`);
    const user=await this.db.user.update({where:{id:userId},data:{avatarUrl},select:{id:true,username:true,displayName:true,avatarUrl:true}});
    const memberships=await this.db.chatMember.findMany({where:{userId},select:{chatId:true}});
    await Promise.all(memberships.map(async({chatId})=>{
      const member=await this.db.chatMember.findUnique({where:{chatId_userId:{chatId,userId}},include:{user:{select:{id:true,username:true,displayName:true,avatarUrl:true}}}});
      if(member)this.realtime.memberUpdated(chatId,member);
    }));
    return user;
  }
  async updateChatAvatar(chatId:string,userId:string,avatarUrl:string){
    const member=await this.db.chatMember.findUnique({where:{chatId_userId:{chatId,userId}}});
    if(!member||!['OWNER','ADMIN'].includes(member.role))throw new ForbiddenException('Аватар группы может менять администратор');
    this.assertUrlScope(avatarUrl,`avatar/chat/${chatId}`);
    const chat=await this.db.chat.update({where:{id:chatId},data:{avatarUrl}});
    this.realtime.chatUpdated(chatId,chat);
    return chat;
  }
}

@Controller('uploads')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class StorageController {
  constructor(private storage: StorageService, private db: PrismaService) {}

  @Post('presign')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async presign(@Req() req: any, @Body() dto: PresignUploadDto) {
    return this.storage.presign(dto, req.user.id);
  }

  @Patch('avatars/me')
  async userAvatar(@Req() req: any, @Body() dto: AvatarDto) {
    return this.storage.updateUserAvatar(req.user.id,dto.avatarUrl);
  }

  @Patch('avatars/chats/:chatId')
  async chatAvatar(@Req() req: any, @Body() dto: AvatarDto) {
    return this.storage.updateChatAvatar(req.params.chatId,req.user.id,dto.avatarUrl);
  }
}
