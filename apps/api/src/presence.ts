import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private activeChatKey(chatId:string,userId:string){return `active-chat:${chatId}:${userId}`}
  async online(id:string){await this.redis.set(`presence:${id}`,'1','EX',70)}
  async offline(id:string){await this.redis.del(`presence:${id}`)}
  async heartbeat(id:string,socketId?:string,chatId?:string){
    await this.online(id);
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
