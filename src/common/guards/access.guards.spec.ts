import 'reflect-metadata';

import { type CanActivate, Controller, type ExecutionContext, Get, type INestApplication, Injectable, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { UserRole } from '../../users/models/user.model';
import { ADVANCED_FILTER_LEVELS, EntitlementKey, UserEntitlements, FREE_PLAN_ENTITLEMENTS } from '../entitlements/entitlements';
import { EntitlementsModule, EntitlementsService } from '../entitlements/entitlements.service';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { OnboardingModule, OnboardingStatusService } from '../onboarding/onboarding-status.service';
import { RequiresEntitlement, Roles } from './access.decorators';
import { EntitlementGuard, RolesGuard, VerifiedUserGuard } from './access.guards';

const USER_ID = '01926b7e-0000-7000-8000-000000000001';

/** Stands in for JwtAuthGuard: the principal comes from test headers (role as loaded from the DB). */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: AuthenticatedUser }>();
    const role = req.headers['x-test-db-role'];
    if (role) req.user = { userId: USER_ID, sessionId: 's', role: role as UserRole };
    return true;
  }
}

@Controller()
class ProbeController {
  @Get('admin')
  @UseGuards(FakeAuthGuard, RolesGuard)
  @Roles(UserRole.Admin)
  admin(): string {
    return 'ok';
  }

  @Get('moderation')
  @UseGuards(FakeAuthGuard, RolesGuard)
  @Roles(UserRole.Moderator, UserRole.Admin)
  moderation(): string {
    return 'ok';
  }

  @Get('any-role')
  @UseGuards(FakeAuthGuard, RolesGuard)
  anyRole(): string {
    return 'ok';
  }

  @Get('verified')
  @UseGuards(FakeAuthGuard, VerifiedUserGuard)
  verified(): string {
    return 'ok';
  }

  @Get('calls')
  @UseGuards(FakeAuthGuard, EntitlementGuard)
  @RequiresEntitlement(EntitlementKey.VoiceVideoCalls)
  calls(): string {
    return 'ok';
  }

  @Get('likes-count')
  @UseGuards(FakeAuthGuard, EntitlementGuard)
  @RequiresEntitlement(EntitlementKey.SeeWhoLikedMe, 'count_only')
  likesCount(): string {
    return 'ok';
  }

  @Get('likes-list')
  @UseGuards(FakeAuthGuard, EntitlementGuard)
  @RequiresEntitlement(EntitlementKey.SeeWhoLikedMe, 'full_list')
  likesList(): string {
    return 'ok';
  }
}

async function buildApp(overrides: { onboarding?: OnboardingStatusService } = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [EntitlementsModule, OnboardingModule],
    controllers: [ProbeController],
    providers: [FakeAuthGuard],
  });
  if (overrides.onboarding) builder = builder.overrideProvider(OnboardingStatusService).useValue(overrides.onboarding);
  const app = (await builder.compile()).createNestApplication({ logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('access guards', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, role?: UserRole, extra: Record<string, string> = {}) => {
    const r = request(app.getHttpServer()).get(path).set(extra);
    return role ? r.set('x-test-db-role', role) : r;
  };

  describe('RolesGuard + @Roles()', () => {
    it('allows a listed role', async () => {
      await get('/admin', UserRole.Admin).expect(200);
      await get('/moderation', UserRole.Moderator).expect(200);
    });

    it('answers 403 FORBIDDEN for other roles', async () => {
      const res = await get('/admin', UserRole.Moderator).expect(403);
      expect(res.body).toEqual({ success: false, code: 'FORBIDDEN', message: 'Forbidden' });
      await get('/moderation', UserRole.User).expect(403);
    });

    it('uses the role loaded from the database, never a role claim in the token', async () => {
      const forged = Buffer.from(JSON.stringify({ sub: USER_ID, role: 'admin' })).toString('base64url');
      await get('/admin', UserRole.User, { Authorization: `Bearer x.${forged}.y` }).expect(403);
    });

    it('allows any signed-in user when no roles are required', async () => {
      await get('/any-role', UserRole.User).expect(200);
    });

    it('answers 401 when no principal is present', async () => {
      const res = await get('/admin').expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('VerifiedUserGuard', () => {
    it('answers 403 ONBOARDING_INCOMPLETE with details.nextStep until the selfie is approved (M01 stub)', async () => {
      const res = await get('/verified', UserRole.User).expect(403);
      expect(res.body).toEqual({
        success: false,
        code: 'ONBOARDING_INCOMPLETE',
        message: 'Finish setting up your account to continue',
        details: { nextStep: 'selfie' },
      });
    });

    it('allows the request once the status service reports an approved selfie', async () => {
      const approved = await buildApp({
        onboarding: { getStatus: () => Promise.resolve({ selfieApproved: true, nextStep: 'photos' }) },
      });
      try {
        await request(approved.getHttpServer()).get('/verified').set('x-test-db-role', 'user').expect(200);
      } finally {
        await approved.close();
      }
    });

    it('answers 401 when no principal is present', async () => {
      await get('/verified').expect(401);
    });
  });

  describe('EntitlementGuard + @RequiresEntitlement()', () => {
    it('answers 403 ENTITLEMENT_REQUIRED with details.entitlement on the Free plan', async () => {
      const res = await get('/calls', UserRole.User).expect(403);
      expect(res.body).toEqual({
        success: false,
        code: 'ENTITLEMENT_REQUIRED',
        message: 'This feature is not included in your plan',
        details: { entitlement: 'voice_video_calls' },
      });
    });

    it('compares tiered levels: Free sees the like count but not the list', async () => {
      await get('/likes-count', UserRole.User).expect(200);
      const res = await get('/likes-list', UserRole.User).expect(403);
      expect(res.body.details).toEqual({ entitlement: 'see_who_liked_me' });
    });
  });
});

describe('EntitlementsService (Free plan stub)', () => {
  let service: EntitlementsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EntitlementsModule] }).compile();
    service = moduleRef.get(EntitlementsService);
  });

  it('returns the Free column of the M21 plan matrix', async () => {
    expect(await service.limit(USER_ID, EntitlementKey.DailyLikes)).toBe(25);
    expect(await service.limit(USER_ID, EntitlementKey.UndoPass)).toBe(0);
    expect(await service.limit(USER_ID, EntitlementKey.PriorityLikes)).toBe(0);
    expect(await service.limit(USER_ID, EntitlementKey.BoostsPerMonth)).toBe(0);
    expect(await service.limit(USER_ID, EntitlementKey.ContactExchangePerMonth)).toBe(0);
    expect(await service.has(USER_ID, EntitlementKey.DailyLikes)).toBe(true);
    expect(await service.has(USER_ID, EntitlementKey.UndoPass)).toBe(false);
    expect(await service.has(USER_ID, EntitlementKey.AdvancedFilters)).toBe(false);
    expect(await service.has(USER_ID, EntitlementKey.VoiceVideoCalls)).toBe(false);
    expect(await service.has(USER_ID, EntitlementKey.TravelMode)).toBe(false);
    expect(await service.has(USER_ID, EntitlementKey.Incognito)).toBe(false);
    expect((await service.get(USER_ID)).level(EntitlementKey.SeeWhoLikedMe)).toBe('count_only');
  });

  it('covers every entitlement key', () => {
    expect(Object.keys(FREE_PLAN_ENTITLEMENTS).sort()).toEqual(Object.values(EntitlementKey).sort());
  });

  it('models unlimited quotas and level ordering for later plans', () => {
    const plus = new UserEntitlements({
      ...FREE_PLAN_ENTITLEMENTS,
      [EntitlementKey.DailyLikes]: { kind: 'quota', limit: null, period: 'day' },
      [EntitlementKey.AdvancedFilters]: { kind: 'level', level: 'all', levels: ADVANCED_FILTER_LEVELS },
    });
    expect(plus.limit(EntitlementKey.DailyLikes)).toBeNull();
    expect(plus.has(EntitlementKey.DailyLikes)).toBe(true);
    expect(plus.has(EntitlementKey.AdvancedFilters, 'basic')).toBe(true);
    expect(() => plus.has(EntitlementKey.AdvancedFilters, 'gold')).toThrow(/Unknown level/);
    expect(() => plus.limit(EntitlementKey.Incognito)).toThrow(/not a quota/);
  });
});
