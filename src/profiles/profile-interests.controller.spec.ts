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
import { InterestsController } from '../interests/interests.controller';
import { InterestsService } from '../interests/interests.service';
import { UsersService } from '../users/users.service';
import { ProfileInterestsController } from './profile-interests.controller';
import { ProfilesService } from './profiles.service';

const ID1 = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const ID2 = '7a1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const CATALOGUE = [
  { id: ID1, name: 'Music', slug: 'music' },
  { id: ID2, name: 'Travel', slug: 'travel' },
];

describe('ProfileInterestsController + InterestsController (HTTP, real JwtStrategy)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  const user = fakeUser();
  const session = fakeSession({ userId: user.id, user });

  const profilesMock = {
    getOwnInterests: jest.fn().mockResolvedValue({ interests: [], maxInterests: 5 }),
    replaceOwnInterests: jest.fn().mockResolvedValue({ interests: [CATALOGUE[0]], maxInterests: 5 }),
  };
  const interestsMock = { listActive: jest.fn().mockResolvedValue(CATALOGUE) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({})],
      controllers: [ProfileInterestsController, InterestsController],
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
        { provide: InterestsService, useValue: interestsMock },
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
    `Bearer ${(await tokens.signAccessToken({ sub: user.id, sid: session.id })).token}`;

  const allMocks = [...Object.values(profilesMock), ...Object.values(interestsMock)];

  it.each([
    ['get', '/interests'],
    ['get', '/profile/interests'],
    ['put', '/profile/interests'],
  ] as const)('%s %s → 401 without a token', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).send({ interestIds: [ID1] }).expect(401);
    expect(res.body).toEqual(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
    expect(allMocks.every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('GET /interests returns the active catalogue', async () => {
    const res = await request(app.getHttpServer()).get('/interests').set('Authorization', await auth()).expect(200);
    expect(res.body).toEqual(CATALOGUE);
    expect(interestsMock.listActive).toHaveBeenCalledTimes(1);
  });

  it('GET /profile/interests is scoped to the token owner', async () => {
    const res = await request(app.getHttpServer())
      .get('/profile/interests')
      .set('Authorization', await auth())
      .expect(200);
    expect(res.body).toEqual({ interests: [], maxInterests: 5 });
    expect(profilesMock.getOwnInterests).toHaveBeenCalledWith(user.id);
  });

  it('PUT /profile/interests replaces for the token owner with the body ids', async () => {
    const res = await request(app.getHttpServer())
      .put('/profile/interests')
      .set('Authorization', await auth())
      .send({ interestIds: [ID1, ID2] })
      .expect(200);
    expect(res.body).toEqual({ interests: [CATALOGUE[0]], maxInterests: 5 });
    expect(profilesMock.replaceOwnInterests).toHaveBeenCalledWith(user.id, [ID1, ID2]);
  });

  it('PUT accepts an empty array (clear)', async () => {
    await request(app.getHttpServer())
      .put('/profile/interests')
      .set('Authorization', await auth())
      .send({ interestIds: [] })
      .expect(200);
    expect(profilesMock.replaceOwnInterests).toHaveBeenCalledWith(user.id, []);
  });

  it.each(['userId', 'profileId'])('PUT with %s in body → 400 and service not called', async (field) => {
    const res = await request(app.getHttpServer())
      .put('/profile/interests')
      .set('Authorization', await auth())
      .send({ interestIds: [ID1], [field]: '22222222-2222-4222-8222-222222222222' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(profilesMock.replaceOwnInterests).not.toHaveBeenCalled();
  });

  it('PUT with invalid ids → 400 and service not called', async () => {
    await request(app.getHttpServer())
      .put('/profile/interests')
      .set('Authorization', await auth())
      .send({ interestIds: ['music', ID1, ID1] })
      .expect(400);
    expect(profilesMock.replaceOwnInterests).not.toHaveBeenCalled();
  });
});
