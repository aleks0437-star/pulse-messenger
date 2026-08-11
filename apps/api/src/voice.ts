import { Body, Controller, Injectable, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AccessToken } from 'livekit-server-sdk';
import { JwtAuthGuard } from './auth';
import { ChatsService } from './chats';
import { PrismaService } from './prisma.service';

class VoiceTokenDto { @IsOptional() @IsString() @MaxLength(80) displayName?: string; }
@Injectable()
export class VoiceService {
  constructor(private db:PrismaService,private chats:ChatsService,private config:ConfigService){}
  async token(chatId:string,userId:string,name:string){await this.chats.assertMember(chatId,userId);let room=await this.db.voiceRoom.findFirst({where:{chatId,endedAt:null}});if(!room)room=await this.db.voiceRoom.create({data:{chatId,livekitRoomName:`chat-${chatId}-${Date.now()}`}});const at=new AccessToken(this.config.getOrThrow('LIVEKIT_API_KEY'),this.config.getOrThrow('LIVEKIT_API_SECRET'),{identity:userId,name});at.addGrant({roomJoin:true,room:room.livekitRoomName,canPublish:true,canSubscribe:true});await this.db.voiceRoomParticipant.create({data:{roomId:room.id,userId}});return{token:await at.toJwt(),roomName:room.livekitRoomName,url:this.config.getOrThrow('NEXT_PUBLIC_LIVEKIT_URL')};}
  async leave(chatId:string,userId:string){await this.chats.assertMember(chatId,userId);const room=await this.db.voiceRoom.findFirst({where:{chatId,endedAt:null},orderBy:{startedAt:'desc'}});if(room)await this.db.voiceRoomParticipant.updateMany({where:{roomId:room.id,userId,state:'JOINED'},data:{state:'LEFT',leftAt:new Date()}});return{ok:true}}
}
@Controller('voice') @UseGuards(JwtAuthGuard)
export class VoiceController{constructor(private voice:VoiceService){} @Post(':chatId/token') token(@Param('chatId')id:string,@Req()r:any,@Body()b:VoiceTokenDto){return this.voice.token(id,r.user.id,b.displayName??r.user.username)} @Post(':chatId/leave') leave(@Param('chatId')id:string,@Req()r:any){return this.voice.leave(id,r.user.id)}}
