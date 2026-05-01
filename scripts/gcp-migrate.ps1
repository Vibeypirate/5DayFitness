# GCP Migration Script for 5DayFitness Bot
# Run this after the bot owner provides the Railway DATABASE_URL and new Telegram bot token.

param(
    [string]$RailwayDatabaseUrl = $(Read-Host "Enter your Railway DATABASE_URL"),
    [string]$TelegramBotToken = $(Read-Host "Enter your new Telegram bot token from BotFather"),
    [string]$GcpProject = "dayfitness-495010",
    [string]$CloudSqlInstance = "dayfitness-495010:us-central1:fitness-tracker-db",
    [string]$CloudRunService = "fitness-tracker-bot",
    [string]$Region = "us-central1"
)

$ErrorActionPreference = "Stop"

Write-Host "=== 5DayFitness Bot GCP Migration ===" -ForegroundColor Cyan
Write-Host ""

# 1. Validate inputs
if (-not $RailwayDatabaseUrl) { throw "Railway DATABASE_URL is required" }
if (-not $TelegramBotToken) { throw "Telegram bot token is required" }

# 2. Generate webhook secret
$webhookSecret = -join ((1..32) | ForEach-Object { Get-Random -Maximum 36 | ForEach-Object { if ($_ -lt 10) { [char](48 + $_) } else { [char](97 + ($_ - 10)) } } })
Write-Host "Generated webhook secret: $webhookSecret" -ForegroundColor Green

# 3. Download Cloud SQL Auth Proxy if needed
$proxyPath = "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyPath)) {
    Write-Host "Downloading Cloud SQL Auth Proxy..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.x64.exe" -OutFile $proxyPath
    Write-Host "Downloaded." -ForegroundColor Green
}

# 4. Start Cloud SQL Auth Proxy on port 5433
Write-Host "Starting Cloud SQL Auth Proxy..." -ForegroundColor Yellow
$proxyJob = Start-Job -ScriptBlock {
    param($path, $instance)
    & $path $instance --port 5433
} -ArgumentList (Resolve-Path $proxyPath).Path, $CloudSqlInstance

Start-Sleep -Seconds 5

# Verify proxy is listening
try {
    $testConnection = Test-NetConnection -ComputerName localhost -Port 5433 -WarningAction SilentlyContinue
    if (-not $testConnection.TcpTestSucceeded) {
        throw "Cloud SQL Auth Proxy is not listening on port 5433"
    }
} catch {
    Stop-Job $proxyJob -ErrorAction SilentlyContinue
    throw "Failed to connect to Cloud SQL Proxy: $_"
}

Write-Host "Cloud SQL Auth Proxy is running on localhost:5433" -ForegroundColor Green

# 5. Dump Railway database
Write-Host "Dumping Railway database..." -ForegroundColor Yellow
$backupFile = "railway-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
docker run --rm postgres:16-alpine pg_dump "$RailwayDatabaseUrl" | Out-File -Encoding utf8 -FilePath $backupFile
Write-Host "Database dumped to $backupFile" -ForegroundColor Green

# 6. Restore to Cloud SQL
Write-Host "Restoring to Google Cloud SQL..." -ForegroundColor Yellow
$cloudSqlUrl = "postgresql://fitness_app:uvwxrt3kyihe56dc@host.docker.internal:5433/fitness_tracker"
docker run --rm -v "${PWD}:/backup" postgres:16-alpine psql "$cloudSqlUrl" -f "/backup/$backupFile"
Write-Host "Restore complete." -ForegroundColor Green

# 7. Stop proxy
Stop-Job $proxyJob -ErrorAction SilentlyContinue
Remove-Job $proxyJob -ErrorAction SilentlyContinue
Write-Host "Cloud SQL Auth Proxy stopped." -ForegroundColor Green

# 8. Update GCP secrets
Write-Host "Updating GCP secrets..." -ForegroundColor Yellow

echo -n $TelegramBotToken | gcloud secrets versions add telegram-bot-token --data-file="-" --project=$GcpProject
echo -n $webhookSecret | gcloud secrets versions add telegram-webhook-secret --data-file="-" --project=$GcpProject

Write-Host "Secrets updated." -ForegroundColor Green

# 9. Redeploy Cloud Run to pick up new secrets
Write-Host "Redeploying Cloud Run service..." -ForegroundColor Yellow
gcloud run deploy $CloudRunService `
    --image=us-central1-docker.pkg.dev/$GcpProject/fitness-tracker/bot:latest `
    --region=$Region `
    --project=$GcpProject `
    --platform=managed `
    --min-instances=1 --max-instances=1 --port=3000 `
    --add-cloudsql-instances=$CloudSqlInstance `
    --set-env-vars="BOT_MODE=webhook" `
    --set-env-vars="DEFAULT_TIMEZONE=Asia/Bangkok" `
    --set-env-vars="LOG_LEVEL=info" `
    --set-env-vars="APP_BASE_URL=https://fitness-tracker-bot-d3bthr76uq-uc.a.run.app" `
    --set-env-vars="NODE_ENV=production" `
    --update-secrets="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest,DATABASE_URL=database-url:latest" `
    --quiet

Write-Host "Cloud Run redeployed." -ForegroundColor Green

# 10. Set Telegram webhook
Write-Host "Setting Telegram webhook..." -ForegroundColor Yellow
$webhookUrl = "https://fitness-tracker-bot-d3bthr76uq-uc.a.run.app/telegram/webhook/$webhookSecret"
$telegramResponse = Invoke-RestMethod -Uri "https://api.telegram.org/bot$TelegramBotToken/setWebhook?url=$webhookUrl" -Method Post
Write-Host "Telegram response: $($telegramResponse | ConvertTo-Json)" -ForegroundColor Green

# 11. Verify health
Write-Host "Verifying health endpoint..." -ForegroundColor Yellow
$healthStatus = (Invoke-WebRequest -Uri "https://fitness-tracker-bot-d3bthr76uq-uc.a.run.app/health" -UseBasicParsing).StatusCode
Write-Host "Health check status: $healthStatus" -ForegroundColor Green

Write-Host ""
Write-Host "=== Migration Complete ===" -ForegroundColor Cyan
Write-Host "Your bot is now running on Google Cloud Run." -ForegroundColor Green
Write-Host "Webhook URL: $webhookUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Add @FiveDayFitness_bot to your Telegram group"
Write-Host "2. Run /setup in the group"
Write-Host "3. Run /startchallenge to begin tracking"
Write-Host "4. Test check-in with a photo"
