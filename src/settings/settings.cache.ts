import { redisKey } from '../infra/redis/redis-keys';

/** guide M08: catalogue and config reads are cached for 10 minutes. */
export const SETTINGS_CACHE_TTL_SECONDS = 600;

export const SETTINGS_CACHE_KEY = redisKey('settings', 'all');
export const APP_CONFIG_CACHE_KEY = redisKey('app-config', 'v1');
export const CATALOG_INTERESTS_CACHE_KEY = redisKey('catalog', 'interests');
export const CATALOG_PROMPTS_CACHE_KEY = redisKey('catalog', 'prompts');

/** Every key set() drops, so a change shows on the next read. */
export const SETTINGS_DEPENDENT_CACHE_KEYS = [SETTINGS_CACHE_KEY, APP_CONFIG_CACHE_KEY, CATALOG_INTERESTS_CACHE_KEY, CATALOG_PROMPTS_CACHE_KEY];
