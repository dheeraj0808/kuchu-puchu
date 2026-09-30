import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Sequelize } from 'sequelize-typescript';
import request from 'supertest';

import type { ProfilesService } from '../profiles/profiles.service';
import type { SecurityEventsService } from '../security/security-events.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { User } from '../users/models/user.model';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { Session } from './models/session.model';
import type { OtpDeliveryService } from './services/otp-delivery.service';
import type { OtpService } from './services/otp.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { fakeSecurityEvents, fakeSession, fakeUser } from './testing/fakes';
import { createTestConfig, TEST_JWT_CONFIG } from './testing/test-config';

describe('AuthController (GET /auth/me, POST /auth/logout-all) with real JwtStrategy', () => {
  let app: INestApplication;
  let tokens: TokenService;
  const config = createTestConfig();
  const user: User = fakeUser();
  let session: Session;

  const sessionsMock = {
    findActiveSession: jest.fn(),
    revokeAllForUser: jest.fn().mockResolvedValue(2),
  };
  const profilesMock = { getOwnOrNull: jest.fn().mockResolvedValue(null) };
  const usersMock = {
    findById: jest.fn(),
    toResponse: (u: User): UserResponseDto => UserResponseDto.fromModel(u),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({})],
      controllers: [AuthController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: SessionService, useValue: sessionsMock },
        { provide: UsersService, useValue: usersMock },
        TokenService,
        JwtStrategy,
        JwtAuthGuard,
        {
          provide: AuthService,
          inject: [SessionService, TokenService, UsersService],
          useFactory: (s: SessionService, t: TokenService, u: UsersService) =>
            new AuthService(
              {} as OtpService,
              {} as OtpDeliveryService,
              s,
              t,
              u,
              fakeSecurityEvents() as SecurityEventsService,
              {} as Sequelize,
              profilesMock as unknown as ProfilesService,
            ),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    session = fakeSession({ userId: user.id, user });
    sessionsMock.findActiveSession.mockImplementation((sid: string) =>
      Promise.resolve(sid === session.id ? session : null),
    );
    usersMock.findById.mockImplementation((id: string) => Promise.resolve(id === user.id ? user : null));
  });

  it('401 without token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('401 with garbage token', async () => {
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('401 with token signed by wrong secret', async () => {
    const forged = await new JwtService().signAsync(
      { sub: user.id, sid: session.id, role: user.role },
      { secret: 'x'.repeat(40), issuer: TEST_JWT_CONFIG.issuer, audience: TEST_JWT_CONFIG.audience },
    );
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('401 with expired token', async () => {
    const expired = await new JwtService().signAsync(
      { sub: user.id, sid: session.id, role: user.role, exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: TEST_JWT_CONFIG.accessSecret, issuer: TEST_JWT_CONFIG.issuer, audience: TEST_JWT_CONFIG.audience },
    );
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  it('401 when session revoked', async () => {
    const { token } = await tokens.signAccessToken({ sub: user.id, sid: session.id, role: user.role });
    sessionsMock.findActiveSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('200 with valid token returns the user', async () => {
    const { token } = await tokens.signAccessToken({ sub: user.id, sid: session.id, role: user.role });
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBe(user.id);
    expect(body.email).toBe(user.email);
    expect(body).not.toHaveProperty('isBanned');
    expect(body.profile).toBeNull();
  });

  it('logout-all revokes every session for the caller', async () => {
    const { token } = await tokens.signAccessToken({ sub: user.id, sid: session.id, role: user.role });
    await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sessionsMock.revokeAllForUser).toHaveBeenCalledWith(user.id, 'logout_all');
  });

  it('logout-all requires auth', async () => {
    await request(app.getHttpServer()).post('/auth/logout-all').expect(401);
  });
});
