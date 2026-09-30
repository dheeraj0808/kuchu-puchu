import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OtpVerification } from './models/otp-verification.model';
import { Session } from './models/session.model';
import { DevOtpDeliveryService, OtpDeliveryService } from './services/otp-delivery.service';
import { OtpService } from './services/otp.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    ProfilesModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets/options are passed per call from ConfigService.
    JwtModule.register({}),
    SequelizeModule.forFeature([Session, OtpVerification]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    SessionService,
    JwtStrategy,
    JwtAuthGuard,
    { provide: OtpDeliveryService, useClass: DevOtpDeliveryService },
  ],
  exports: [JwtAuthGuard, SessionService, TokenService, OtpService],
})
export class AuthModule {}
