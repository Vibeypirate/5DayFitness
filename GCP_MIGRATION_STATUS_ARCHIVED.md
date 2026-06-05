# GCP Migration Status (ARCHIVED)

> **This document is archived.** The bot was migrated from GCP to Railway on 2026-06-05.
> All GCP infrastructure (Cloud Run, Cloud SQL, Secret Manager) has been decommissioned.
> Current platform: Railway (`https://fitness-tracker-bot-production.up.railway.app`)

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

- **Service URL**: `https://fitness-tracker-bot-807329620690.us-central1.run.app`
- **Health Check**: `GET /health` → `200 OK` ✅
- **Prisma Migrations**: All 8 migrations applied successfully ✅
- **Database Connection**: Connected to Cloud SQL via Unix socket ✅
- **Telegram Webhook**: Set and verified ✅

### Bug Fix

Fixed a critical UTF-8 BOM in `prisma/migrations/20260428234001_add_expiry_reminder_sent_at/migration.sql` that was causing PostgreSQL syntax errors on deploy. Pushed to GitHub.

---

## Migration Complete ✅

The bot has been deployed to GCP Cloud Run with the new Telegram bot token and webhook secret.

- **Token updated** in Secret Manager (`telegram-bot-token` version 3)
- **Webhook secret rotated** (`telegram-webhook-secret` version 3)
- **Cloud Run redeployed** with latest secrets
- **Telegram webhook set** and confirmed by Telegram API

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
