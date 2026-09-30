import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { getValidatedEnv } from './config';
import { CoreModule } from './core.module';
import { EntitlementsModule } from './common/entitlements/entitlements.service';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { OnboardingModule } from './common/onboarding/onboarding-status.service';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { IP_LIMIT, THROTTLER_IP, THROTTLER_USER, USER_LIMIT } from './common/throttling/throttling.constants';
import { QueueConnectionModule } from './infra/queue/queue-connection.module';
import { REDIS_CLIENT } from './infra/redis/redis.module';
import { HealthModule } from './health/health.module';
import { SecurityModule } from './security/security.module';

import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InterestsModule } from './interests/interests.module';
import { PreferencesModule } from './preferences/preferences.module';
import { ProfilesModule } from './profiles/profiles.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { MatchingModule } from './matching/matching.module';
import { LikesModule } from './likes/likes.module';
import { ChatModule } from './chat/chat.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { BlocksModule } from './blocks/blocks.module';
import { AdminModule } from './admin/admin.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

/**
 * Observe is only enabled when real credentials are configured.
 * Evaluated after CoreModule's ConfigModule.forRoot(), which has already validated the env.
 */
function observeImports(): DynamicModule[] {
  const { OBSERVE_APP_KEY: appKey, OBSERVE_APP_SECRET: appSecret } = getValidatedEnv();
  if (!appKey || !appSecret) return [];
  return [ObserveModule.forRoot({ appKey, appSecret, serviceId: 'backend' })];
}

@Module({
  imports: [
    CoreModule,
    ...observeImports(),

    QueueConnectionModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [
          { name: THROTTLER_IP, ...IP_LIMIT },
          { name: THROTTLER_USER, ...USER_LIMIT },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    SecurityModule,
    HealthModule,
    EntitlementsModule,
    OnboardingModule,

    AuthModule,
    AccountModule,
    UsersModule,
    ProfilesModule,
    InterestsModule,
    PreferencesModule,
    DiscoveryModule,
    MatchingModule,
    LikesModule,
    ChatModule,
    MediaModule,
    NotificationsModule,
    ReportsModule,
    BlocksModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
