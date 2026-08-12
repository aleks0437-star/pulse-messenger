import { Injectable } from '@nestjs/common';
import { Namespace } from 'socket.io';
import { PresenceService } from './presence';

@Injectable()
export class ChatRealtimeService {
  private namespace?:Namespace;
  constructor(private presence:PresenceService){}
  attach(namespace:Namespace){this.namespace=namespace}
  broadcastMessage(chatId:string,message:unknown){this.namespace?.to(`chat:${chatId}`).emit('message:new',message)}
  reactionUpdated(chatId:string,messageId:string,reactions:unknown){this.namespace?.to(`chat:${chatId}`).emit('message:reaction',{chatId,messageId,reactions})}
  messageEdited(chatId:string,message:unknown){this.namespace?.to(`chat:${chatId}`).emit('message:edited',{chatId,message})}
  messageDeleted(chatId:string,message:unknown){this.namespace?.to(`chat:${chatId}`).emit('message:deleted',{chatId,message})}
  memberUpdated(chatId:string,member:unknown){this.namespace?.to(`chat:${chatId}`).emit('chat:member-updated',{chatId,member})}
  chatUpdated(chatId:string,chat:unknown){this.namespace?.to(`chat:${chatId}`).emit('chat:updated',{chatId,chat})}
  async chatCreated(userIds:string[],chatId:string,chat:unknown){
    if(!this.namespace)return;
    await Promise.all(userIds.map(async userId=>{
      const sockets=await this.namespace!.in(`user:${userId}`).fetchSockets();
      await Promise.all(sockets.map(socket=>socket.join(`chat:${chatId}`)));
      this.namespace!.to(`user:${userId}`).emit('chat:created',chat);
    }));
  }
  memberRemoved(chatId:string,userId:string){this.namespace?.to(`chat:${chatId}`).emit('chat:member-removed',{chatId,userId})}
  async evict(chatId:string,userId:string){
    if(!this.namespace)return;
    const sockets=await this.namespace.in(`user:${userId}`).fetchSockets();
    await Promise.all(sockets.map(async socket=>{
      await this.presence.closeChat(userId,socket.id,chatId);
      await socket.leave(`chat:${chatId}`);
    }));
    this.namespace.to(`user:${userId}`).emit('chat:kicked',{chatId});
  }
}
