import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private activeChatKey(chatId:string,userId:string){return `active-chat:${chatId}:${userId}`}
  private socketsKey(id:string){return`presence-sockets:${id}`}
  async online(id:string,socketId?:string){
    const transaction=this.redis.multi().set(`presence:${id}`,'1','EX',70);
    if(socketId)transaction.sadd(this.socketsKey(id),socketId).expire(this.socketsKey(id),70);
    await transaction.exec();
  }
  async offline(id:string,socketId?:string){
    if(socketId)await this.redis.srem(this.socketsKey(id),socketId);
    const remaining=socketId?await this.redis.scard(this.socketsKey(id)):0;
    if(remaining>0){await this.redis.expire(this.socketsKey(id),70);return true}
    await this.redis.del(`presence:${id}`,this.socketsKey(id));return false;
  }
  async heartbeat(id:string,socketId?:string,chatId?:string){
    await this.online(id,socketId);
    if(socketId&&chatId){const key=this.activeChatKey(chatId,id);await this.redis.multi().sadd(key,socketId).expire(key,70).exec()}
  }
  async openChat(userId:string,socketId:string,chatId:string,previousChatId?:string){
    if(previousChatId&&previousChatId!==chatId)await this.redis.srem(this.activeChatKey(previousChatId,userId),socketId);
    const key=this.activeChatKey(chatId,userId);await this.redis.multi().sadd(key,socketId).expire(key,70).exec();
  }
  async closeChat(userId:string,socketId:string,chatId?:string){if(chatId)await this.redis.srem(this.activeChatKey(chatId,userId),socketId)}
  async isOnline(id:string){return Boolean(await this.redis.exists(`presence:${id}`))}
  async isActiveInChat(userId:string,chatId:string){return (await this.redis.scard(this.activeChatKey(chatId,userId)))>0}
  async ping(){return this.redis.ping()}
  async onModuleDestroy(){await this.redis.quit()}
}
