import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { BansModule } from '../bans/bans.module';
import { EventsModule } from '../events/events.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { SessionStateModule } from './session-state/session-state.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RequireReauthGuard } from './guards/require-reauth.guard';
import { OtpVerification } from './models/otp-verification.model';
import { Session } from './models/session.model';
import { OtpDeliveryService } from './services/otp-delivery.service';
import { OtpService } from './services/otp.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/** API side of M06. SmsProvider, EmailProvider and AlertProvider come from global infra modules. */
@Module({
  imports: [
    BansModule,
    UsersModule,
    ProfilesModule,
    EventsModule,
    SessionStateModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets/options are passed per call from ConfigService.
    JwtModule.register({}),
    SequelizeModule.forFeature([Session, OtpVerification]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    OtpDeliveryService,
    TokenService,
    SessionService,
    JwtStrategy,
    JwtAuthGuard,
    RequireReauthGuard,
  ],
  exports: [JwtAuthGuard, RequireReauthGuard, SessionService, TokenService],
})
export class AuthModule {}
