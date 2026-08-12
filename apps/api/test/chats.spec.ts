import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ChatsService } from '../src/chats';

function harness() {
  const db: any = {
    chatMember: { findUnique: jest.fn(), update: jest.fn() },
    user:{count:jest.fn()},
    chat: { create: jest.fn(), findMany: jest.fn(), findFirst:jest.fn() },
    message: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count:jest.fn() },
    messageReaction: { findUnique: jest.fn(), findMany:jest.fn(), create: jest.fn(), delete: jest.fn() },
  };
  const storage: any = { assertMessageAttachment: jest.fn() };
  const push: any = { notifyNewMessage: jest.fn() };
  const realtime:any={reactionUpdated:jest.fn(),chatCreated:jest.fn(),messageEdited:jest.fn(),messageDeleted:jest.fn()};
  const presence:any={isOnline:jest.fn().mockResolvedValue(false)};
  return { db, storage, push, realtime, presence, service: new ChatsService(db, storage, push,realtime,presence) };
}

describe('ChatsService membership and messages', () => {
  it('allows a member and rejects a non-member', async () => {
    const { db, realtime, service } = harness();
    db.chatMember.findUnique.mockResolvedValueOnce({ chatId: 'chat-1', userId: 'user-1' }).mockResolvedValueOnce(null);
    await expect(service.assertMember('chat-1', 'user-1')).resolves.toBeUndefined();
    await expect(service.assertMember('chat-1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sends a message only to a joined chat', async () => {
    const { db, push, service } = harness();
    db.chatMember.findUnique.mockResolvedValue({ chatId: 'chat-1', userId: 'user-1' });
    db.message.create.mockResolvedValue({ id: 'message-1', body: 'hello' });
    await expect(service.send('chat-1', 'user-1', { body: ' hello ' })).resolves.toEqual({ id: 'message-1', body: 'hello' });
    expect(db.message.create.mock.calls[0][0].data.body).toBe('hello');
    expect(push.notifyNewMessage).toHaveBeenCalledWith({ id: 'message-1', body: 'hello' });
    db.chatMember.findUnique.mockResolvedValue(null);
    await expect(service.send('chat-1', 'stranger', { body: 'no' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks muted members and automatically clears an expired mute', async () => {
    const { db, realtime, service } = harness();
    db.chatMember.findUnique.mockResolvedValue({ chatId:'chat-1', userId:'user-1', isMuted:true, mutedUntil:null });
    await expect(service.send('chat-1','user-1',{body:'blocked'})).rejects.toBeInstanceOf(ForbiddenException);
    db.chatMember.findUnique.mockResolvedValue({ chatId:'chat-1', userId:'user-1', isMuted:true, mutedUntil:new Date(Date.now()-1000) });
    db.message.create.mockResolvedValue({id:'message-2',body:'allowed'});
    await expect(service.send('chat-1','user-1',{body:'allowed'})).resolves.toMatchObject({body:'allowed'});
    expect(db.chatMember.update).toHaveBeenCalledWith({where:{chatId_userId:{chatId:'chat-1',userId:'user-1'}},data:{isMuted:false,mutedUntil:null}});
  });

  it('does not allow clients to forge system messages', async () => {
    const { db, service } = harness();
    db.chatMember.findUnique.mockResolvedValue({ chatId:'chat-1', userId:'user-1', isMuted:false });
    await expect(service.send('chat-1','user-1',{body:'fake event',kind:'SYSTEM' as any})).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it('edits and deletes only own messages while still a member', async () => {
    const { db, service } = harness();
    db.chatMember.findUnique.mockResolvedValue({ chatId: 'chat-1', userId: 'user-1' });
    db.message.findUnique.mockResolvedValue({ id: 'message-1', chatId: 'chat-1', authorId: 'user-1' });
    db.message.update.mockImplementation(({ data }: any) => ({ id: 'message-1', ...data }));
    await expect(service.edit('message-1', 'user-1', ' updated ')).resolves.toMatchObject({ body: 'updated' });
    await expect(service.remove('message-1', 'user-1')).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    db.message.findUnique.mockResolvedValue({ id: 'message-1', chatId: 'chat-1', authorId: 'user-2' });
    await expect(service.edit('message-1', 'user-1', 'attack')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('message-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a former member from editing even their own message', async () => {
    const { db, service } = harness();
    db.message.findUnique.mockResolvedValue({ id: 'message-1', chatId: 'chat-1', authorId: 'user-1' });
    db.chatMember.findUnique.mockResolvedValue(null);
    await expect(service.edit('message-1', 'user-1', 'attack')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects editing a deleted message and broadcasts successful edits/deletes',async()=>{
    const{db,realtime,service}=harness();db.chatMember.findUnique.mockResolvedValue({chatId:'chat-1',userId:'user-1'});
    db.message.findUnique.mockResolvedValue({id:'m1',chatId:'chat-1',authorId:'user-1',deletedAt:new Date()});
    await expect(service.edit('m1','user-1','again')).rejects.toBeInstanceOf(ConflictException);
    db.message.findUnique.mockResolvedValue({id:'m1',chatId:'chat-1',authorId:'user-1',deletedAt:null});db.message.update.mockResolvedValue({id:'m1',chatId:'chat-1',body:'changed'});
    await service.edit('m1','user-1','changed');expect(realtime.messageEdited).toHaveBeenCalledWith('chat-1',expect.objectContaining({body:'changed'}));
    await service.remove('m1','user-1');expect(realtime.messageDeleted).toHaveBeenCalledWith('chat-1',expect.any(Object));
  });

  it('adds/removes reactions for members and blocks outsiders', async () => {
    const { db, realtime, service } = harness();
    db.message.findUnique.mockResolvedValue({ id: 'message-1', chatId: 'chat-1', authorId: 'user-2' });
    db.chatMember.findUnique.mockResolvedValue({ chatId: 'chat-1', userId: 'user-1' });
    db.messageReaction.findUnique.mockResolvedValue(null);
    db.messageReaction.create.mockResolvedValue({ messageId: 'message-1', userId: 'user-1', emoji: '👍' });
    db.messageReaction.findMany.mockResolvedValue([{ messageId: 'message-1', userId: 'user-1', emoji: '👍' }]);
    await expect(service.react('message-1', 'user-1', '👍')).resolves.toMatchObject({messageId:'message-1',reactions:[{emoji:'👍'}]});
    expect(realtime.reactionUpdated).toHaveBeenCalledWith('chat-1','message-1',expect.any(Array));
    db.chatMember.findUnique.mockResolvedValue(null);
    await expect(service.react('message-1', 'stranger', '👍')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns real unread counts and member presence',async()=>{
    const{db,presence,service}=harness();const lastReadAt=new Date('2026-01-01');
    db.chat.findMany.mockResolvedValue([{id:'chat-1',members:[{userId:'user-1',lastReadAt,user:{id:'user-1'}},{userId:'user-2',lastReadAt:null,user:{id:'user-2'}}],messages:[]}]);
    db.message.count.mockResolvedValue(4);presence.isOnline.mockImplementation((id:string)=>Promise.resolve(id==='user-2'));
    const result=await service.list('user-1');
    expect(db.message.count).toHaveBeenCalledWith({where:{chatId:'chat-1',deletedAt:null,authorId:{not:'user-1'},createdAt:{gt:lastReadAt}}});
    expect(result[0]).toMatchObject({unreadCount:4,members:[{user:{online:false}},{user:{online:true}}]});
  });
});
