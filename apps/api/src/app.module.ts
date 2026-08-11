import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { AuthController, AuthRateLimitGuard, AuthService, JwtStrategy } from './auth';
import { ChatsController, ChatsService } from './chats';
import { ChatGateway } from './realtime';
import { PresenceService } from './presence';
import { PushController, PushService } from './push';
import { ChatRealtimeService } from './chat-realtime';
import { ChatInvitesController, InvitesController, InvitesService, ModerationController } from './invites';
import { VoiceController, VoiceService } from './voice';
import { StorageController, StorageService } from './storage';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]), JwtModule.registerAsync({ global: true, inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }) })],
  controllers: [AuthController, ChatsController, VoiceController, StorageController, HealthController, PushController, ChatInvitesController, InvitesController, ModerationController],
  providers: [PrismaService, AuthService, AuthRateLimitGuard, JwtStrategy, StorageService, ChatsService, ChatGateway, ChatRealtimeService, PresenceService, VoiceService, PushService, InvitesService],
})
export class AppModule {}
