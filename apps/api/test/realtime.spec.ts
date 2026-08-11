import { ChatGateway } from '../src/realtime';

function socket(token = 'token') {
  return {
    handshake: { auth: { token }, headers: {} }, data: {},
    disconnect: jest.fn(), join: jest.fn(), broadcast: { emit: jest.fn() },
  } as any;
}

function installMiddleware(gateway: ChatGateway) {
  let middleware: (client: any, next: (error?: Error) => void) => void = () => undefined;
  gateway.afterInit({ use: jest.fn((handler: typeof middleware) => { middleware = handler; }) } as any);
  return (client: any) => new Promise<void>((resolve, reject) => middleware(client, error => error ? reject(error) : resolve()));
}

describe('ChatGateway handshake authentication', () => {
  it('accepts a valid access token for an existing user', async () => {
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'anna', type: 'access' }) };
    const presence: any = { online: jest.fn() };
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) } };
    const gateway = new ChatGateway(jwt, presence, {} as any, db);
    const client = socket();
    await installMiddleware(gateway)(client);
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(presence.online).toHaveBeenCalledWith('user-1');
  });

  it('disconnects missing, refresh or unknown-user tokens', async () => {
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'anna', type: 'refresh' }) };
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const gateway = new ChatGateway(jwt, { online: jest.fn() } as any, {} as any, db);
    const authenticate = installMiddleware(gateway);
    const refreshClient = socket(); await expect(authenticate(refreshClient)).rejects.toThrow('unauthorized');
    const missingClient = socket(undefined as any); missingClient.handshake.auth = {}; await expect(authenticate(missingClient)).rejects.toThrow('unauthorized');
    jwt.verify.mockReturnValue({ sub: 'deleted', username: 'gone', type: 'access' });
    const unknownClient = socket(); await expect(authenticate(unknownClient)).rejects.toThrow('unauthorized');
  });

  it('does not complete the handshake before the async user lookup finishes', async () => {
    let resolveLookup!: (user: { id: string }) => void;
    const lookup = new Promise<{ id: string }>(resolve => { resolveLookup = resolve; });
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'anna', type: 'access' }) };
    const db: any = { user: { findUnique: jest.fn().mockReturnValue(lookup) } };
    const gateway = new ChatGateway(jwt, { online: jest.fn() } as any, {} as any, db);
    const client = socket();
    const authentication = installMiddleware(gateway)(client);

    await Promise.resolve();
    expect(client.data.user).toBeUndefined();
    resolveLookup({ id: 'user-1' });
    await authentication;
    expect(client.data.user).toEqual({ id: 'user-1', username: 'anna' });
  });
});
