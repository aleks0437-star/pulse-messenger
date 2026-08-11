import { Body, Controller, Get, Headers, Injectable, Logger, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';
import * as webPush from 'web-push';
import { JwtAuthGuard } from './auth';
import { PresenceService } from './presence';
import { PrismaService } from './prisma.service';

class PushKeysDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,512}$/) p256dh!:string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,128}$/) auth!:string;
}
export class SubscribePushDto {
  @IsUrl({protocols:['https'],require_protocol:true}) @MaxLength(2048) endpoint!:string;
  @ValidateNested() @Type(()=>PushKeysDto) keys!:PushKeysDto;
  @IsOptional() @IsString() @MaxLength(512) userAgent?:string;
  @IsOptional() @IsString() @MaxLength(120) deviceLabel?:string;
}
export class UnsubscribePushDto { @IsUrl({protocols:['https'],require_protocol:true}) @MaxLength(2048) endpoint!:string; }
export class PushSettingsDto { @IsBoolean() hidePushPreview!:boolean; }

type PushMessage={id:string;chatId:string;authorId:string;body:string;mediaUrl?:string|null;mediaType?:string|null;author:{displayName:string;avatarUrl?:string|null}};

@Injectable()
export class PushService {
  private readonly logger=new Logger(PushService.name);
  private readonly enabled:boolean;
  constructor(private db:PrismaService,private presence:PresenceService,config:ConfigService){
    const subject=config.get<string>('VAPID_SUBJECT');const publicKey=config.get<string>('VAPID_PUBLIC_KEY');const privateKey=config.get<string>('VAPID_PRIVATE_KEY');
    this.enabled=Boolean(subject&&publicKey&&privateKey);
    if(this.enabled)webPush.setVapidDetails(subject!,publicKey!,privateKey!);
  }
  async subscribe(userId:string,dto:SubscribePushDto,userAgent?:string){
    await this.db.pushSubscription.upsert({where:{endpoint:dto.endpoint},create:{userId,endpoint:dto.endpoint,p256dh:dto.keys.p256dh,auth:dto.keys.auth,userAgent:dto.userAgent??userAgent,deviceLabel:dto.deviceLabel},update:{userId,p256dh:dto.keys.p256dh,auth:dto.keys.auth,userAgent:dto.userAgent??userAgent,deviceLabel:dto.deviceLabel}});
    return{ok:true};
  }
  async unsubscribe(userId:string,endpoint:string){await this.db.pushSubscription.deleteMany({where:{userId,endpoint}});return{ok:true}}
  async settings(userId:string){const user=await this.db.user.findUnique({where:{id:userId},select:{hidePushPreview:true}});return{hidePushPreview:user?.hidePushPreview??false}}
  async updateSettings(userId:string,hidePushPreview:boolean){return this.db.user.update({where:{id:userId},data:{hidePushPreview},select:{hidePushPreview:true}})}
  private preview(message:PushMessage){const text=message.body.trim().replace(/\s+/g,' ');if(text)return text.length>120?`${text.slice(0,117)}…`:text;return message.mediaType?.startsWith('image/')?'📷 Фото':'📎 Файл'}
  private async deliver(subscription:{id:string;endpoint:string;p256dh:string;auth:string},payload:string,chatId:string){
    try{await webPush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},payload,{TTL:86400,urgency:'normal',topic:`chat-${chatId}`.slice(0,32),timeout:5000})}
    catch(error){const status=(error as Partial<webPush.WebPushError>).statusCode;if(status===404||status===410){await this.db.pushSubscription.delete({where:{id:subscription.id}});return}this.logger.warn(`Push delivery failed for subscription ${subscription.id}${status?` with status ${status}`:''}`)}
  }
  async notifyNewMessage(message:PushMessage){
    if(!this.enabled)return;
    try{
      const chat=await this.db.chat.findUnique({where:{id:message.chatId},select:{type:true,title:true,members:{select:{user:{select:{id:true,hidePushPreview:true,pushSubscriptions:{select:{id:true,endpoint:true,p256dh:true,auth:true}}}}}}}});
      if(!chat)return;
      const preview=this.preview(message);
      await Promise.all(chat.members.filter(member=>member.user.id!==message.authorId).map(async member=>{
        if(await this.presence.isActiveInChat(member.user.id,message.chatId))return;
        const payload=JSON.stringify({title:chat.type==='GROUP'?`${message.author.displayName} · ${chat.title??'Группа'}`:message.author.displayName,body:member.user.hidePushPreview?`Новое сообщение от ${message.author.displayName}`:preview,icon:message.author.avatarUrl??'/icon.svg',chatId:message.chatId,url:`/?chatId=${encodeURIComponent(message.chatId)}`});
        await Promise.all(member.user.pushSubscriptions.map(subscription=>this.deliver(subscription,payload,message.chatId)));
      }));
    }catch(error){this.logger.error('Push notification fanout failed',error instanceof Error?error.stack:undefined)}
  }
}

@Controller('push') @UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push:PushService){}
  @Post('subscribe') subscribe(@Req()req:any,@Body()dto:SubscribePushDto,@Headers('user-agent')userAgent?:string){return this.push.subscribe(req.user.id,dto,userAgent)}
  @Post('unsubscribe') unsubscribe(@Req()req:any,@Body()dto:UnsubscribePushDto){return this.push.unsubscribe(req.user.id,dto.endpoint)}
  @Get('settings') settings(@Req()req:any){return this.push.settings(req.user.id)}
  @Patch('settings') updateSettings(@Req()req:any,@Body()dto:PushSettingsDto){return this.push.updateSettings(req.user.id,dto.hidePushPreview)}
}
