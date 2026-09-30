import 'reflect-metadata';

import { type ArgumentMetadata, BadRequestException } from '@nestjs/common';

import { createValidationPipe } from '../common/pipes/validation.pipe';
import { uuidv7 } from '../common/utils/uuid';
import { INTEREST_IDS_HARD_CAP, UpdateProfileInterestsDto } from './dto/update-profile-interests.dto';

const meta: ArgumentMetadata = { type: 'body', metatype: UpdateProfileInterestsDto };
const pipe = createValidationPipe();
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const messages = async (body: unknown): Promise<string[]> => {
  const e: unknown = await pipe.transform(body, meta).then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(BadRequestException);
  const res = (e as BadRequestException).getResponse() as { message: string[] };
  return res.message;
};

describe('UpdateProfileInterestsDto validation', () => {
  it('accepts a valid array of UUIDs', async () => {
    const out = (await pipe.transform({ interestIds: [uuid(1), uuid(2)] }, meta)) as UpdateProfileInterestsDto;
    expect(out).toBeInstanceOf(UpdateProfileInterestsDto);
    expect(out.interestIds).toEqual([uuid(1), uuid(2)]);
  });

  it('accepts v7 ids (new rows) alongside v4 ids (seeded rows)', async () => {
    const ids = [uuid(1), uuidv7()];
    const out = (await pipe.transform({ interestIds: ids }, meta)) as UpdateProfileInterestsDto;
    expect(out.interestIds).toEqual(ids);
  });

  it('rejects other UUID versions', async () => {
    const v1 = '6f1c2d3e-4b5a-1c6d-8e7f-9a0b1c2d3e4f';
    expect(await messages({ interestIds: [v1] })).toContain('each value in interestIds must be a UUID');
  });

  it('accepts an empty array', async () => {
    const out = (await pipe.transform({ interestIds: [] }, meta)) as UpdateProfileInterestsDto;
    expect(out.interestIds).toEqual([]);
  });

  it('rejects non-UUIDs', async () => {
    expect(await messages({ interestIds: ['music', 123] })).toContain('each value in interestIds must be a UUID');
  });

  it('rejects duplicate ids', async () => {
    expect(await messages({ interestIds: [uuid(1), uuid(1)] })).toContain('interestIds must not contain duplicates');
  });

  it.each([['string', uuid(1)], ['object', { a: 1 }], ['missing', undefined]])('rejects a non-array (%s)', async (_label, value) => {
    const msgs = await messages(value === undefined ? {} : { interestIds: value });
    expect(msgs).toContain('interestIds must be an array');
  });

  it(`rejects more than ${INTEREST_IDS_HARD_CAP} items`, async () => {
    const ids = Array.from({ length: INTEREST_IDS_HARD_CAP + 1 }, (_, i) => uuid(i + 1));
    expect((await messages({ interestIds: ids })).join(' ')).toMatch(/interestIds must contain no more than 50/);
  });

  it.each(['userId', 'profileId'])('rejects unknown field %s', async (field) => {
    expect(await messages({ interestIds: [uuid(1)], [field]: uuid(9) })).toContain(`property ${field} should not exist`);
  });
});
