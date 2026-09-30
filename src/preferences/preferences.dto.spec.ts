import 'reflect-metadata';

import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';

import { createValidationPipe } from '../common/pipes/validation.pipe';
import { CreatePreferencesDto } from './dto/create-preferences.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { RelationshipIntent } from './models/dating-preference.model';

const pipe = createValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: '' });

const validate = (metatype: typeof CreatePreferencesDto | typeof UpdatePreferencesDto, body: unknown): Promise<unknown> =>
  pipe.transform(body, meta(metatype));

async function errorsFor(
  metatype: typeof CreatePreferencesDto | typeof UpdatePreferencesDto,
  body: unknown,
): Promise<string[]> {
  try {
    await validate(metatype, body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const res = (err as BadRequestException).getResponse() as { message: string[] | string };
    return Array.isArray(res.message) ? res.message : [res.message];
  }
  throw new Error('expected validation to fail');
}

const valid = {
  minAge: 24,
  maxAge: 32,
  preferredGenders: ['woman', 'non_binary'],
  maxDistanceKm: 50,
  relationshipIntent: 'LONG_TERM',
};

describe('CreatePreferencesDto', () => {
  it('accepts a valid payload and transforms to the DTO class', async () => {
    const out = await validate(CreatePreferencesDto, { ...valid });
    expect(out).toBeInstanceOf(CreatePreferencesDto);
    expect(out).toEqual(expect.objectContaining(valid));
  });

  it('accepts minAge === maxAge and the absolute age bounds', async () => {
    await expect(validate(CreatePreferencesDto, { ...valid, minAge: 18, maxAge: 18 })).resolves.toBeDefined();
    await expect(validate(CreatePreferencesDto, { ...valid, minAge: 18, maxAge: 100 })).resolves.toBeDefined();
  });

  it('rejects minAge below 18', async () => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, minAge: 17 });
    expect(errors.some((e) => e.startsWith('minAge'))).toBe(true);
  });

  it('rejects maxAge below minAge in the same payload', async () => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, minAge: 30, maxAge: 25 });
    expect(errors).toContain('maxAge must not be below minAge');
  });

  it('rejects maxAge above 100', async () => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, maxAge: 101 });
    expect(errors.some((e) => e.startsWith('maxAge'))).toBe(true);
  });

  it.each([
    ['minAge', 20.5],
    ['minAge', '25'],
    ['maxAge', 30.1],
    ['maxAge', '30'],
  ])('rejects non-integer %s = %p', async (field, value) => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, [field]: value });
    expect(errors.some((e) => e.startsWith(field))).toBe(true);
  });

  it.each([0, -5, 10.5, '50'])('rejects maxDistanceKm = %p', async (value) => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, maxDistanceKm: value });
    expect(errors.some((e) => e.startsWith('maxDistanceKm'))).toBe(true);
  });

  it.each([
    ['invalid gender', ['robot']],
    ['empty array', []],
    ['duplicates', ['woman', 'woman']],
    ['non-array', 'woman'],
  ])('rejects preferredGenders: %s', async (_label, value) => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, preferredGenders: value });
    expect(errors.some((e) => e.includes('preferredGenders'))).toBe(true);
  });

  it('accepts every gender at once', async () => {
    await expect(
      validate(CreatePreferencesDto, { ...valid, preferredGenders: ['woman', 'man', 'non_binary', 'other'] }),
    ).resolves.toBeDefined();
  });

  it.each(['long_term', 'SOMETIMES', ''])('rejects relationshipIntent = %p', async (value) => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, relationshipIntent: value });
    expect(errors.some((e) => e.startsWith('relationshipIntent'))).toBe(true);
  });

  it.each(Object.values(RelationshipIntent))('accepts relationshipIntent = %s', async (intent) => {
    await expect(validate(CreatePreferencesDto, { ...valid, relationshipIntent: intent })).resolves.toEqual(
      expect.objectContaining({ relationshipIntent: intent }),
    );
  });

  it.each([
    ['userId', '22222222-2222-4222-8222-222222222222'],
    ['id', '11111111-1111-4111-8111-111111111111'],
    ['isConfigured', true],
  ])('rejects unknown field %s', async (field, value) => {
    const errors = await errorsFor(CreatePreferencesDto, { ...valid, [field]: value });
    expect(errors).toContain(`property ${field} should not exist`);
  });

  it.each(Object.keys(valid))('rejects a missing required field: %s', async (field) => {
    const body: Record<string, unknown> = { ...valid };
    delete body[field];
    const errors = await errorsFor(CreatePreferencesDto, body);
    expect(errors.some((e) => e.startsWith(field))).toBe(true);
  });

  it('rejects an empty body', async () => {
    const errors = await errorsFor(CreatePreferencesDto, {});
    for (const field of Object.keys(valid)) {
      expect(errors.some((e) => e.startsWith(field))).toBe(true);
    }
  });
});

describe('UpdatePreferencesDto', () => {
  it('accepts an empty body', async () => {
    await expect(validate(UpdatePreferencesDto, {})).resolves.toBeInstanceOf(UpdatePreferencesDto);
  });

  it.each([
    [{ minAge: 25 }],
    [{ maxAge: 40 }],
    [{ preferredGenders: ['man'] }],
    [{ maxDistanceKm: 10 }],
    [{ relationshipIntent: 'FRIENDS' }],
  ])('accepts a partial payload %p', async (body) => {
    await expect(validate(UpdatePreferencesDto, body)).resolves.toEqual(expect.objectContaining(body));
  });

  it('still rejects maxAge below minAge when both are sent', async () => {
    const errors = await errorsFor(UpdatePreferencesDto, { minAge: 40, maxAge: 30 });
    expect(errors).toContain('maxAge must not be below minAge');
  });

  it.each(Object.keys(valid))('rejects explicit null for %s', async (field) => {
    const errors = await errorsFor(UpdatePreferencesDto, { [field]: null });
    expect(errors.some((e) => e.startsWith(field))).toBe(true);
  });

  it('applies the same field rules as create', async () => {
    await errorsFor(UpdatePreferencesDto, { minAge: 17 });
    await errorsFor(UpdatePreferencesDto, { preferredGenders: [] });
    await errorsFor(UpdatePreferencesDto, { relationshipIntent: 'long_term' });
    await errorsFor(UpdatePreferencesDto, { maxDistanceKm: 0 });
  });

  it('rejects unknown fields', async () => {
    const errors = await errorsFor(UpdatePreferencesDto, { userId: 'x' });
    expect(errors).toContain('property userId should not exist');
  });
});
