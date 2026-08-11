import 'reflect-metadata';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import helmet from 'helmet';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { getAllowedOrigins } from './security';

class RedisIoAdapter extends IoAdapter {
  private adapter?: ReturnType<typeof createAdapter>;
  async connect(url: string) {
    const pub = new Redis(url); const sub = pub.duplicate();
    await Promise.all([pub.ping(), sub.ping()]); this.adapter = createAdapter(pub, sub);
  }
  createIOServer(port: number, options?: any) {
    const server = super.createIOServer(port, options); if (this.adapter) server.adapter(this.adapter); return server;
  }
}

export function hardenHttpApp(app: INestApplication) {
  const origins = getAllowedOrigins();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('Content-Security-Policy-Report-Only', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.enableCors({
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => !origin || origins.includes(origin) ? callback(null, true) : callback(new Error('CORS origin is not allowed'), false),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } }));
  app.setGlobalPrefix('api');
}

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const levels: Array<'error'|'warn'|'log'|'debug'|'verbose'> = process.env.NODE_ENV === 'production' ? ['error','warn','log'] : ['error','warn','log','debug'];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: levels });
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  hardenHttpApp(app);
  const redis = new RedisIoAdapter(app); await redis.connect(process.env.REDIS_URL ?? 'redis://localhost:6379'); app.useWebSocketAdapter(redis);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  logger.log(`API listening on port ${port}`);
}

if (require.main === module) bootstrap().catch(() => Logger.error('Application failed to start', undefined, 'Bootstrap'));
