import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import request from 'supertest';

import { OutboxHarness } from '../support/outbox-harness';
import { clearTestKeys } from '../support/test-redis';

const ROOT = resolve(__dirname, '../..');

interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => done(port));
    });
  });
}

/** Runs an entry file with ts-node, the way `node dist/<entry>.js` runs in a container. */
function start(entry: string, env: Record<string, string | undefined>): Started {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, LOG_LEVEL: 'info', TS_NODE_TRANSPILE_ONLY: 'true', ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];
  const child = spawn(process.execPath, ['-r', 'ts-node/register', entry], { cwd: ROOT, env: childEnv });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.once('exit', (code, signal) => done({ code, signal })),
  );
  return { child, output: () => out, exited };
}

async function waitFor(started: Started, text: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!started.output().includes(text)) {
    if (started.child.exitCode !== null) throw new Error(`exited before "${text}":\n${started.output()}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for "${text}":\n${started.output()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function stopGracefully(started: Started, role: string): Promise<void> {
  started.child.kill('SIGTERM');
  const { code } = await started.exited;
  expect(code).toBe(0);
  expect(started.output()).toContain(`${role} stopped`);
}

describe('entry points (APP_ROLE)', () => {
  const running: Started[] = [];

  afterEach(() => {
    for (const s of running.splice(0)) if (s.child.exitCode === null) s.child.kill('SIGKILL');
  });

  it('api: serves /api/v1 and shuts down cleanly on SIGTERM', async () => {
    const port = await freePort();
    const api = start('src/main.ts', { APP_ROLE: 'api', PORT: String(port) });
    running.push(api);
    await waitFor(api, 'api ready');
    await request(`http://127.0.0.1:${port}`).get('/api/v1/health').expect(200, { success: true, data: { status: 'ok' } });
    await stopGracefully(api, 'api');
  });

  it('realtime: serves health for the load balancer, no API docs, shuts down cleanly', async () => {
    const port = await freePort();
    const rt = start('src/main.ts', { APP_ROLE: 'realtime', PORT: String(port), SWAGGER_ENABLED: 'true' });
    running.push(rt);
    await waitFor(rt, 'realtime ready');
    const base = `http://127.0.0.1:${port}`;
    await request(base).get('/api/v1/health').expect(200);
    await request(base).get('/api/docs').expect(404);
    await request(base).get('/api/v1/auth/me').expect(404); // no API routes in this process
    await stopGracefully(rt, 'realtime');
  });

  it('worker: starts without an HTTP server and shuts down cleanly', async () => {
    const worker = start('src/main.ts', { APP_ROLE: 'worker' });
    running.push(worker);
    await waitFor(worker, 'worker ready');
    expect(worker.output()).toContain('Job schedulers registered: outbox.relay, outbox.cleanup, security.retention');
    await stopGracefully(worker, 'worker');
  });

  it('worker.ts can be started directly without APP_ROLE', async () => {
    const worker = start('src/worker.ts', { APP_ROLE: undefined });
    running.push(worker);
    await waitFor(worker, 'worker ready');
    await stopGracefully(worker, 'worker');
  });

  it('refuses to start when APP_ROLE names a different role', async () => {
    const wrong = start('src/worker.ts', { APP_ROLE: 'api' });
    running.push(wrong);
    const { code } = await wrong.exited;
    expect(code).toBe(1);
    expect(wrong.output()).toContain('APP_ROLE=api, but the worker entry point was started');
  });

  it('worker: on SIGTERM an in-flight handler finishes, then the process exits 0', async () => {
    const h = await OutboxHarness.create();
    try {
      await h.truncate();
      await clearTestKeys(process.env.REDIS_URL as string);
      const worker = start('test/support/outbox-worker-fixture.ts', { APP_ROLE: 'worker', FIXTURE_HANDLER_MS: '1500' });
      running.push(worker);
      await waitFor(worker, 'worker ready');
      expect(worker.output()).toContain('Job schedulers registered: outbox.relay, outbox.cleanup, security.retention');

      const [outboxId] = await h.publishMany(1, randomUUID());
      await waitFor(worker, `handler started ${outboxId}`, 15_000);
      worker.child.kill('SIGTERM');
      const { code } = await worker.exited;

      const out = worker.output();
      expect(code).toBe(0);
      expect(out).toContain(`handler finished ${outboxId}`);
      expect(out.indexOf(`handler finished ${outboxId}`)).toBeLessThan(out.indexOf('worker stopped'));
      expect(out).toContain('worker received SIGTERM');
      expect(out.indexOf('worker received SIGTERM')).toBeLessThan(out.indexOf(`handler finished ${outboxId}`));
      const [row] = await h.rows();
      expect(row).toMatchObject({ id: outboxId, status: 'done' });
    } finally {
      await h.close();
    }
  });
});
