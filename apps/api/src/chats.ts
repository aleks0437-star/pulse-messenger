import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ChatType, MemberRole, MessageKind } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from './auth'; import { PrismaService } from './prisma.service';
import { StorageService } from './storage';
import { PushService } from './push';

export class CreateChatDto { @IsEnum(ChatType) type!: ChatType; @IsOptional() @IsString() @MaxLength(100) title?: string; @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) memberIds!: string[]; }
export class MessageDto {
  @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @IsOptional() @IsString() @MaxLength(64) replyToId?: string;
  @IsOptional() @IsEnum(MessageKind) kind?: MessageKind;
  @IsOptional() @IsString() @MaxLength(2048) mediaUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) mediaName?: string;
  @IsOptional() @IsString() @MaxLength(128) mediaType?: string;
  @IsOptional() @IsInt() @Min(1) mediaSize?: number;
}
export class EditDto { @IsString() @MinLength(1) @MaxLength(8000) body!: string; }
export class ReactionDto { @IsString() @MinLength(1) @MaxLength(16) emoji!: string; }
class MessagesQueryDto { @IsOptional() @IsString() @MaxLength(64) cursor?: string; }
@Injectable() export class ChatsService {
  constructor(private db: PrismaService, private storage: StorageService, private push: PushService) {}
  member(chatId: string, userId: string) { return this.db.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } }); }
  async assertMember(chatId: string, userId: string) { if (!(await this.member(chatId, userId))) throw new ForbiddenException(); }
  list(userId: string) { return this.db.chat.findMany({ where: { members: { some: { userId } } }, include: { members: { include: { user: { select: { id:true, username:true, displayName:true, avatarUrl:true } } } }, messages: { where: { deletedAt:null }, orderBy:{createdAt:'desc'}, take:1 } }, orderBy:{updatedAt:'desc'} }); }
  async create(userId: string, dto: CreateChatDto) { const ids = [...new Set([userId, ...dto.memberIds])]; if (dto.type === 'DIRECT' && ids.length !== 2) throw new BadRequestException('Direct chat needs exactly two members'); return this.db.chat.create({ data:{ type:dto.type, title:dto.type==='GROUP'?dto.title:undefined, createdById:userId, members:{ create:ids.map(id=>({userId:id,role:id===userId?MemberRole.OWNER:MemberRole.MEMBER})) } }, include:{members:{include:{user:{select:{id:true,username:true,displayName:true,avatarUrl:true}}}}} }); }
  async messages(chatId:string,userId:string,cursor?:string){ await this.assertMember(chatId,userId); return this.db.message.findMany({where:{chatId},include:{author:{select:{id:true,displayName:true,avatarUrl:true}},replyTo:true,reactions:true},orderBy:{createdAt:'desc'},take:50,...(cursor?{skip:1,cursor:{id:cursor}}:{})}); }
  async send(chatId:string,userId:string,dto:MessageDto){
    const membership=await this.member(chatId,userId);if(!membership)throw new ForbiddenException();
    if(membership.isMuted&&(!membership.mutedUntil||membership.mutedUntil>new Date()))throw new ForbiddenException('Вы не можете писать в этом чате');
    if(membership.isMuted&&membership.mutedUntil&&membership.mutedUntil<=new Date())await this.db.chatMember.update({where:{chatId_userId:{chatId,userId}},data:{isMuted:false,mutedUntil:null}});
    if(dto.kind===MessageKind.SYSTEM)throw new ForbiddenException('Системные сообщения создаёт только сервер');
    this.storage.assertMessageAttachment(chatId,dto);
    if(dto.replyToId){const target=await this.db.message.findUnique({where:{id:dto.replyToId},select:{chatId:true,kind:true}});if(!target||target.chatId!==chatId||target.kind===MessageKind.SYSTEM)throw new BadRequestException('На это сообщение нельзя ответить');}
    const body=dto.body?.trim()??'';
    if(!body&&!dto.mediaUrl)throw new BadRequestException('Сообщение должно содержать текст или вложение');
    const kind=dto.mediaType?.startsWith('image/')?MessageKind.IMAGE:(dto.mediaUrl?MessageKind.FILE:(dto.kind??MessageKind.TEXT));
    const message=await this.db.message.create({data:{chatId,authorId:userId,body,replyToId:dto.replyToId,kind,mediaUrl:dto.mediaUrl,mediaName:dto.mediaName,mediaType:dto.mediaType,mediaSize:dto.mediaSize},include:{author:{select:{id:true,displayName:true,avatarUrl:true}},reactions:true,replyTo:true}});
    await this.push.notifyNewMessage(message);
    return message;
  }
  async edit(id:string,userId:string,body:string){const m=await this.db.message.findUnique({where:{id}});if(!m)throw new NotFoundException();await this.assertMember(m.chatId,userId);if(m.kind===MessageKind.SYSTEM||m.authorId!==userId)throw new ForbiddenException();const clean=body.trim();if(!clean)throw new BadRequestException('Сообщение не может быть пустым');return this.db.message.update({where:{id},data:{body:clean,editedAt:new Date()}});}
  async remove(id:string,userId:string){const m=await this.db.message.findUnique({where:{id}});if(!m)throw new NotFoundException();await this.assertMember(m.chatId,userId);if(m.kind===MessageKind.SYSTEM||m.authorId!==userId)throw new ForbiddenException();return this.db.message.update({where:{id},data:{body:'',deletedAt:new Date()}});}
  async react(id:string,userId:string,emoji:string){const m=await this.db.message.findUnique({where:{id}});if(!m)throw new NotFoundException();await this.assertMember(m.chatId,userId);if(m.kind===MessageKind.SYSTEM)throw new ForbiddenException('Системные сообщения не поддерживают реакции');const key={messageId_userId_emoji:{messageId:id,userId,emoji}};const old=await this.db.messageReaction.findUnique({where:key});return old?this.db.messageReaction.delete({where:key}):this.db.messageReaction.create({data:{messageId:id,userId,emoji}});}
}
@Controller('chats') @UseGuards(JwtAuthGuard) export class ChatsController {
 constructor(private chats:ChatsService){}
 @Get() list(@Req() r:any){return this.chats.list(r.user.id)} @Post() create(@Req()r:any,@Body()d:CreateChatDto){return this.chats.create(r.user.id,d)}
 @Get(':id/messages') messages(@Param('id')id:string,@Req()r:any,@Query()q:MessagesQueryDto){return this.chats.messages(id,r.user.id,q.cursor)}
 @Post(':id/messages') send(@Param('id')id:string,@Req()r:any,@Body()d:MessageDto){return this.chats.send(id,r.user.id,d)}
 @Patch('messages/:id') edit(@Param('id')id:string,@Req()r:any,@Body()d:EditDto){return this.chats.edit(id,r.user.id,d.body)}
 @Delete('messages/:id') remove(@Param('id')id:string,@Req()r:any){return this.chats.remove(id,r.user.id)}
 @Post('messages/:id/reactions') react(@Param('id')id:string,@Req()r:any,@Body()d:ReactionDto){return this.chats.react(id,r.user.id,d.emoji)}
}
