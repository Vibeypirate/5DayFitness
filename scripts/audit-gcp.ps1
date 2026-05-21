# Audit missed workouts on GCP Cloud SQL
# Run this to check all historical weeks for missed workouts.

param(
    [string]$GcpProject = "dayfitness-495010",
    [string]$CloudSqlInstance = "dayfitness-495010:us-central1:fitness-tracker-db"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Fitness Tracker Workout Audit ===" -ForegroundColor Cyan
Write-Host ""

# 1. Download Cloud SQL Auth Proxy if needed
$proxyPath = "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyPath)) {
    Write-Host "Downloading Cloud SQL Auth Proxy..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.x64.exe" -OutFile $proxyPath
    Write-Host "Downloaded." -ForegroundColor Green
}

# 2. Start Cloud SQL Auth Proxy on port 5433
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
Write-Host ""

# 3. Run the audit
Write-Host "Running workout audit..." -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow

$env:DATABASE_URL = "postgresql://fitness_app:uvwxrt3kyihe56dc@localhost:5433/fitness_tracker"
npx tsx scripts/audit-missed-workouts.ts

# 4. Stop proxy
Stop-Job $proxyJob -ErrorAction SilentlyContinue
Remove-Job $proxyJob -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Cloud SQL Auth Proxy stopped." -ForegroundColor Green
