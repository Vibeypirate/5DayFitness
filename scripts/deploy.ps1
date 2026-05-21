# Quick deploy script for GCP Cloud Run
# Builds, pushes, and redeploys the bot with zero downtime.

$ErrorActionPreference = "Stop"

$Project = "dayfitness-495010"
$Region = "us-central1"
$Service = "fitness-tracker-bot"
$Image = "us-central1-docker.pkg.dev/$Project/fitness-tracker/bot:latest"

Write-Host "=== Deploying Fitness Tracker Bot ===" -ForegroundColor Cyan

# 1. Build Docker image
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t $Image .

# 2. Push to Artifact Registry
Write-Host "Pushing to Artifact Registry..." -ForegroundColor Yellow
docker push $Image

# 3. Deploy to Cloud Run
Write-Host "Deploying to Cloud Run..." -ForegroundColor Yellow
gcloud run deploy $Service `
    --image=$Image `
    --region=$Region `
    --project=$Project `
    --platform=managed `
    --quiet

Write-Host "" -ForegroundColor Cyan
Write-Host "=== Deploy Complete ===" -ForegroundColor Cyan
Write-Host "Service URL: https://fitness-tracker-bot-d3bthr76uq-uc.a.run.app" -ForegroundColor Green
