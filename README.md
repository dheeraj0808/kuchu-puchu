<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
npm install
cp .env.example .env   # then fill in the secrets
```

### Local MySQL 8.4

The backend needs **MySQL 8.4 LTS or newer**. It refuses to start (and `migrate` refuses to run) on MariaDB or older MySQL, because later modules rely on `FOR UPDATE SKIP LOCKED`, multi-valued JSON indexes, the native JSON type and the `utf8mb4_0900_ai_ci` collation.

Locally, MySQL 8.4 runs from Homebrew's keg-only `mysql@8.4` on **127.0.0.1:3307**. It has its own data directory, so it doesn't clash with XAMPP/MariaDB on 3306 or with the Homebrew `mysql` 9.x data in `/opt/homebrew/var/mysql`:

| | |
|---|---|
| Config | `/opt/homebrew/etc/mysql@8.4/my.cnf` |
| Data | `/opt/homebrew/var/mysql@8.4` |
| Root login | `/opt/homebrew/etc/mysql@8.4/root.cnf` (mode 600) |
| App user | `kuchu_puchu`, with access to `kuchu_puchu` and `kuchu_puchu_test` only |

```bash
M=$(brew --prefix mysql@8.4)/bin
# start (it does not start at login; don't use `brew services`, which would use the 9.x data dir)
nohup "$M/mysqld_safe" --defaults-file=/opt/homebrew/etc/mysql@8.4/my.cnf >/dev/null 2>&1 &
# stop
"$M/mysqladmin" --defaults-extra-file=/opt/homebrew/etc/mysql@8.4/root.cnf shutdown
# shell as root
"$M/mysql" --defaults-extra-file=/opt/homebrew/etc/mysql@8.4/root.cnf
```

Use the binaries under `$(brew --prefix mysql@8.4)/bin`. The plain `mysql` on your PATH is the 9.x client.

### Redis

Redis 7 on `REDIS_URL` (default `redis://localhost:6379` outside production). Every key the app writes starts with `kp:`. Rate limits are `kp:throttle:…`; BullMQ queues (from M03) are `kp:queue:…`.

### Database scripts

```bash
npm run db:create        # create DB_NAME (utf8mb4 / utf8mb4_0900_ai_ci) if missing
npm run migrate          # apply pending migrations
npm run migrate:status   # list executed / pending migrations
npm run migrate:down     # revert the last migration (NODE_ENV development/test only)
npm run seed             # run pending seeders (src/database/seeders)
npm run migrate:prod     # production: apply migrations from dist/
```

Migrations are forward-only outside development: never edit one that has run. New tables use `TABLE_OPTIONS_0900`, and every UUID id / FK column uses `uuidColumn()` (`CHAR(36)` `utf8mb4_bin`) from `src/database/migrations/helpers.ts`.

## Compile and run the project

```bash
npm run start        # development
npm run start:dev    # watch mode
npm run start:prod   # production (node dist/main)
```

## Run tests

```bash
npm test             # unit tests (no database or Redis)
npm run test:e2e     # e2e tests: real MySQL + Redis
npm run test:int     # integration tests: two app instances on one Redis, schema checks
npm run test:cov     # unit test coverage
```

### Tests never touch dev data

- **MySQL:** e2e and integration tests always use a dedicated database, `kuchu_puchu_test` by default. You can override it with `TEST_DB_NAME`, but the name must end in `_test` or the run refuses to start (`test/support/test-env.ts`). Before a run, `test/support/global-setup.ts` creates it if needed, applies all migrations and runs the seeders. Connection details (`DB_HOST`, `DB_USER`, `DB_PASSWORD`) come from `.env`; only the database name is replaced. Tests check `SELECT DATABASE()` to prove it.
- **Redis:** tests never use your dev Redis DB. In order of preference (`test/support/test-redis.ts`):
  1. `TEST_REDIS_URL`, if set. It must name a DB index other than 0.
  2. A throwaway **Testcontainers** Redis 7. CI (`CI=true`) requires this.
  3. Without Docker, locally: your local Redis on **DB index 15**.

  Cleanup deletes only `kp:*` keys (via `SCAN` + `DEL`) and refuses to touch DB 0 unless it's a throwaway container. `FLUSHALL` and `FLUSHDB` are never used. Each test worker also refuses to start if `REDIS_URL` isn't a test Redis.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
