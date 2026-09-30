import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { Paginated } from '../pagination/paginated';
import { ResponseInterceptor } from './response.interceptor';

const wrap = (value: unknown) =>
  lastValueFrom(new ResponseInterceptor().intercept({} as ExecutionContext, { handle: () => of(value) } as CallHandler));

describe('ResponseInterceptor', () => {
  it('wraps data as { success, data } with no extra fields', async () => {
    await expect(wrap({ id: 1 })).resolves.toEqual({ success: true, data: { id: 1 } });
  });

  it('adds meta.nextCursor for Paginated results', async () => {
    await expect(wrap(new Paginated([1, 2], 'abc'))).resolves.toEqual({
      success: true,
      data: [1, 2],
      meta: { nextCursor: 'abc' },
    });
    await expect(wrap(new Paginated([], null))).resolves.toEqual({ success: true, data: [], meta: { nextCursor: null } });
  });
});
