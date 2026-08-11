import { randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import request = require('supertest');

const realStackDescribe = process.env.REAL_STACK_TESTS === '1' ? describe : describe.skip;

realStackDescribe('Pulse running stack e2e', () => {
  const apiUrl = process.env.REAL_STACK_API_URL ?? 'http://127.0.0.1:4000';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  let alice: any;
  let bob: any;
  let outsider: any;
  let chatId: string;
  const sockets: Socket[] = [];

  async function register(label: string) {
    const response = await request(apiUrl)
      .post('/api/auth/register')
      .send({
        email: `${label}-${suffix}@ci.pulse.test`,
        username: `${label}_${suffix}`,
        displayName: `CI ${label}`,
        password: 'CiPassword12345',
      })
      .expect(201);
    return response.body;
  }

  async function connect(token: string) {
    const socket = io(`${apiUrl}/chat`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  async function emitAck<T>(socket: Socket, event: string, payload: unknown) {
    return new Promise<T>((resolve, reject) => {
      socket.timeout(8_000).emit(event, payload, (error: Error | null, response: T) => {
        error ? reject(new Error(`${event} acknowledgement failed: ${error.message}`)) : resolve(response);
      });
    });
  }

  beforeAll(async () => {
    const health = await request(apiUrl).get('/api/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok',
      checks: { postgres: 'up', redis: 'up' },
    });
    [alice, bob, outsider] = await Promise.all([
      register('alice'),
      register('bob'),
      register('outsider'),
    ]);
  }, 60_000);

  afterAll(() => sockets.forEach(socket => socket.disconnect()));

  it('persists messages in Postgres and broadcasts them through the real Socket.IO/Redis stack', async () => {
    const chat = await request(apiUrl)
      .post('/api/chats')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ type: 'GROUP', title: 'CI integration', memberIds: [bob.user.id] })
      .expect(201);
    chatId = chat.body.id;

    await request(apiUrl)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ body: 'Persisted over HTTP' })
      .expect(201);

    const [aliceSocket, bobSocket] = await Promise.all([
      connect(alice.accessToken),
      connect(bob.accessToken),
    ]);
    await Promise.all([
      emitAck(aliceSocket, 'chat:join', { chatId }),
      emitAck(bobSocket, 'chat:join', { chatId }),
    ]);

    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message:new was not broadcast')), 8_000);
      bobSocket.once('message:new', message => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    const sent = await emitAck<any>(aliceSocket, 'message:send', {
      chatId,
      body: 'Broadcast through Redis adapter',
    });
    expect(sent.body).toBe('Broadcast through Redis adapter');
    expect((await received).body).toBe('Broadcast through Redis adapter');

    const messages = await request(apiUrl)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(200);
    expect(messages.body.map((message: any) => message.body)).toEqual(expect.arrayContaining([
      'Persisted over HTTP',
      'Broadcast through Redis adapter',
    ]));
  }, 60_000);

  it('rejects an outsider against the running stack', async () => {
    await request(apiUrl)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .expect(403);
  });
});
