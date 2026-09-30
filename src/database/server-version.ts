/**
 * The backend targets MySQL 8.4 LTS or newer (guide §3.2). MariaDB and older
 * MySQL are refused, because later modules rely on MySQL-only behaviour:
 * FOR UPDATE SKIP LOCKED semantics (M03 outbox), multi-valued JSON indexes
 * (M10), the native JSON type and the utf8mb4_0900_ai_ci collation.
 */
export const MIN_MYSQL_VERSION: readonly [number, number] = [8, 4];

/** Throws unless `version` (SELECT VERSION()) is MySQL ≥ 8.4. */
export function assertSupportedServer(version: string): void {
  if (/mariadb/i.test(version)) {
    throw new Error(`Unsupported database server: MariaDB ${version}. MySQL 8.4 LTS or newer is required.`);
  }
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`Unrecognised database server version "${version}". MySQL 8.4 LTS or newer is required.`);
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [minMajor, minMinor] = MIN_MYSQL_VERSION;
  if (major < minMajor || (major === minMajor && minor < minMinor)) {
    throw new Error(`Unsupported database server: MySQL ${version}. MySQL 8.4 LTS or newer is required.`);
  }
}
