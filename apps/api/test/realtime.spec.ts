import { ChatGateway } from '../src/realtime';

function socket(token = 'token') {
  return {
    handshake: { auth: { token }, headers: {} }, data: {},
    disconnect: jest.fn(), join: jest.fn(), broadcast: { emit: jest.fn() },
  } as any;
}

describe('ChatGateway handshake authentication', () => {
  it('accepts a valid access token for an existing user', async () => {
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'anna', type: 'access' }) };
    const presence: any = { online: jest.fn() };
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) } };
    const gateway = new ChatGateway(jwt, presence, {} as any, db);
    const client = socket();
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(presence.online).toHaveBeenCalledWith('user-1');
  });

  it('disconnects missing, refresh or unknown-user tokens', async () => {
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'user-1', username: 'anna', type: 'refresh' }) };
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const gateway = new ChatGateway(jwt, { online: jest.fn() } as any, {} as any, db);
    const refreshClient = socket(); await gateway.handleConnection(refreshClient); expect(refreshClient.disconnect).toHaveBeenCalled();
    const missingClient = socket(undefined as any); missingClient.handshake.auth = {}; await gateway.handleConnection(missingClient); expect(missingClient.disconnect).toHaveBeenCalled();
    jwt.verify.mockReturnValue({ sub: 'deleted', username: 'gone', type: 'access' });
    const unknownClient = socket(); await gateway.handleConnection(unknownClient); expect(unknownClient.disconnect).toHaveBeenCalled();
  });
});
