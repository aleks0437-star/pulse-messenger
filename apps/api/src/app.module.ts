import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { AuthController, AuthRateLimitGuard, AuthService, JwtStrategy } from './auth';
import { ChatsController, ChatsService } from './chats';
import { ChatGateway, PresenceService } from './realtime';
import { VoiceController, VoiceService } from './voice';
import { StorageController, StorageService } from './storage';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]), JwtModule.registerAsync({ global: true, inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }) })],
  controllers: [AuthController, ChatsController, VoiceController, StorageController, HealthController],
  providers: [PrismaService, AuthService, AuthRateLimitGuard, JwtStrategy, StorageService, ChatsService, ChatGateway, PresenceService, VoiceService],
})
export class AppModule {}
