import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PresenceService } from './presence';

@Controller('health')
export class HealthController {
  constructor(private db: PrismaService, private presence: PresenceService) {}
  @Get()
  async check() {
    const [, redis] = await Promise.all([
      this.db.$queryRaw`SELECT 1`,
      this.presence.ping(),
    ]);
    return {
      status: 'ok',
      checks: { postgres: 'up', redis: redis === 'PONG' ? 'up' : 'down' },
    };
  }
}
