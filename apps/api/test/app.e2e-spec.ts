import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { hardenHttpApp } from '../src/main';
import { PrismaService } from '../src/prisma.service';
import { PresenceService } from '../src/presence';
import { PushService } from '../src/push';

class MemoryPrisma {
  users: any[]=[]; chats:any[]=[]; members:any[]=[]; messages:any[]=[]; reactions:any[]=[]; tokens:any[]=[]; seq=0;
  user={
    create:async({data}:any)=>{const value={id:`u${++this.seq}`,avatarUrl:null,bio:null,createdAt:new Date(),updatedAt:new Date(),...data};this.users.push(value);return value},
    findFirst:async({where}:any)=>this.users.find(user=>where.OR.some((item:any)=>(item.email&&user.email===item.email)||(item.username&&user.username===item.username)))??null,
    findUnique:async({where,select}:any)=>{const user=this.users.find(item=>item.id===where.id)??null;if(!user||!select)return user;return Object.fromEntries(Object.keys(select).filter(key=>select[key]).map(key=>[key,user[key]]))},
    update:async({where,data}:any)=>Object.assign(this.users.find(item=>item.id===where.id),data),
  };
  refreshToken={
    create:async({data}:any)=>{this.tokens.push({...data,createdAt:new Date(),revokedAt:null,replacedById:null});return data},
    findUnique:async({where,include}:any)=>{const token=this.tokens.find(item=>item.tokenHash===where.tokenHash)??null;return token&&include?.user?{...token,user:this.users.find(user=>user.id===token.userId)}:token},
    update:async({where,data}:any)=>Object.assign(this.tokens.find(item=>item.id===where.id),data),
    updateMany:async({where,data}:any)=>{const found=this.tokens.filter(item=>(where.id===undefined||item.id===where.id)&&(where.tokenHash===undefined||item.tokenHash===where.tokenHash)&&(where.revokedAt===undefined||item.revokedAt===where.revokedAt));found.forEach(item=>Object.assign(item,data));return{count:found.length}},
  };
  chat={
    create:async({data}:any)=>{const chat={id:`c${++this.seq}`,createdAt:new Date(),updatedAt:new Date(),avatarUrl:null,...data,members:undefined};this.chats.push(chat);for(const member of data.members.create)this.members.push({chatId:chat.id,...member});return{...chat,members:this.members.filter(m=>m.chatId===chat.id).map(m=>({...m,user:this.safeUser(this.users.find(u=>u.id===m.userId))}))}},
    findMany:async({where}:any)=>this.chats.filter(chat=>this.members.some(member=>member.chatId===chat.id&&member.userId===where.members.some.userId)).map(chat=>({...chat,members:this.members.filter(m=>m.chatId===chat.id).map(m=>({...m,user:this.safeUser(this.users.find(u=>u.id===m.userId))})),messages:this.messages.filter(m=>m.chatId===chat.id&&!m.deletedAt).slice(-1)})),
    update:async({where,data}:any)=>Object.assign(this.chats.find(item=>item.id===where.id),data),
  };
  chatMember={findUnique:async({where}:any)=>this.members.find(member=>member.chatId===where.chatId_userId.chatId&&member.userId===where.chatId_userId.userId)??null};
  message={
    create:async({data}:any)=>{const value={id:`m${++this.seq}`,createdAt:new Date(),editedAt:null,deletedAt:null,...data};this.messages.push(value);return this.messageView(value)},
    findMany:async({where}:any)=>this.messages.filter(item=>item.chatId===where.chatId).map(item=>this.messageView(item)).reverse(),
    findUnique:async({where,select}:any)=>{const value=this.messages.find(item=>item.id===where.id)??null;if(!value||!select)return value;return Object.fromEntries(Object.keys(select).filter(key=>select[key]).map(key=>[key,value[key]]))},
    update:async({where,data}:any)=>Object.assign(this.messages.find(item=>item.id===where.id),data),
  };
  messageReaction={
    findUnique:async({where}:any)=>this.reactions.find(item=>item.messageId===where.messageId_userId_emoji.messageId&&item.userId===where.messageId_userId_emoji.userId&&item.emoji===where.messageId_userId_emoji.emoji)??null,
    create:async({data}:any)=>{this.reactions.push(data);return data},
    delete:async({where}:any)=>{const key=where.messageId_userId_emoji;const index=this.reactions.findIndex(item=>item.messageId===key.messageId&&item.userId===key.userId&&item.emoji===key.emoji);return this.reactions.splice(index,1)[0]},
  };
  voiceRoom={findFirst:jest.fn(),create:jest.fn()}; voiceRoomParticipant={create:jest.fn(),updateMany:jest.fn()};
  $transaction=(operation:any)=>typeof operation==='function'?operation(this):Promise.all(operation);
  $queryRaw=async()=>[{one:1}];
  safeUser(user:any){if(!user)return null;const{passwordHash,...safe}=user;return safe}
  messageView(value:any){return{...value,author:this.safeUser(this.users.find(user=>user.id===value.authorId)),reactions:this.reactions.filter(item=>item.messageId===value.id),replyTo:value.replyToId?this.messages.find(item=>item.id===value.replyToId):null}}
}

describe('Pulse API e2e',()=>{
  let app:INestApplication;let base:string;let db:MemoryPrisma;let alice:any;let bob:any;let eve:any;let chatId:string;
  beforeAll(async()=>{
    db=new MemoryPrisma();
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).overrideProvider(PresenceService).useValue({online:jest.fn(),offline:jest.fn(),heartbeat:jest.fn(),openChat:jest.fn(),closeChat:jest.fn(),isOnline:jest.fn(),isActiveInChat:jest.fn(),ping:jest.fn().mockResolvedValue('PONG')}).overrideProvider(PushService).useValue({notifyNewMessage:jest.fn()}).compile();
    app=module.createNestApplication();hardenHttpApp(app);await app.listen(0);base=await app.getUrl();
  });
  afterAll(async()=>app.close());

  it('registers, rotates/revokes refresh, creates a chat and exchanges HTTP/Socket messages',async()=>{
    const register=async(email:string,username:string)=>request(app.getHttpServer()).post('/api/auth/register').send({email,username,displayName:username,password:'Secure12345'}).expect(201);
    alice=(await register('alice@example.com','alice')).body;bob=(await register('bob@example.com','bob')).body;eve=(await register('eve@example.com','eve')).body;
    expect(JSON.stringify(alice)).not.toContain('passwordHash');expect(JSON.stringify(alice)).not.toContain('Secure12345');
    expect((await request(app.getHttpServer()).get('/api/health').expect(200)).headers['x-content-type-options']).toBe('nosniff');
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization',`Bearer ${alice.refreshToken}`).expect(401);
    const rotated=await request(app.getHttpServer()).post('/api/auth/refresh').send({refreshToken:alice.refreshToken}).expect(200);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({refreshToken:alice.refreshToken}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/logout').send({refreshToken:rotated.body.refreshToken}).expect(200);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({refreshToken:rotated.body.refreshToken}).expect(401);
    const login=await request(app.getHttpServer()).post('/api/auth/login').send({login:'alice',password:'Secure12345'}).expect(200);alice=login.body;
    const chat=await request(app.getHttpServer()).post('/api/chats').set('Authorization',`Bearer ${alice.accessToken}`).send({type:'GROUP',title:'Test',memberIds:[bob.user.id]}).expect(201);chatId=chat.body.id;
    expect(JSON.stringify(chat.body)).not.toContain('passwordHash');
    await request(app.getHttpServer()).post(`/api/chats/${chatId}/messages`).set('Authorization',`Bearer ${alice.accessToken}`).send({body:'HTTP message'}).expect(201);
    const socket:Socket=io(`${base}/chat`,{auth:{token:alice.accessToken},transports:['websocket'],forceNew:true});
    await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject)});
    await new Promise<void>((resolve,reject)=>socket.timeout(5000).emit('chat:join',{chatId},(error:any)=>error?reject(error):resolve()));
    const realtime=new Promise<any>(resolve=>socket.once('message:new',resolve));
    const ack=await new Promise<any>((resolve,reject)=>socket.timeout(5000).emit('message:send',{chatId,body:'Socket message'},(error:any,message:any)=>error?reject(error):resolve(message)));
    expect(ack.body).toBe('Socket message');expect((await realtime).body).toBe('Socket message');socket.disconnect();
    const messages=await request(app.getHttpServer()).get(`/api/chats/${chatId}/messages`).set('Authorization',`Bearer ${bob.accessToken}`).expect(200);
    expect(messages.body.map((item:any)=>item.body)).toEqual(expect.arrayContaining(['HTTP message','Socket message']));
  },30000);

  it('returns 403 when an outsider reads a foreign chat',async()=>{await request(app.getHttpServer()).get(`/api/chats/${chatId}/messages`).set('Authorization',`Bearer ${eve.accessToken}`).expect(403)});

  it('returns 429 after five login attempts for one IP+identity',async()=>{
    for(let attempt=0;attempt<5;attempt++)await request(app.getHttpServer()).post('/api/auth/login').send({login:'bruteforce@example.com',password:'wrong'}).expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({login:'bruteforce@example.com',password:'wrong'}).expect(429);
  });

  it('rejects non-whitelisted input fields',async()=>{await request(app.getHttpServer()).post('/api/auth/register').send({email:'strict@example.com',username:'strict',displayName:'Strict',password:'Secure12345',admin:true}).expect(400)});
});
