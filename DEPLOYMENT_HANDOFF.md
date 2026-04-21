# 24/7 Deployment Handoff

This file is the handoff for the next session. The goal is to choose and execute the best production deployment path so `@FiveDayFitness_bot` runs reliably around the clock without depending on a personal computer staying on.

## Current State

- Bot username: `@FiveDayFitness_bot`
- Codebase status:
  - TypeScript build passes
  - Test suite passes
  - Lint passes
  - Dockerfile and `docker-compose.yml` exist
  - Prisma schema and SQL migration exist
- Current runtime modes supported:
  - `BOT_MODE=polling` for local/dev
  - `BOT_MODE=webhook` for production
- Database requirement:
  - PostgreSQL
- Scheduler:
  - In-process cron via `node-cron`
  - Handles reminders and weekly rollups
  - Uses `ScheduledJobLog` for idempotency so duplicate runs are reduced

## Important Security Note

The Telegram bot token was pasted into chat previously. Treat it as compromised.

Before production:

1. Rotate the token in BotFather with `/revoke`.
2. Update local `.env`.
3. Update production secrets in the hosting platform.
4. Confirm the old token no longer works.

Do not proceed to a real public deployment until this is done.

## What Still Needs To Be Done

### Telegram-side

- Disable privacy mode in BotFather with `/setprivacy`
- Ensure `Allow Groups` is enabled
- Optional but recommended:
  - set description
  - set about text
  - set commands
  - set profile photo

### Hosting-side

- Choose hosting platform
- Provision PostgreSQL
- Set environment variables
- Deploy the app
- Switch to `BOT_MODE=webhook`
- Set `APP_BASE_URL`
- Verify webhook registration works
- Confirm scheduler runs in production
- Confirm data persists after restart/redeploy

## Reliability Requirements For Production

The deployment choice should satisfy these:

- App is always on
- Bot survives restarts and deploys
- Database is persistent and backed up
- HTTPS public URL is available for Telegram webhooks
- Reasonable restart behavior on crashes
- Logs are accessible
- Secrets are managed outside the repo
- Minimal operational burden
- Low chance of missing workouts or weekly summary jobs

## Hosting Options To Evaluate Next Session

### Option 1: Railway

Pros:

- Fastest path to deploy
- Good fit for small Node/Postgres services
- Easy environment variable management
- Easy Postgres provisioning
- Simple HTTPS URL

Cons:

- Cost/usage limits need review
- Background worker behavior and always-on guarantees should be verified on selected plan

Questions for next session:

- Best service shape: web service only, or split web/worker if needed?
- Is one always-on service enough for webhook + scheduler?
- What are the restart and health check defaults?

### Option 2: Render

Pros:

- Straightforward web service deployment
- Managed Postgres available
- Stable HTTPS service model

Cons:

- Free tiers and sleeping behavior may be unsuitable
- Need to confirm always-on reliability for cron-like in-process jobs

Questions:

- Do paid plans guarantee no sleeping?
- Is one web service sufficient for this scheduler model?

### Option 3: Fly.io

Pros:

- Good control over always-on app instances
- Strong fit for long-running services
- Can be production-grade with proper config

Cons:

- More operational complexity
- More choices to make around scaling, regions, volumes, and networking

Questions:

- Single VM or app with dedicated Postgres?
- Best region relative to primary users?
- How to avoid multi-instance scheduler duplication if scaled beyond one instance?

### Option 4: VPS

Pros:

- Full control
- Potentially cheapest at some usage levels
- Easy to reason about one long-running process

Cons:

- Highest operational burden
- Must manage OS patches, process manager, backups, reverse proxy, SSL, monitoring

Questions:

- Is the extra control worth the maintenance cost?

## Recommended Initial Direction

Start next session by evaluating Railway first, then Fly.io second.

Reasoning:

- Railway is likely the fastest path to a working always-on MVP.
- Fly.io is a strong fallback if more control or uptime guarantees are needed.
- Render is viable but should be checked carefully for sleep/worker behavior.
- VPS should be the last choice unless explicit control is required.

## Current Recommendation

Choose Railway for the first production deployment.

Why this is the best fit for the current app shape:

- The bot is a single long-running Node process with one webhook endpoint and one in-process scheduler.
- Railway is the lower-ops path for a single always-on web service plus PostgreSQL.
- The app already exposes `GET /health`, which matches Railway's healthcheck model.
- Railway's deploy model supports rollback and redeploy without introducing Fly-specific machine/autostop tuning.

Why Fly.io is second, not first:

- Fly can absolutely run this app well, but it adds more runtime choices that are unnecessary for the MVP:
  - machine sizing
  - autostop/autostart behavior
  - `min_machines_running`
  - region and machine-count tuning
- Those knobs matter more once you need tighter cost/performance control.

Inference from current platform docs:

- Railway is simpler to get to one always-on webhook service with one attached PostgreSQL instance.
- Fly remains the better fallback if you later want deeper control over regions, machines, or HA database topology.

## Architecture Constraints To Keep In Mind

### 1. Webhook is preferred in production

Use webhook mode in production instead of polling.

Why:

- Better fit for hosted environments
- More efficient than long polling
- Less ambiguity around always-running bot connection behavior

Required env vars:

- `BOT_MODE=webhook`
- `APP_BASE_URL=https://<public-domain>`
- `TELEGRAM_WEBHOOK_SECRET=<secret>`
- `DATABASE_URL=<postgres-connection-string>`
- `TELEGRAM_BOT_TOKEN=<rotated-token>`

### 2. Scheduler currently runs in-process

Right now reminders and weekly summaries run from the main Node process.

Implication:

- Best production shape is a single always-on instance.
- Running multiple app instances could cause duplicate scheduler execution attempts, even though `ScheduledJobLog` reduces duplication.

Next-session decision:

- Keep single-instance app for MVP
- Or split scheduler into a dedicated worker service if the platform supports it cleanly

### 3. Database is critical

The bot is not safe to run in production without a durable Postgres instance.

Need to confirm:

- automated backups
- restore process
- connection limits
- region placement

### 4. Timezone correctness matters

Groups use local timezone settings. Weekly rollups and reminders depend on this.

Production verification should include:

- reminder at configured local time
- Sunday night weekly summary
- Monday week boundary behavior
- cross-midnight checkout within 24 hours

## Production Readiness Checklist For Next Session

Use this as the action list:

1. Rotate Telegram bot token.
2. Pick hosting platform.
3. Provision production Postgres.
4. Set production secrets.
5. Deploy app in webhook mode.
6. Register webhook successfully.
7. Add bot to test group.
8. Run `/setup`.
9. Run `/joinchallenge`.
10. Test check-in with photo.
11. Test check-out after minimum duration.
12. Test `/status`, `/leaderboard`, `/weeklysummary`.
13. Test bot restart and verify open sessions persist.
14. Confirm reminder job runs.
15. Confirm logs are visible and useful.
16. Confirm database backups are enabled.

## Questions To Answer Next Session

- Which hosting platform gives the best uptime/reliability tradeoff for this MVP?
- Should webhook and scheduler stay in one service, or should the scheduler become a separate worker?
- Do we need external monitoring or is platform health monitoring enough for now?
- What backup/restore posture is acceptable for the Postgres database?
- Do we need a stronger anti-duplication strategy if we ever scale beyond one instance?

## Suggested First Move Next Session

Do this first:

1. Rotate the Telegram token.
2. Deploy to Railway.
3. Provision Railway PostgreSQL.
4. Wire production secrets and healthcheck.
5. Verify full Telegram flow in a real group.

## Railway Deployment Runbook

Use a single Railway web service and one Railway PostgreSQL service.

### Service shape

- One web service only
- Single replica/instance
- No separate worker for MVP
- `BOT_MODE=webhook`

### Required service settings

- Healthcheck path: `/health`
- Healthcheck port: use Railway `PORT`
- Keep the service single-instance so the in-process scheduler is not duplicated

### Required environment variables

- `NODE_ENV=production`
- `BOT_MODE=webhook`
- `DATABASE_URL=<Railway Postgres DATABASE_URL>`
- `TELEGRAM_BOT_TOKEN=<rotated token>`
- `TELEGRAM_WEBHOOK_SECRET=<random secret>`
- `APP_BASE_URL=https://<railway-public-domain-or-custom-domain>`
- `DEFAULT_TIMEZONE=Asia/Bangkok`
- `LOG_LEVEL=info`

### Deployment steps

1. Rotate the bot token in BotFather.
2. Create a Railway project.
3. Add a PostgreSQL service.
4. Add the app service from this repo.
5. Set the env vars above.
6. Configure the healthcheck path to `/health`.
7. Deploy.
8. Confirm startup logs show Prisma migrations completed, scheduler started, and webhook server listening.
9. Open `/health` on the public URL and confirm HTTP 200.
10. Verify the webhook is registered against `https://<domain>/telegram/webhook/<secret>`.

### Post-deploy validation

1. Add the bot to a real test group.
2. Disable privacy mode in BotFather.
3. Run `/setup`.
4. Run `/joinchallenge`.
5. Test photo check-in.
6. Test photo check-out.
7. Test `/status`, `/leaderboard`, and `/weeklysummary`.
8. Restart or redeploy once and confirm state persists.
9. Confirm reminders still fire after redeploy.

### Outstanding manual prerequisite

Do not expose the production deployment publicly until the compromised Telegram token has been rotated.

## Notes For The Next Session

- The current repo already includes enough to deploy.
- The main missing piece is selecting a hosting target and wiring production secrets.
- Reliability discussion should focus on:
  - always-on runtime
  - webhook stability
  - scheduler behavior
  - database durability
  - operational simplicity
