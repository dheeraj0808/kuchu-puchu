import { EVENT_TYPES, isEventType } from './event-types';
import { type EventHandler, HandlerRegistry } from './handler-registry';
import { outboxJobId } from './outbox.constants';

const handler = (name: string, eventType = 'match.created'): EventHandler =>
  ({ name, eventType, handle: async () => undefined }) as EventHandler;

describe('HandlerRegistry', () => {
  it('lists handlers per event type in registration order', () => {
    const r = new HandlerRegistry();
    r.register(handler('notifications.match_push'));
    r.register(handler('realtime.match_new'));
    r.register(handler('analytics.registered', 'user.registered'));
    expect(r.handlersFor('match.created').map((h) => h.name)).toEqual(['notifications.match_push', 'realtime.match_new']);
    expect(r.handlersFor('user.registered')).toHaveLength(1);
    expect(r.handlersFor('block.created')).toEqual([]);
    expect(r.handlersFor('not.an_event')).toEqual([]);
    expect(r.get('realtime.match_new')?.eventType).toBe('match.created');
  });

  it.each(['Upper', 'has-dash', 'has space', 'colon:name', '', 'x'.repeat(65)])('rejects the name %p', (name) => {
    expect(() => new HandlerRegistry().register(handler(name))).toThrow(/Invalid handler name/);
  });

  it('rejects a duplicate name, even for another event type', () => {
    const r = new HandlerRegistry();
    r.register(handler('dup.name', 'match.created'));
    expect(() => r.register(handler('dup.name', 'match.ended'))).toThrow(/Duplicate handler name "dup.name"/);
  });

  it('rejects an unknown event type', () => {
    expect(() => new HandlerRegistry().register(handler('x', 'user.deleted'))).toThrow(/unknown event type/);
  });

  it('refuses registrations once sealed (fail fast at boot)', () => {
    const r = new HandlerRegistry();
    r.seal();
    expect(() => r.register(handler('late'))).toThrow(/after the outbox worker started/);
  });

  it('builds BullMQ-safe job ids: never an integer and never a single colon', () => {
    expect(outboxJobId('123', 'notifications.match_push')).toBe('123-notifications.match_push');
    expect(outboxJobId('9007199254740993', 'x')).not.toMatch(/^\d+$/);
  });
});

describe('event types', () => {
  it('match Appendix A, plus the two M07 export events (documented in M07-gap.md)', () => {
    expect([...EVENT_TYPES].sort()).toEqual(
      [
        'user.registered',
        'auth.new_device',
        'auth.token_reuse',
        'user.status_changed',
        'verification.face.approved',
        'verification.face.rejected',
        'verification.id.verified',
        'verification.id.failed',
        'photo.approved',
        'photo.rejected',
        'media.delete',
        'like.created',
        'match.created',
        'match.ended',
        'message.created',
        'message.deleted',
        'block.created',
        'report.created',
        'moderation.action_taken',
        'subscription.activated',
        'subscription.changed',
        'subscription.expired',
        'contact_exchange.requested',
        'contact_exchange.accepted',
        'call.started',
        'call.ended',
        'account.deleted',
        'data_export.requested',
        'data_export.purge',
      ].sort(),
    );
    for (const t of EVENT_TYPES) expect(t.length).toBeLessThanOrEqual(64);
  });

  it('isEventType rejects prototype keys and non-strings', () => {
    expect(isEventType('toString')).toBe(false);
    expect(isEventType('__proto__')).toBe(false);
    expect(isEventType(1)).toBe(false);
    expect(isEventType('match.created')).toBe(true);
  });
});
