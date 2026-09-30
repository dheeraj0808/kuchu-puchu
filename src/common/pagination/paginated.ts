/**
 * Return this from a controller to send a list page. ResponseInterceptor turns
 * it into `{ success, data: items, meta: { nextCursor } }` (guide §4.1).
 */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor: string | null,
  ) {}
}
