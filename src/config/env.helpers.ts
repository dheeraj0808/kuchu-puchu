export function envString(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true';
}

export function envList(key: string): string[] {
  return envString(key)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
