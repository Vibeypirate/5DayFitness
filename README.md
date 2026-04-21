# Telegram Fitness Accountability Bot

Production-minded MVP for Telegram group workout accountability. The bot runs inside Telegram groups, tracks photo-based check-ins and check-outs, enforces a 5-day weekly target, posts rankings, and calculates weekly fixed-pool penalties per group.

## Stack

- Node.js 22
- TypeScript
- grammY
- PostgreSQL
- Prisma ORM
- node-cron
- Vitest
- Docker / docker-compose

## Architecture

- `src/bot`: Telegram transport, commands, admin checks, and photo-caption handlers
- `src/services`: persistence-backed application services for groups, participants, workouts, leaderboards, reminders, exports, and weekly rollups
- `src/domain`: pure business rules for time boundaries, trigger matching, streaks, rankings, penalties, and validation
- `prisma`: database schema, SQL migration, and seed entrypoint
- `tests`: unit coverage for core rule logic plus integration-style workflow scenarios

Core flow:

1. `/setup` creates or refreshes the group record and default settings.
2. `/joinchallenge` enrolls members explicitly.
3. Photo + check-in trigger opens a workout session.
4. Photo + check-out trigger closes the session, validates duration and timing, and credits at most one workout day for the check-in date.
5. Scheduled reminders post to each group at the configured local time.
6. Weekly summary snapshots finalize rankings, streaks, and the penalty ledger.

## Data Model

Main tables:

- `Group`
- `GroupSettings`
- `User`
- `GroupParticipant`
- `WorkoutSession`
- `WorkoutDayCredit`
- `WeeklySnapshot`
- `WeeklyParticipantResult`
- `PenaltyLedger`
- `AdminActionLog`
- `ScheduledJobLog`

Key rules enforced:

- Separate settings and stats per Telegram group
- One credited workout day per participant per local calendar day
- Check-out must be within 24 hours of check-in
- Minimum session duration defaults to 20 minutes
- Workout credit belongs to the local date of the check-in
- Weekly target and penalty are configurable per group
- Scheduled jobs are idempotent through unique job keys in `ScheduledJobLog`

## Local Run

1. Copy `.env.example` to `.env`.
2. Fill `TELEGRAM_BOT_TOKEN`.
3. Start Postgres with `docker compose up -d postgres` or your own database.
4. Install packages with `npm install`.
5. Generate Prisma client: `npm run prisma:generate`
6. Apply migrations: `npm run prisma:deploy`
7. Start the bot in polling mode: `npm run dev`

Default local mode is polling. For production, switch `BOT_MODE=webhook` and set `APP_BASE_URL`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run format`
- `npm run test`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:deploy`
- `npm run prisma:seed`

## Supported Commands

User commands:

- `/setup`
- `/joinchallenge`
- `/leavechallenge`
- `/pausechallenge`
- `/resumechallenge`
- `/help`
- `/rules`
- `/status`
- `/leaderboard`
- `/weeklysummary`
- `/mystats`
- `/groupstats`

Admin commands:

- `/settarget 5`
- `/setpenalty 1000`
- `/settimezone Asia/Bangkok`
- `/setminduration 20`
- `/setremindertime 20:00`
- `/addparticipant @username`
- `/removeparticipant @username`
- `/overridecomplete @username YYYY-MM-DD`
- `/overridepenalty @username 500 manual-adjustment`
- `/exportcsv`

Notes:

- `@username` based admin targeting requires the target user to already exist in the bot database from prior group activity.
- `resetweek` is intentionally not exposed as a destructive manual replay command in the MVP runtime.

## Telegram Behavior

- Valid check-in: photo + caption/text matching a check-in trigger
- Valid check-out: photo + caption/text matching a check-out trigger
- Text-only attempts are rejected
- Duplicate sessions are rejected
- Check-outs with no open session are rejected
- Multiple workouts in one day still count as one credited day

Default trigger phrases:

- Check-in: `check in`, `checking in`, `checkin`, `start workout`, `starting workout`
- Check-out: `check out`, `checking out`, `checkout`, `finished workout`, `done workout`, `finished`

## Weekly Penalty Logic

- Each failed active participant owes the configured penalty amount
- Total failure pool is divided equally among members who met the target
- If nobody met the target, the pool is marked unresolved and logged without distribution
- All entries are persisted in `PenaltyLedger`

## Tests

Coverage includes:

- Workout validation
- Day credit rules
- Streak calculations
- Weekly success/failure logic
- Penalty distribution
- Leaderboard ranking
- Timezone-sensitive week boundaries
- Integration-style check-in/check-out, weekly summary, and admin override scenarios

Run with:

```bash
npm run test
```

## Docker

Local containers:

```bash
docker compose up --build
```

The app container runs Prisma migrations before startup.

## Deploying

### Railway

1. Provision PostgreSQL.
2. Set environment variables from `.env.example`.
3. Set `BOT_MODE=webhook`.
4. Set `APP_BASE_URL` to the public HTTPS base URL.
5. Configure the service healthcheck path as `/health`.
6. Keep the app to a single instance because the scheduler runs in-process.
7. Deploy with start command:

```bash
npx prisma migrate deploy && node dist/src/index.js
```

8. Build command:

```bash
npm install && npm run prisma:generate && npm run build
```

### Render

Use the same build and start commands as Railway, but verify the plan does not sleep the service. This app needs an always-on instance for webhooks plus in-process scheduled reminders.

### Fly.io

1. Create an app and attach Postgres.
2. Expose port `3000`.
3. Set secrets for bot token, database URL, webhook secret, and app base URL.
4. Use the same build and start commands as above.
5. Disable autostop for the app or keep at least one machine running, because this bot must stay available for webhooks and scheduled jobs.

## BotFather / Telegram Group Settings

Recommended BotFather settings:

- Disable privacy mode so the bot can read group photo captions and text signals
- Set the bot description and command list
- Configure webhook only in production
- Bot username is `@FiveDayFitness_bot`

Recommended group settings:

- Promote the bot to admin if you want consistent message posting and export behavior
- Allow the bot to send messages
- Keep group history visible so the bot can respond in context

### First live setup

You still need to do these steps manually in Telegram:

1. Create or open your target group.
2. Add your own Telegram account to the group.
3. Add `@FiveDayFitness_bot` to the same group.
4. In BotFather, disable privacy mode for the bot with `/setprivacy` so it can read group workout captions and trigger text.
5. Optional but recommended: promote the bot to admin so reminder and summary posting is less likely to get blocked.
6. In the group, run `/setup`.
7. Run `/joinchallenge` for yourself.
8. Test with a photo captioned `checking in`, then later a photo captioned `checking out`.

If you skip step 4, the core natural-language photo flow in groups will not work reliably.

## Operational Notes

- Scheduled reminders and weekly rollups are evaluated every minute and keyed per group to avoid double-processing after restarts.
- Open workout sessions persist in Postgres, so restarts do not lose state.
- Username changes are handled on every interaction by upserting Telegram user profile data.
- AI image validation is intentionally not required for MVP, but `WorkoutSession` stores file IDs so an image-review service can be added later.
