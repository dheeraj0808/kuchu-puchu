import 'reflect-metadata';

import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';

import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateProfileDto } from './create-profile.dto';
import { UpdateProfileDto } from './update-profile.dto';

const pipe = createValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });

const isoYearsAgo = (years: number, dayOffset = 0): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
};

const valid = { displayName: 'Priya', dateOfBirth: '1998-04-21', gender: 'woman' };

async function errorsFor(body: unknown, type: ArgumentMetadata['metatype'] = CreateProfileDto): Promise<string[]> {
  try {
    await pipe.transform(body, meta(type));
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const res = (e as BadRequestException).getResponse() as { message: string[] };
    return res.message;
  }
}

describe('CreateProfileDto validation', () => {
  it('accepts a minimal valid profile and sanitizes text', async () => {
    const dto = (await pipe.transform(
      { ...valid, displayName: '  Priya​  ', bio: '  Hi  there  ', occupation: '' },
      meta(CreateProfileDto),
    )) as CreateProfileDto;
    expect(dto).toBeInstanceOf(CreateProfileDto);
    expect(dto.displayName).toBe('Priya');
    expect(dto.bio).toBe('Hi there');
    expect(dto.occupation).toBeNull();
  });

  it('rejects a future date of birth', async () => {
    const future = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10);
    expect((await errorsFor({ ...valid, dateOfBirth: future })).join()).toMatch(/dateOfBirth/);
  });

  it('enforces the minimum dating age (18)', async () => {
    expect(await errorsFor({ ...valid, dateOfBirth: isoYearsAgo(18, 1) })).not.toHaveLength(0);
    expect(await errorsFor({ ...valid, dateOfBirth: isoYearsAgo(18, -1) })).toHaveLength(0);
  });

  it('rejects impossible or malformed dates', async () => {
    for (const dateOfBirth of ['2001-02-29', '21/04/1998', '1998-4-21', 19980421, '1900-01-01']) {
      expect(await errorsFor({ ...valid, dateOfBirth })).not.toHaveLength(0);
    }
  });

  it('requires displayName, dateOfBirth and gender', async () => {
    const msgs = (await errorsFor({})).join(' ');
    expect(msgs).toMatch(/displayName/);
    expect(msgs).toMatch(/dateOfBirth/);
    expect(msgs).toMatch(/gender/);
  });

  it('rejects invalid display names', async () => {
    for (const displayName of ['A', 'x'.repeat(51), 'Priya123', '<script>', 'http://spam.io', '   ']) {
      expect(await errorsFor({ ...valid, displayName })).not.toHaveLength(0);
    }
  });

  it('rejects invalid gender, long bio and bad location', async () => {
    expect(await errorsFor({ ...valid, gender: 'robot' })).not.toHaveLength(0);
    expect(await errorsFor({ ...valid, bio: 'a'.repeat(501) })).not.toHaveLength(0);
    expect(await errorsFor({ ...valid, location: { latitude: 91, longitude: 0 } })).not.toHaveLength(0);
    expect(await errorsFor({ ...valid, location: { latitude: 10 } })).not.toHaveLength(0);
    expect(await errorsFor({ ...valid, location: { latitude: 10, longitude: 10, country: 'India' } })).not.toHaveLength(0);
  });

  it('accepts a valid location and normalizes country code', async () => {
    const dto = (await pipe.transform(
      { ...valid, location: { latitude: 12.9716, longitude: 77.5946, city: 'Bengaluru', country: 'in' } },
      meta(CreateProfileDto),
    )) as CreateProfileDto;
    expect(dto.location?.country).toBe('IN');
  });

  it('forbids arbitrary and server-controlled fields', async () => {
    for (const extra of [{ profileCompletion: 100 }, { userId: 'someone-else' }, { latitude: 1 }, { isAdmin: true }]) {
      expect((await errorsFor({ ...valid, ...extra })).join()).toMatch(/should not exist/);
    }
  });
});

describe('UpdateProfileDto validation', () => {
  it('allows partial updates and clearing optional fields with null', async () => {
    expect(await errorsFor({ bio: null, location: null }, UpdateProfileDto)).toHaveLength(0);
    expect(await errorsFor({ displayName: 'Asha' }, UpdateProfileDto)).toHaveLength(0);
  });

  it('rejects null for required fields', async () => {
    expect(await errorsFor({ displayName: null }, UpdateProfileDto)).not.toHaveLength(0);
    expect(await errorsFor({ gender: null }, UpdateProfileDto)).not.toHaveLength(0);
  });

  it('does not allow changing date of birth or completion', async () => {
    expect((await errorsFor({ dateOfBirth: '1990-01-01' }, UpdateProfileDto)).join()).toMatch(/should not exist/);
    expect((await errorsFor({ profileCompletion: 100 }, UpdateProfileDto)).join()).toMatch(/should not exist/);
  });
});
