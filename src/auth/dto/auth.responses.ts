import { ApiProperty } from '@nestjs/swagger';

import { type OnboardingStep, ONBOARDING_STEPS } from '../../common/onboarding/onboarding.service';
import type { ClientPlatform } from '../../common/utils/request-context';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { OtpChannel } from '../models/otp-verification.model';
import type { Session } from '../models/session.model';
import { maskIp } from '../utils/mask.util';

/** POST /auth/otp/request: identical for every identifier, known or not. */
export class OtpRequestResponse {
  @ApiProperty() message: string;
  @ApiProperty({ example: 300 }) expiresInSeconds: number;
  @ApiProperty({ example: 60 }) resendAfterSeconds: number;
}

/** POST /auth/refresh */
export class TokenPairResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty({ description: 'Opaque "<sessionId>.<secret>"; rotated on every refresh' }) refreshToken: string;
  @ApiProperty({ description: 'Access-token lifetime in seconds', example: 900 }) expiresIn: number;
}

/** POST /auth/otp/verify */
export class LoginResponse extends TokenPairResponse {
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;
  @ApiProperty({ description: 'True when this verify created the account' }) isNewUser: boolean;
  @ApiProperty({ enum: ONBOARDING_STEPS }) nextStep: OnboardingStep;
}

/** GET /auth/sessions item */
export class SessionResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() deviceName: string;
  @ApiProperty({ enum: ['android', 'ios'] }) platform: ClientPlatform;
  @ApiProperty() appVersion: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ description: 'Last seen IP; for other sessions the last octet is masked', example: '203.0.113.*' })
  ipAddress: string;
  @ApiProperty({ description: 'The session making this request' }) current: boolean;

  static fromModel(session: Session, currentSessionId: string): SessionResponse {
    const current = session.id === currentSessionId;
    return Object.assign(new SessionResponse(), {
      id: session.id,
      deviceName: session.deviceName,
      platform: session.platform,
      appVersion: session.appVersion,
      lastUsedAt: session.lastUsedAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      ipAddress: current ? session.ipAddress : maskIp(session.ipAddress),
      current,
    });
  }
}

/** POST /auth/reauth/request */
export class ReauthRequestResponse extends OtpRequestResponse {
  @ApiProperty({ enum: OtpChannel, description: 'Where the code was sent' }) channel: OtpChannel;
}

/** POST /auth/reauth/verify */
export class ReauthVerifyResponse {
  @ApiProperty({ format: 'date-time' }) reauthenticatedAt: string;
  @ApiProperty({ example: 600, description: 'How long sensitive actions are allowed from now' }) validForSeconds: number;
}
