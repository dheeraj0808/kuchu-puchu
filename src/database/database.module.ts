import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SequelizeModule, SequelizeModuleOptions } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import type { DatabaseConfig } from '../config/database.config';
import { OtpVerification } from '../auth/models/otp-verification.model';
import { Session } from '../auth/models/session.model';
import { OutboxEvent } from '../events/models/outbox-event.model';
import { SecurityEvent } from '../security/models/security-event.model';
import { Interest } from '../interests/models/interest.model';
import { ProfileInterest } from '../interests/models/profile-interest.model';
import { DatingPreference } from '../preferences/models/dating-preference.model';
import { Profile } from '../profiles/models/profile.model';
import { User } from '../users/models/user.model';
import { assertSupportedServer } from './server-version';

const sqlLogger = new Logger('Sequelize');

/** Refuses to boot on anything but MySQL ≥ 8.4, so MariaDB is never used by accident. */
@Injectable()
export class DatabaseServerCheck implements OnModuleInit {
  constructor(private readonly sequelize: Sequelize) {}

  async onModuleInit(): Promise<void> {
    const [{ version }] = await this.sequelize.query<{ version: string }>('SELECT VERSION() AS version', {
      type: QueryTypes.SELECT,
    });
    assertSupportedServer(version);
  }
}

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): SequelizeModuleOptions => {
        const db = config.getOrThrow<DatabaseConfig>('database');
        return {
          dialect: 'mysql',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          timezone: '+00:00',
          models: [
            User,
            Session,
            OtpVerification,
            SecurityEvent,
            Profile,
            Interest,
            ProfileInterest,
            DatingPreference,
            OutboxEvent,
          ],
          autoLoadModels: true,
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
          pool: { max: db.poolMax, min: db.poolMin, acquire: 30_000, idle: 10_000 },
          define: {
            underscored: true,
            charset: 'utf8mb4',
            collate: 'utf8mb4_0900_ai_ci',
          },
          dialectOptions: {
            charset: 'utf8mb4',
            dateStrings: false,
            ...(db.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
          },
          benchmark: false,
          // Never log bind parameters (logQueryParameters stays disabled).
          logging: db.logging
            ? (sql: string): void => sqlLogger.debug(sql)
            : false,
        };
      },
    }),
  ],
  providers: [DatabaseServerCheck],
})
export class DatabaseModule {}
