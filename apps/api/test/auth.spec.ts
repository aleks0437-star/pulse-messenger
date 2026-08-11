import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { AuthService, RegisterDto } from '../src/auth';

const user = { id: 'user-1', email: 'anna@example.com', username: 'anna', displayName: 'Анна', passwordHash: '' };

function harness() {
  const db: any = {
    user: { create: jest.fn(), findFirst: jest.fn() },
    refreshToken: { create: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((operation: any) => typeof operation === 'function' ? operation(db) : Promise.all(operation)),
  };
  const config: any = { get: jest.fn((key: string, fallback: unknown) => fallback), getOrThrow: jest.fn((key: string) => key === 'REFRESH_JWT_SECRET' ? process.env.REFRESH_JWT_SECRET : undefined) };
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  return { db, jwt, service: new AuthService(db, jwt, config) };
}

describe('AuthService', () => {
  it('registers with a hash, safe response and 15-minute access token', async () => {
    const { db, jwt, service } = harness();
    db.user.create.mockImplementation(({ data }: any) => ({ ...user, ...data }));
    const result = await service.register({ email: 'ANNA@example.com', username: 'anna', displayName: 'Анна', password: 'Secure12345' });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('password');
    expect(await bcrypt.compare('Secure12345', db.user.create.mock.calls[0][0].data.passwordHash)).toBe(true);
    expect(db.user.create.mock.calls[0][0].data).not.toHaveProperty('password');
    const access = jwt.decode(result.accessToken) as any;
    expect(access.type).toBe('access');
    expect(access.exp - access.iat).toBe(900);
    expect(db.refreshToken.create.mock.calls[0][0].data.tokenHash).not.toBe(result.refreshToken);
  });

  it('rejects weak registration data through the DTO policy', async () => {
    const dto = Object.assign(new RegisterDto(), { email: 'a@example.com', username: 'anna', displayName: 'A', password: '1234567890' });
    const errors = await validate(dto);
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['displayName', 'password']));
  });

  it('logs in with valid credentials and rejects an invalid password', async () => {
    const { db, service } = harness();
    const passwordHash = await bcrypt.hash('Secure12345', 4);
    db.user.findFirst.mockResolvedValue({ ...user, passwordHash });
    await expect(service.login({ login: 'anna', password: 'Secure12345' })).resolves.toHaveProperty('accessToken');
    await expect(service.login({ login: 'anna', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a refresh token and revokes the previous record', async () => {
    const { db, service } = harness();
    db.user.create.mockImplementation(({ data }: any) => ({ ...user, ...data }));
    const initial = await service.register({ email: user.email, username: user.username, displayName: user.displayName, password: 'Secure12345' });
    const initialRecord = db.refreshToken.create.mock.calls[0][0].data;
    db.refreshToken.findUnique.mockResolvedValue({ ...initialRecord, revokedAt: null, user: { ...user, passwordHash: 'hash' } });
    const rotated = await service.refresh(initial.refreshToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: initialRecord.id, revokedAt: null }, data: expect.objectContaining({ replacedById: expect.any(String) }) }));
    db.refreshToken.findUnique.mockResolvedValue({ ...initialRecord, revokedAt: new Date(), user });
    await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    db.refreshToken.findUnique.mockResolvedValue({ ...initialRecord, revokedAt: null, user });
    db.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes refresh token on logout without storing the raw token', async () => {
    const { db, service } = harness();
    await expect(service.logout('a-valid-looking-refresh-token-value')).resolves.toEqual({ ok: true });
    const where = db.refreshToken.updateMany.mock.calls[0][0].where;
    expect(where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(db.refreshToken.updateMany.mock.calls[0][0])).not.toContain('a-valid-looking-refresh-token-value');
  });
});
