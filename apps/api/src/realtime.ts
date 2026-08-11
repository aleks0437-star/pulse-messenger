import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { IsString, MaxLength } from 'class-validator';
import { Namespace, Socket } from 'socket.io';
import { ChatsService, MessageDto } from './chats';
import { ChatRealtimeService } from './chat-realtime';
import { PresenceService } from './presence';
import { PrismaService } from './prisma.service';
import { getAllowedOrigins } from './security';

class ChatEventDto { @IsString() @MaxLength(64) chatId!: string; }
class SocketMessageDto extends MessageDto { @IsString() @MaxLength(64) chatId!: string; }

@WebSocketGateway({ namespace:'chat', cors:{origin:getAllowedOrigins(),credentials:true} })
export class ChatGateway implements OnGatewayInit,OnGatewayConnection,OnGatewayDisconnect {
  @WebSocketServer() server!:Namespace;
  constructor(private jwt:JwtService,private presence:PresenceService,private chats:ChatsService,private db:PrismaService,private realtime:ChatRealtimeService){}
  afterInit(server:Namespace){
    this.realtime.attach(server);
    server.use((socket,next)=>{
      this.authenticate(socket).then(()=>next()).catch(()=>next(new Error('unauthorized')));
    });
  }
  private async authenticate(socket:Socket){
    const raw=socket.handshake.auth.token??socket.handshake.headers.authorization?.replace('Bearer ','');
    if(typeof raw!=='string')throw new Error('missing token');
    const payload=this.jwt.verify<{sub:string;username:string;type:string}>(raw);
    if(payload.type!=='access'||!await this.db.user.findUnique({where:{id:payload.sub},select:{id:true}}))throw new Error('invalid token');
    socket.data.user={id:payload.sub,username:payload.username};
  }
  async handleConnection(socket:Socket){
    const user=socket.data.user;
    if(!user){socket.disconnect(true);return}
    await this.presence.online(user.id);await socket.join(`user:${user.id}`);socket.broadcast.emit('presence:update',{userId:user.id,online:true});
  }
  async handleDisconnect(socket:Socket){if(socket.data.user){await this.presence.closeChat(socket.data.user.id,socket.id,socket.data.activeChatId);await this.presence.offline(socket.data.user.id);socket.broadcast.emit('presence:update',{userId:socket.data.user.id,online:false})}}
  @SubscribeMessage('presence:heartbeat') heartbeat(@ConnectedSocket()s:Socket){return this.presence.heartbeat(s.data.user.id,s.id,s.data.activeChatId)}
  @SubscribeMessage('chat:join') async join(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);await this.presence.openChat(s.data.user.id,s.id,d.chatId,s.data.activeChatId);s.data.activeChatId=d.chatId;await s.join(`chat:${d.chatId}`);return{ok:true}}
  @SubscribeMessage('chat:leave') async leave(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){if(s.data.activeChatId===d.chatId){await this.presence.closeChat(s.data.user.id,s.id,d.chatId);s.data.activeChatId=undefined;await s.leave(`chat:${d.chatId}`)}return{ok:true}}
  @SubscribeMessage('message:send') async send(@ConnectedSocket()s:Socket,@MessageBody()d:SocketMessageDto){const m=await this.chats.send(d.chatId,s.data.user.id,d);this.realtime.broadcastMessage(d.chatId,m);return m}
  @SubscribeMessage('typing:start') async typingStart(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);s.to(`chat:${d.chatId}`).emit('typing:update',{chatId:d.chatId,userId:s.data.user.id,typing:true})}
  @SubscribeMessage('typing:stop') async typingStop(@ConnectedSocket()s:Socket,@MessageBody()d:ChatEventDto){await this.chats.assertMember(d.chatId,s.data.user.id);s.to(`chat:${d.chatId}`).emit('typing:update',{chatId:d.chatId,userId:s.data.user.id,typing:false})}
}
