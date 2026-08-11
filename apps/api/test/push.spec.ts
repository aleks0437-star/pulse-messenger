import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { PushService } from '../src/push';

jest.mock('web-push',()=>({setVapidDetails:jest.fn(),sendNotification:jest.fn()}));

function harness(){
  const db:any={chat:{findUnique:jest.fn()},pushSubscription:{delete:jest.fn(),upsert:jest.fn(),deleteMany:jest.fn()},user:{findUnique:jest.fn(),update:jest.fn()}};
  const presence:any={isActiveInChat:jest.fn().mockResolvedValue(false)};
  const config:any={get:jest.fn((key:string)=>({VAPID_SUBJECT:'mailto:test@pulse.local',VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private'}[key]))};
  return{db,presence,service:new PushService(db,presence,config as ConfigService)};
}
const message={id:'m1',chatId:'chat-1',authorId:'author',body:'Привет из Pulse',mediaUrl:null,mediaType:null,author:{displayName:'Анна',avatarUrl:null}};

describe('PushService',()=>{
  beforeEach(()=>{jest.clearAllMocks();(webPush.sendNotification as jest.Mock).mockResolvedValue({statusCode:201})});
  it('skips the author and users active in the chat, and pushes to inactive members',async()=>{
    const{db,presence,service}=harness();
    db.chat.findUnique.mockResolvedValue({type:'GROUP',title:'Команда',members:[
      {user:{id:'author',hidePushPreview:false,pushSubscriptions:[{id:'s-author',endpoint:'https://push/author',p256dh:'key-author',auth:'auth-author'}]}},
      {user:{id:'active',hidePushPreview:false,pushSubscriptions:[{id:'s-active',endpoint:'https://push/active',p256dh:'key-active',auth:'auth-active'}]}},
      {user:{id:'inactive',hidePushPreview:false,pushSubscriptions:[{id:'s-inactive',endpoint:'https://push/inactive',p256dh:'key-inactive',auth:'auth-inactive'}]}},
    ]});
    presence.isActiveInChat.mockImplementation((id:string)=>Promise.resolve(id==='active'));

    await service.notifyNewMessage(message);

    expect(presence.isActiveInChat).toHaveBeenCalledTimes(2);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    expect((webPush.sendNotification as jest.Mock).mock.calls[0][0].endpoint).toBe('https://push/inactive');
    expect(JSON.parse((webPush.sendNotification as jest.Mock).mock.calls[0][1])).toMatchObject({title:'Анна · Команда',body:'Привет из Pulse',chatId:'chat-1'});
  });
  it('hides previews and deletes dead subscriptions on 404/410',async()=>{
    const{db,service}=harness();
    db.chat.findUnique.mockResolvedValue({type:'DIRECT',title:null,members:[{user:{id:'recipient',hidePushPreview:true,pushSubscriptions:[{id:'dead',endpoint:'https://push/dead',p256dh:'dead-key',auth:'dead-auth'}]}}]});
    (webPush.sendNotification as jest.Mock).mockRejectedValue(Object.assign(new Error('gone'),{statusCode:410}));

    await service.notifyNewMessage(message);

    expect(JSON.parse((webPush.sendNotification as jest.Mock).mock.calls[0][1]).body).toBe('Новое сообщение от Анна');
    expect(db.pushSubscription.delete).toHaveBeenCalledWith({where:{id:'dead'}});
  });
});
