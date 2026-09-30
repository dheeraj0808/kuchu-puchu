import 'reflect-metadata';

import { type INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionStateService } from '../auth/session-state/session-state.service';
import { TokenService } from '../auth/services/token.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { fakeSession, fakeUser, fakeSessionState } from '../auth/testing/fakes';
import { createTestConfig } from '../auth/testing/test-config';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { UsersService } from '../users/users.service';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

describe('PreferencesController (HTTP, real JwtStrategy)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  const user = fakeUser();
  const session = fakeSession({ userId: user.id, user });

  const response = {
    isConfigured: true,
    minAge: 24,
    maxAge: 32,
    preferredGenders: ['woman'],
    maxDistanceKm: 50,
    relationshipIntent: 'LONG_TERM',
    updatedAt: null,
  };

  const serviceMock = {
    getOwn: jest.fn().mockResolvedValue(response),
    create: jest.fn().mockResolvedValue(response),
    update: jest.fn().mockResolvedValue(response),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({})],
      controllers: [PreferencesController],
      providers: [
        { provide: ConfigService, useValue: createTestConfig() },
        {
          provide: SessionStateService,
          useValue: fakeSessionState((sid: string) => Promise.resolve(sid === session.id ? session : null)),
        },
        { provide: UsersService, useValue: { findById: (id: string) => Promise.resolve(id === user.id ? user : null) } },
        { provide: PreferencesService, useValue: serviceMock },
        TokenService,
        JwtStrategy,
        JwtAuthGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter(new Logger('test')));
    await app.init();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const auth = async (): Promise<string> =>
    `Bearer ${(await tokens.signAccessToken({ sub: user.id, sid: session.id, role: user.role })).token}`;

  const valid = {
    minAge: 24,
    maxAge: 32,
    preferredGenders: ['woman'],
    maxDistanceKm: 50,
    relationshipIntent: 'LONG_TERM',
  };

  it.each(['get', 'post', 'patch'] as const)('%s /preferences → 401 without a token', async (method) => {
    const res = await request(app.getHttpServer())[method]('/preferences').send(valid).expect(401);
    expect(res.body).toEqual(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
    expect(Object.values(serviceMock).every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('401 with an invalid token', async () => {
    await request(app.getHttpServer()).get('/preferences').set('Authorization', 'Bearer nope').expect(401);
    expect(serviceMock.getOwn).not.toHaveBeenCalled();
  });

  it('GET returns the service result for the token owner', async () => {
    const res = await request(app.getHttpServer()).get('/preferences').set('Authorization', await auth()).expect(200);
    expect(res.body).toEqual(response);
    expect(serviceMock.getOwn).toHaveBeenCalledWith(user.id);
  });

  it('POST creates preferences for the token owner', async () => {
    await request(app.getHttpServer()).post('/preferences').set('Authorization', await auth()).send(valid).expect(201);
    expect(serviceMock.create).toHaveBeenCalledWith(user.id, expect.objectContaining(valid));
  });

  it('cannot target another user: userId in body is rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/preferences')
      .set('Authorization', await auth())
      .send({ ...valid, userId: '22222222-2222-4222-8222-222222222222' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_ERROR for an invalid relationshipIntent', async () => {
    const res = await request(app.getHttpServer())
      .post('/preferences')
      .set('Authorization', await auth())
      .send({ ...valid, relationshipIntent: 'long_term' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('PATCH updates only the caller preferences', async () => {
    await request(app.getHttpServer())
      .patch('/preferences')
      .set('Authorization', await auth())
      .send({ maxDistanceKm: 25 })
      .expect(200);
    expect(serviceMock.update).toHaveBeenCalledWith(user.id, expect.objectContaining({ maxDistanceKm: 25 }));
  });

  it('PATCH rejects userId in body', async () => {
    await request(app.getHttpServer())
      .patch('/preferences')
      .set('Authorization', await auth())
      .send({ userId: '22222222-2222-4222-8222-222222222222' })
      .expect(400);
    expect(serviceMock.update).not.toHaveBeenCalled();
  });
});
