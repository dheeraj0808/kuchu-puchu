import type { SettingsService } from '../settings.service';
import { defaultSettings, type SettingKey, type SettingValues } from '../settings.registry';

/** A SettingsService stand-in for unit tests: registry defaults, overridable per key. */
export function fakeSettings(overrides: Partial<SettingValues> = {}): SettingsService & { values: SettingValues } {
  const values = { ...defaultSettings(), ...overrides };
  return {
    values,
    get: jest.fn(async (key: SettingKey) => values[key]),
    all: jest.fn(async () => ({ ...values })),
  } as unknown as SettingsService & { values: SettingValues };
}
