import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Keep Observe for now.
    // Replace these values with real credentials when we configure it.
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),

    AuthModule,
    UsersModule,
    ProfilesModule,
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

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }