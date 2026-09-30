import 'reflect-metadata';

import { SecurityEventsService } from '../security/security-events.service';

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
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

describe('ProfilesController (HTTP, real JwtStrategy)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  const user = fakeUser();
  const session = fakeSession({ userId: user.id, user });

  const profilesMock = {
    getOwn: jest.fn().mockResolvedValue({ displayName: 'Priya' }),
    create: jest.fn().mockResolvedValue({ displayName: 'Priya' }),
    update: jest.fn().mockResolvedValue({ displayName: 'Asha' }),
    remove: jest.fn().mockResolvedValue(undefined),
    getCompletion: jest.fn().mockResolvedValue({ profileCompletion: 55, missingFields: ['bio'] }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({})],
      controllers: [ProfilesController],
      providers: [
        { provide: ConfigService, useValue: createTestConfig() },
        {
          provide: SecurityEventsService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SessionStateService,
          useValue: fakeSessionState((sid: string) => Promise.resolve(sid === session.id ? session : null)),
        },
        { provide: UsersService, useValue: { findById: (id: string) => Promise.resolve(id === user.id ? user : null) } },
        { provide: ProfilesService, useValue: profilesMock },
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

  const valid = { displayName: 'Priya', dateOfBirth: '1998-04-21', gender: 'woman' };

  it.each([
    ['get', '/profile'],
    ['post', '/profile'],
    ['patch', '/profile'],
    ['delete', '/profile'],
    ['get', '/profile/completion'],
  ] as const)('%s %s → 401 without a token', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).send(valid).expect(401);
    expect(res.body).toEqual(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
    expect(Object.values(profilesMock).every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('401 with an invalid token', async () => {
    await request(app.getHttpServer()).get('/profile').set('Authorization', 'Bearer nope').expect(401);
  });

  it('POST creates the profile for the token owner', async () => {
    await request(app.getHttpServer()).post('/profile').set('Authorization', await auth()).send(valid).expect(201);
    expect(profilesMock.create).toHaveBeenCalledWith(user.id, expect.objectContaining(valid), expect.anything());
  });

  it('cannot target another user: userId in body is rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/profile')
      .set('Authorization', await auth())
      .send({ ...valid, userId: '22222222-2222-4222-8222-222222222222' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(profilesMock.create).not.toHaveBeenCalled();
  });

  it('PATCH updates only the caller profile', async () => {
    await request(app.getHttpServer())
      .patch('/profile')
      .set('Authorization', await auth())
      .send({ displayName: 'Asha' })
      .expect(200);
    expect(profilesMock.update).toHaveBeenCalledWith(user.id, expect.objectContaining({ displayName: 'Asha' }));
  });

  it('400 for invalid DOB (underage) and client-set completion', async () => {
    const underage = new Date();
    underage.setUTCFullYear(underage.getUTCFullYear() - 16);
    await request(app.getHttpServer())
      .post('/profile')
      .set('Authorization', await auth())
      .send({ ...valid, dateOfBirth: underage.toISOString().slice(0, 10) })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/profile')
      .set('Authorization', await auth())
      .send({ profileCompletion: 100 })
      .expect(400);
    expect(profilesMock.create).not.toHaveBeenCalled();
    expect(profilesMock.update).not.toHaveBeenCalled();
  });

  it('GET /profile/completion and DELETE /profile are scoped to the caller', async () => {
    const res = await request(app.getHttpServer()).get('/profile/completion').set('Authorization', await auth()).expect(200);
    expect(res.body).toEqual({ profileCompletion: 55, missingFields: ['bio'] });
    await request(app.getHttpServer()).delete('/profile').set('Authorization', await auth()).expect(200);
    expect(profilesMock.getCompletion).toHaveBeenCalledWith(user.id);
    expect(profilesMock.remove).toHaveBeenCalledWith(user.id, expect.anything());
  });
});
