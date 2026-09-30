import { writeSync } from 'node:fs';

import { type INestApplicationContext, Logger } from '@nestjs/common';

import { flushSentry, initSentry } from '../common/monitoring/sentry';
import { AppRole, getValidatedEnv } from '../config/env.validation';

/** A stuck close() must not keep a terminating container alive forever. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Written synchronously: the app logger is async and process.exit() would drop it. */
function fatal(message: string, err?: unknown): void {
  const detail = err === undefined ? '' : `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  writeSync(process.stderr.fd, `${message}${detail}\n`);
}

/**
 * Starts one process type and owns its lifecycle:
 * - refuses to run if APP_ROLE explicitly names a different role;
 * - starts Sentry (only when SENTRY_DSN is set);
 * - on SIGTERM / SIGINT closes the app (HTTP server, DB pool, Redis), then
 *   exits 0; exits 1 if closing takes longer than SHUTDOWN_TIMEOUT_MS;
 * - exits 1 with the reason on stderr if startup fails.
 */
export async function runRole(role: AppRole, start: () => Promise<INestApplicationContext>): Promise<void> {
  try {
    const env = getValidatedEnv();
    if (env.APP_ROLE && env.APP_ROLE !== role) {
      throw new Error(`APP_ROLE=${env.APP_ROLE}, but the ${role} entry point was started`);
    }
    initSentry({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, role });

    const app = await start();
    const logger = new Logger('Bootstrap');
    let closing = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (closing) return;
      closing = true;
      logger.log(`${role} received ${signal}, shutting down`);
      setTimeout(() => {
        fatal(`${role} did not shut down within ${SHUTDOWN_TIMEOUT_MS} ms`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
      void app
        .close()
        .then(() => flushSentry())
        .then(() => {
          logger.log(`${role} stopped`);
          process.exit(0);
        })
        .catch((err: unknown) => {
          fatal(`${role} failed to shut down cleanly`, err);
          process.exit(1);
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    logger.log(`${role} ready`);
  } catch (err) {
    fatal('Application failed to start', err);
    await flushSentry().catch(() => undefined);
    process.exit(1);
  }
}
