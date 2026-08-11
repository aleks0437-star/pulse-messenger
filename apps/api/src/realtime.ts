import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { IsString, MaxLength } from 'class-validator';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { ChatsService, MessageDto } from './chats';
import { PrismaService } from './prisma.service';
import { getAllowedOrigins } from './security';

class ChatEventDto { @IsString() @MaxLength(64) chatId!: string; }
class SocketMessageDto extends MessageDto { @IsString() @MaxLength(64) chatId!: string; }

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  async online(id:string){await this.redis.set(`presence:${id}`,'1','EX',70)}
  async offline(id:string){await this.redis.del(`presence:${id}`)}
  async heartbeat(id:string){await this.online(id)}
  async isOnline(id:string){return Boolean(await this.redis.exists(`presence:${id}`))}
  async ping(){return this.redis.ping()}
  async onModuleDestroy(){await this.redis.quit()}
}

@WebSocketGateway({ namespace:'chat', cors:{origin:getAllowedOrigins(),credentials:true} })
export class ChatGateway implements OnGatewayConnection,OnGatewayDisconnect {
  @WebSocketServer() server!:Server;
  constructor(private jwt:JwtService,private presence:PresenceService,private chats:ChatsService,private db:PrismaService){}
  async handleConnection(socket:Socket){
    try{
      const raw=socket.handshake.auth.token??socket.handshake.headers.authorization?.replace('Bearer ','');
      if(typeof raw!=='string')throw new Error('missing token');
      const payload=this.jwt.verify<{sub:string;username:string;type:string}>(raw);
      if(payload.type!=='access'||!await this.db.user.findUnique({where:{id:payload.sub},select:{id:true}}))throw new Error('invalid token');
      socket.data.user={id:payload.sub,username:payload.username};
      await this.presence.online(payload.sub);socket.join(`user:${payload.sub}`);socket.broadcast.emit('presence:update',{userId:payload.sub,online:true});
    }catch{socket.disconnect()}
  }
  async handleDisconnect(socket:Socket){if(socket.data.user){await this.presence.offline(socket.data.user.id);socket.broadcast.emit('presence:update',{userId:socket.data.user.id,online:false})}}
  @SubscribeMessage('presence:heartbeat') heartbeat(@ConnectedSocket()s:Socket){return this.presence.heartbeat(s.data.user.id)}
  @SubscribeMessage('chat:join') async join(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);s.join(`chat:${d.chatId}`);return{ok:true}}
  @SubscribeMessage('message:send') async send(@ConnectedSocket()s:Socket,@MessageBody()d:SocketMessageDto){const m=await this.chats.send(d.chatId,s.data.user.id,d);this.server.to(`chat:${d.chatId}`).emit('message:new',m);return m}
  @SubscribeMessage('typing:start') async typingStart(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);s.to(`chat:${d.chatId}`).emit('typing:update',{chatId:d.chatId,userId:s.data.user.id,typing:true})}
  @SubscribeMessage('typing:stop') async typingStop(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);s.to(`chat:${d.chatId}`).emit('typing:update',{chatId:d.chatId,userId:s.data.user.id,typing:false})}
}
