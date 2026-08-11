import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatType, MemberRole } from '@prisma/client';
import { InvitesService } from '../src/invites';

function harness(){
  const db:any={
    chat:{findUnique:jest.fn().mockResolvedValue({id:'chat-1',type:ChatType.GROUP})},
    chatMember:{findUnique:jest.fn(),create:jest.fn(),delete:jest.fn(),update:jest.fn()},
    chatInvite:{findUnique:jest.fn(),findMany:jest.fn(),create:jest.fn(),updateMany:jest.fn()},
    user:{findUnique:jest.fn()},message:{create:jest.fn()},
  };
  db.$transaction=jest.fn((operation:any)=>operation(db));
  const realtime:any={broadcastMessage:jest.fn(),memberUpdated:jest.fn(),memberRemoved:jest.fn(),evict:jest.fn()};
  const config:any={get:jest.fn().mockReturnValue('http://localhost:3000')};
  return{db,realtime,service:new InvitesService(db,realtime,config as ConfigService)};
}
function invite(overrides:any={}){return{id:'invite-1',chatId:'chat-1',code:'abcdefghijklmnopqrstuvwx',createdById:'owner',expiresAt:null,maxUses:null,usesCount:0,revokedAt:null,createdAt:new Date(),chat:{id:'chat-1',type:ChatType.GROUP,title:'Команда',avatarUrl:null,_count:{members:2}},...overrides}}

describe('InvitesService',()=>{
  it('joins a valid group invite as MEMBER and is idempotent for an existing member',async()=>{
    const{db,realtime,service}=harness();db.chatInvite.findUnique.mockResolvedValue(invite());db.chatMember.findUnique.mockResolvedValueOnce(null);db.chatMember.create.mockResolvedValue({chatId:'chat-1',userId:'eve',role:'MEMBER',user:{id:'eve',displayName:'Ева'}});db.chatInvite.updateMany.mockResolvedValue({count:1});db.user.findUnique.mockResolvedValue({displayName:'Ева'});db.message.create.mockResolvedValue({id:'system-1',chatId:'chat-1',kind:'SYSTEM',body:'Ева присоединился(-ась) по приглашению'});db.chat.findUnique.mockResolvedValue({id:'chat-1',type:'GROUP',members:[{userId:'eve',role:'MEMBER'}]});
    await expect(service.join('abcdefghijklmnopqrstuvwx','eve')).resolves.toMatchObject({id:'chat-1'});
    expect(db.chatMember.create).toHaveBeenCalledWith(expect.objectContaining({data:{chatId:'chat-1',userId:'eve',role:MemberRole.MEMBER}}));expect(realtime.broadcastMessage).toHaveBeenCalled();
    db.chatMember.findUnique.mockResolvedValue({chatId:'chat-1',userId:'eve',role:'MEMBER'});db.chatInvite.updateMany.mockClear();
    await service.join('abcdefghijklmnopqrstuvwx','eve');expect(db.chatInvite.updateMany).not.toHaveBeenCalled();
  });
  it('returns the chat to an existing member even when that invite has reached its limit',async()=>{
    const{db,service}=harness();db.chatInvite.findUnique.mockResolvedValue(invite({maxUses:1,usesCount:1}));db.chatMember.findUnique.mockResolvedValue({chatId:'chat-1',userId:'eve',role:'MEMBER'});db.chat.findUnique.mockResolvedValue({id:'chat-1',members:[]});
    await expect(service.join('abcdefghijklmnopqrstuvwx','eve')).resolves.toMatchObject({id:'chat-1'});expect(db.chatInvite.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    ['missing',null,NotFoundException],
    ['expired',invite({expiresAt:new Date(Date.now()-1000)}),GoneException],
    ['exhausted',invite({maxUses:1,usesCount:1}),GoneException],
    ['revoked',invite({revokedAt:new Date()}),GoneException],
  ])('rejects a %s invite',async(_label,value,error)=>{const{db,service}=harness();db.chatInvite.findUnique.mockResolvedValue(value);await expect(service.join('abcdefghijklmnopqrstuvwx','eve')).rejects.toBeInstanceOf(error)});
  it('returns 403 for non-admin invite and moderation attempts',async()=>{
    const{db,service}=harness();db.chatMember.findUnique.mockResolvedValue({userId:'member',role:MemberRole.MEMBER,user:{displayName:'Макс'}});db.chatInvite.findMany.mockResolvedValue([]);
    await expect(service.getOrCreate('chat-1','member',{})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.kick('chat-1','member','target')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.mute('chat-1','member','target',{muted:true})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.role('chat-1','member','target','ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('kicks a regular member, broadcasts a system message and evicts active sockets',async()=>{
    const{db,realtime,service}=harness();db.chatMember.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.chatId_userId.userId==='owner'?{userId:'owner',role:MemberRole.OWNER,user:{displayName:'Анна'}}:{userId:'target',role:MemberRole.MEMBER,user:{displayName:'Ева'}}));db.chatMember.delete.mockResolvedValue({});db.message.create.mockResolvedValue({id:'system-kick',chatId:'chat-1',kind:'SYSTEM'});
    await expect(service.kick('chat-1','owner','target')).resolves.toEqual({ok:true});
    expect(realtime.evict).toHaveBeenCalledWith('chat-1','target');expect(realtime.broadcastMessage).toHaveBeenCalledWith('chat-1',expect.objectContaining({kind:'SYSTEM'}));
  });
  it('does not allow an admin to kick another admin',async()=>{
    const{db,service}=harness();db.chatMember.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.chatId_userId.userId==='owner'?{userId:'owner',role:MemberRole.OWNER,user:{displayName:'Анна'}}:{userId:'admin',role:MemberRole.ADMIN,user:{displayName:'Макс'}}));
    await expect(service.kick('chat-1','owner','admin')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('promotes a member and broadcasts the server-created system message',async()=>{
    const{db,realtime,service}=harness();db.chatMember.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.chatId_userId.userId==='owner'?{userId:'owner',role:MemberRole.OWNER,user:{displayName:'Анна'}}:{userId:'target',role:MemberRole.MEMBER,user:{displayName:'Ева'}}));db.chatMember.update.mockResolvedValue({userId:'target',role:MemberRole.ADMIN,user:{id:'target',displayName:'Ева'}});db.message.create.mockResolvedValue({id:'system-role',chatId:'chat-1',kind:'SYSTEM',body:'Анна назначил(а) Ева администратором'});
    await expect(service.role('chat-1','owner','target','ADMIN')).resolves.toMatchObject({role:MemberRole.ADMIN});expect(realtime.memberUpdated).toHaveBeenCalled();expect(realtime.broadcastMessage).toHaveBeenCalledWith('chat-1',expect.objectContaining({kind:'SYSTEM'}));
  });
  it('mutes a regular member indefinitely and publishes the updated membership',async()=>{
    const{db,realtime,service}=harness();db.chatMember.findUnique.mockImplementation(({where}:any)=>Promise.resolve(where.chatId_userId.userId==='owner'?{userId:'owner',role:MemberRole.OWNER,user:{displayName:'Анна'}}:{userId:'target',role:MemberRole.MEMBER,user:{displayName:'Ева'}}));db.chatMember.update.mockResolvedValue({userId:'target',role:MemberRole.MEMBER,isMuted:true,mutedUntil:null,user:{id:'target',displayName:'Ева'}});
    await expect(service.mute('chat-1','owner','target',{muted:true})).resolves.toMatchObject({isMuted:true,mutedUntil:null});expect(realtime.memberUpdated).toHaveBeenCalled();
  });
});
