import { AccountDeletionRegistry, AccountExportRegistry } from './account-registry';

const handler = (name: string, order: number) => ({ name, order, handle: jest.fn() });

describe('account registries', () => {
  it('deletion handlers run by order (then name); duplicates and bad names fail at boot', () => {
    const registry = new AccountDeletionRegistry();
    registry.register(handler('users', 1000));
    registry.register(handler('auth', 10));
    registry.register(handler('profile.b', 30));
    registry.register(handler('profile.a', 30));
    expect(registry.ordered().map((h) => h.name)).toEqual(['auth', 'profile.a', 'profile.b', 'users']);
    expect(() => registry.register(handler('auth', 5))).toThrow('Duplicate account deletion handler "auth"');
    expect(() => registry.register(handler('Bad Name', 5))).toThrow('Invalid');
    expect(() => registry.register(handler('x', 1.5))).toThrow('integer order');
    // users stays last.
    expect(() => registry.register(handler('late', 1000))).toThrow('nothing may run after it');
    expect(() => registry.register(handler('later', 2000))).toThrow('nothing may run after it');
    expect(() => new AccountDeletionRegistry().register(handler('users', 999))).toThrow('only "users" may use order 1000');
  });

  it('export contributors are listed by name; duplicates fail at boot', () => {
    const registry = new AccountExportRegistry();
    registry.register({ name: 'profile', collect: jest.fn() });
    registry.register({ name: 'account', collect: jest.fn() });
    expect(registry.all().map((c) => c.name)).toEqual(['account', 'profile']);
    expect(() => registry.register({ name: 'account', collect: jest.fn() })).toThrow('Duplicate account export contributor');
  });
});
