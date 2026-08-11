import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, GoneException, Injectable, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ChatType, MemberRole, MessageKind } from '@prisma/client';
import { randomBytes } from 'crypto';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from './auth';
import { ChatRealtimeService } from './chat-realtime';
import { PrismaService } from './prisma.service';

export class InviteOptionsDto {
  @IsOptional() @IsInt() @Min(1) @Max(10_000) maxUses?:number;
  @IsOptional() @IsInt() @Min(1) @Max(8_760) expiresInHours?:number;
}
export class MuteMemberDto {
  @IsBoolean() muted!:boolean;
  @IsOptional() @IsInt() @Min(1) @Max(525_600) durationMinutes?:number;
}
export class MemberRoleDto { @IsIn([MemberRole.ADMIN,MemberRole.MEMBER]) role!:'ADMIN'|'MEMBER'; }

const memberUser={select:{id:true,username:true,displayName:true,avatarUrl:true}} as const;

@Injectable()
export class InvitesService {
  private readonly appUrl:string;
  constructor(private db:PrismaService,private realtime:ChatRealtimeService,config:ConfigService){
    this.appUrl=(config.get<string>('WEB_APP_URL')??'http://localhost:3000').replace(/\/$/,'');
  }
  private code(){return randomBytes(18).toString('base64url')}
  private isActive(invite:{revokedAt:Date|null;expiresAt:Date|null;maxUses:number|null;usesCount:number},now=new Date()){
    return !invite.revokedAt&&(!invite.expiresAt||invite.expiresAt>now)&&(invite.maxUses===null||invite.usesCount<invite.maxUses);
  }
  private response(invite:any){return{...invite,url:`${this.appUrl}/invite/${invite.code}`}}
  private async assertAdmin(chatId:string,userId:string){
    const [chat,member]=await Promise.all([
      this.db.chat.findUnique({where:{id:chatId},select:{id:true,type:true}}),
      this.db.chatMember.findUnique({where:{chatId_userId:{chatId,userId}}}),
    ]);
    if(!chat)throw new NotFoundException('Чат не найден');
    if(chat.type!==ChatType.GROUP)throw new BadRequestException('Инвайт-ссылки доступны только для групп');
    if(!member||!([MemberRole.OWNER,MemberRole.ADMIN] as MemberRole[]).includes(member.role))throw new ForbiddenException('Требуются права администратора');
    return member;
  }
  private expiry(hours?:number){return hours?new Date(Date.now()+hours*3_600_000):null}
  async current(chatId:string,userId:string){
    await this.assertAdmin(chatId,userId);
    const invites=await this.db.chatInvite.findMany({where:{chatId,revokedAt:null},orderBy:{createdAt:'desc'}});
    const active=invites.find(invite=>this.isActive(invite));
    return active?this.response(active):null;
  }
  async getOrCreate(chatId:string,userId:string,dto:InviteOptionsDto){
    const active=await this.current(chatId,userId);if(active)return active;
    const invite=await this.db.chatInvite.create({data:{chatId,createdById:userId,code:this.code(),maxUses:dto.maxUses,expiresAt:this.expiry(dto.expiresInHours)}});
    return this.response(invite);
  }
  async rotate(chatId:string,userId:string,dto:InviteOptionsDto){
    await this.assertAdmin(chatId,userId);
    const invite=await this.db.$transaction(async transaction=>{
      await transaction.chatInvite.updateMany({where:{chatId,revokedAt:null},data:{revokedAt:new Date()}});
      return transaction.chatInvite.create({data:{chatId,createdById:userId,code:this.code(),maxUses:dto.maxUses,expiresAt:this.expiry(dto.expiresInHours)}});
    });
    return this.response(invite);
  }
  async revoke(chatId:string,userId:string){
    await this.assertAdmin(chatId,userId);
    await this.db.chatInvite.updateMany({where:{chatId,revokedAt:null},data:{revokedAt:new Date()}});
    return{ok:true};
  }
  private async checked(code:string,allowExhausted=false){
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(code))throw new NotFoundException('Приглашение не найдено');
    const invite=await this.db.chatInvite.findUnique({where:{code},include:{chat:{select:{id:true,type:true,title:true,avatarUrl:true,_count:{select:{members:true}}}}}});
    if(!invite||invite.chat.type!==ChatType.GROUP)throw new NotFoundException('Приглашение не найдено');
    if(invite.revokedAt)throw new GoneException('Приглашение отозвано');
    if(invite.expiresAt&&invite.expiresAt<=new Date())throw new GoneException('Срок действия приглашения истёк');
    if(!allowExhausted&&invite.maxUses!==null&&invite.usesCount>=invite.maxUses)throw new GoneException('Лимит использований приглашения исчерпан');
    return invite;
  }
  async preview(code:string){const invite=await this.checked(code);return{title:invite.chat.title??'Группа Pulse',avatarUrl:invite.chat.avatarUrl,memberCount:invite.chat._count.members}}
  async join(code:string,userId:string){
    const invite=await this.checked(code,true);
    const existing=await this.db.chatMember.findUnique({where:{chatId_userId:{chatId:invite.chatId,userId}}});
    if(existing)return this.chatState(invite.chatId);
    if(invite.maxUses!==null&&invite.usesCount>=invite.maxUses)throw new GoneException('Лимит использований приглашения исчерпан');
    const result=await this.db.$transaction(async transaction=>{
      const claimed=await transaction.chatInvite.updateMany({where:{id:invite.id,revokedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}],...(invite.maxUses===null?{}:{usesCount:{lt:invite.maxUses}})},data:{usesCount:{increment:1}}});
      if(claimed.count!==1)throw new GoneException('Приглашение больше не действует');
      const user=await transaction.user.findUnique({where:{id:userId},select:{displayName:true}});
      if(!user)throw new NotFoundException('Пользователь не найден');
      const member=await transaction.chatMember.create({data:{chatId:invite.chatId,userId,role:MemberRole.MEMBER},include:{user:memberUser}});
      const message=await transaction.message.create({data:{chatId:invite.chatId,authorId:userId,kind:MessageKind.SYSTEM,body:`${user.displayName} присоединился(-ась) по приглашению`},include:{author:memberUser,reactions:true,replyTo:true}});
      return{chat:await this.chatState(invite.chatId,transaction),member,message};
    });
    this.realtime.memberUpdated(invite.chatId,result.member);
    this.realtime.broadcastMessage(invite.chatId,result.message);
    return result.chat;
  }
  private chatState(chatId:string,db:any=this.db){return db.chat.findUnique({where:{id:chatId},include:{members:{include:{user:memberUser}}}})}
  private async moderation(chatId:string,actorId:string,targetId:string){
    const [chat,actor,target]=await Promise.all([
      this.db.chat.findUnique({where:{id:chatId},select:{id:true,type:true}}),
      this.db.chatMember.findUnique({where:{chatId_userId:{chatId,userId:actorId}},include:{user:memberUser}}),
      this.db.chatMember.findUnique({where:{chatId_userId:{chatId,userId:targetId}},include:{user:memberUser}}),
    ]);
    if(!chat||chat.type!==ChatType.GROUP)throw new NotFoundException('Группа не найдена');
    if(!actor||!([MemberRole.OWNER,MemberRole.ADMIN] as MemberRole[]).includes(actor.role))throw new ForbiddenException('Требуются права администратора');
    if(!target)throw new NotFoundException('Участник не найден');
    return{actor,target};
  }
  async kick(chatId:string,actorId:string,targetId:string){
    const{actor,target}=await this.moderation(chatId,actorId,targetId);
    if(target.role!==MemberRole.MEMBER)throw new ForbiddenException('Администратора нельзя исключить');
    const message=await this.db.$transaction(async transaction=>{
      await transaction.chatMember.delete({where:{chatId_userId:{chatId,userId:targetId}}});
      return transaction.message.create({data:{chatId,authorId:actorId,kind:MessageKind.SYSTEM,body:`${actor.user.displayName} исключил(а) ${target.user.displayName}`},include:{author:memberUser,reactions:true,replyTo:true}});
    });
    await this.realtime.evict(chatId,targetId);this.realtime.memberRemoved(chatId,targetId);this.realtime.broadcastMessage(chatId,message);return{ok:true};
  }
  async mute(chatId:string,actorId:string,targetId:string,dto:MuteMemberDto){
    const{target}=await this.moderation(chatId,actorId,targetId);
    if(target.role!==MemberRole.MEMBER)throw new ForbiddenException('Нельзя ограничить администратора');
    const mutedUntil=dto.muted&&dto.durationMinutes?new Date(Date.now()+dto.durationMinutes*60_000):null;
    const member=await this.db.chatMember.update({where:{chatId_userId:{chatId,userId:targetId}},data:{isMuted:dto.muted,mutedUntil},include:{user:memberUser}});
    this.realtime.memberUpdated(chatId,member);return member;
  }
  async role(chatId:string,actorId:string,targetId:string,role:'ADMIN'|'MEMBER'){
    const{actor,target}=await this.moderation(chatId,actorId,targetId);
    if(target.role===MemberRole.OWNER)throw new ForbiddenException('Роль владельца нельзя изменить');
    if(target.userId===actorId)throw new ForbiddenException('Нельзя изменить собственную роль');
    if(target.role===role)return target;
    const verb=role===MemberRole.ADMIN?'назначил(а)':'снял(а) права администратора у';
    const result=await this.db.$transaction(async transaction=>{
      const member=await transaction.chatMember.update({where:{chatId_userId:{chatId,userId:targetId}},data:{role},include:{user:memberUser}});
      const message=await transaction.message.create({data:{chatId,authorId:actorId,kind:MessageKind.SYSTEM,body:`${actor.user.displayName} ${verb} ${target.user.displayName}${role===MemberRole.ADMIN?' администратором':''}`},include:{author:memberUser,reactions:true,replyTo:true}});
      return{member,message};
    });
    this.realtime.memberUpdated(chatId,result.member);this.realtime.broadcastMessage(chatId,result.message);return result.member;
  }
}

@Controller('chats/:chatId/invites') @UseGuards(JwtAuthGuard)
export class ChatInvitesController {
  constructor(private invites:InvitesService){}
  @Get() current(@Param('chatId')chatId:string,@Req()req:any){return this.invites.current(chatId,req.user.id)}
  @Post() create(@Param('chatId')chatId:string,@Req()req:any,@Body()dto:InviteOptionsDto){return this.invites.getOrCreate(chatId,req.user.id,dto)}
  @Post('rotate') rotate(@Param('chatId')chatId:string,@Req()req:any,@Body()dto:InviteOptionsDto){return this.invites.rotate(chatId,req.user.id,dto)}
  @Delete() revoke(@Param('chatId')chatId:string,@Req()req:any){return this.invites.revoke(chatId,req.user.id)}
}

@Controller('invites')
export class InvitesController {
  constructor(private invites:InvitesService){}
  @Get(':code') preview(@Param('code')code:string){return this.invites.preview(code)}
  @Post(':code/join') @UseGuards(JwtAuthGuard,ThrottlerGuard) @Throttle({default:{limit:10,ttl:60_000}}) join(@Param('code')code:string,@Req()req:any){return this.invites.join(code,req.user.id)}
}

@Controller('chats/:chatId/members') @UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private invites:InvitesService){}
  @Post(':userId/kick') kick(@Param('chatId')chatId:string,@Param('userId')userId:string,@Req()req:any){return this.invites.kick(chatId,req.user.id,userId)}
  @Patch(':userId/mute') mute(@Param('chatId')chatId:string,@Param('userId')userId:string,@Req()req:any,@Body()dto:MuteMemberDto){return this.invites.mute(chatId,req.user.id,userId,dto)}
  @Patch(':userId/role') role(@Param('chatId')chatId:string,@Param('userId')userId:string,@Req()req:any,@Body()dto:MemberRoleDto){return this.invites.role(chatId,req.user.id,userId,dto.role)}
}
