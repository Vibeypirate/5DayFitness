# GCP Migration Status

## What's Already Done

All GCP infrastructure has been provisioned and the bot is deployed. Here's what was built:

### Infrastructure (Project: `dayfitness-495010`)

| Resource | Name | Status |
|----------|------|--------|
| Cloud SQL (PostgreSQL 16) | `fitness-tracker-db` | Ready |
| Database | `fitness_tracker` | Created |
| Database user | `fitness_app` | Created |
| Artifact Registry | `fitness-tracker` | Ready |
| Cloud Run | `fitness-tracker-bot` | Deployed & Healthy |
| Secret Manager | `telegram-bot-token` | Placeholder |
| Secret Manager | `telegram-webhook-secret` | Placeholder |
| Secret Manager | `database-url` | Configured |

### Bot Deployment

- **Service URL**: `https://fitness-tracker-bot-d3bthr76uq-uc.a.run.app`
- **Health Check**: `GET /health` → `200 OK` ✅
- **Prisma Migrations**: All 8 migrations applied successfully ✅
- **Database Connection**: Connected to Cloud SQL via Unix socket ✅

### Bug Fix

Fixed a critical UTF-8 BOM in `prisma/migrations/20260428234001_add_expiry_reminder_sent_at/migration.sql` that was causing PostgreSQL syntax errors on deploy. Pushed to GitHub.

---

## What's Needed to Finish

You need to provide **2 pieces of information** to complete the migration and make the bot fully operational:

### 1. Railway DATABASE_URL

This is needed to migrate your existing workout data, user records, and group settings from Railway to Google Cloud SQL.

**How to get it:**
1. Go to https://railway.com/
2. Open your 5DayFitness project
3. Click on your PostgreSQL service
4. Go to the "Connect" tab or "Variables" tab
5. Copy the `DATABASE_URL` value (looks like `postgresql://user:password@host:port/database`)

### 2. New Telegram Bot Token

**Important:** The old token was compromised (noted in `DEPLOYMENT_HANDOFF.md`). You **must** rotate it before the bot can work safely.

**How to get it:**
1. Open Telegram and message @BotFather
2. Send `/mybots`
3. Select `@FiveDayFitness_bot`
4. Tap "API Token" → "Revoke current token"
5. Copy the new token

---

## How to Complete the Migration

Once you have both values, run this single command from the project root:

```powershell
.\scripts\gcp-migrate.ps1
```

It will prompt you for:
1. Railway DATABASE_URL
2. New Telegram bot token

Then it will automatically:
- Dump your Railway database
- Restore it to Cloud SQL
- Update the secrets
- Redeploy Cloud Run with the real token
- Register the Telegram webhook
- Verify everything is healthy

---

## After Migration

1. Add `@FiveDayFitness_bot` to your Telegram fitness group
2. Make sure the bot is an **admin** in the group (needed to see photos due to privacy mode)
3. In BotFather, send `/setprivacy` and select `@FiveDayFitness_bot`, then choose **Disable**
4. In your group, run `/setup`
5. Run `/startchallenge`
6. Test check-in with a photo

---

## Cleanup

Resources accidentally created in the wrong project (`strata-intel-1-486311`) have been deleted:
- ✅ Cloud SQL instance deleted
- ✅ Artifact Registry deleted
- ✅ Cloud Run service deleted
- ✅ Secrets deleted

---

## Estimated GCP Costs

With the current setup (`db-f1-micro`, 1 Cloud Run instance):
- **Cloud SQL**: ~$7-10/month (Always Free tier may cover some of this)
- **Cloud Run**: ~$3-5/month for 1 always-on instance
- **Secret Manager**: Negligible for 3 secrets
- **Total**: ~$10-15/month

Your free credits will easily cover this for a long time.
