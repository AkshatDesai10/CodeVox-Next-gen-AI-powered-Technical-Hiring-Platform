param (
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if (-not $SkipBuild) {
    Write-Host "[1/3] Building docker image without cache..." -ForegroundColor Cyan
    docker compose build --no-cache voice_engine
    
    Write-Host "`n[2/3] Starting container..." -ForegroundColor Cyan
    docker compose up -d voice_engine
} else {
    Write-Host "[1/3] Skipping build..." -ForegroundColor Yellow
    Write-Host "[2/3] Skipping container start..." -ForegroundColor Yellow
}

Write-Host "`n[3/3] Verifying file synchronization..." -ForegroundColor Cyan

# Wait for container to be ready to execute commands
Start-Sleep -Seconds 3

# Get all critical top-level python files
$FilesToVerify = Get-ChildItem -File -Filter "*.py" | Select-Object -ExpandProperty Name

$MismatchFound = $false

foreach ($File in $FilesToVerify) {
    # Calculate local MD5
    $LocalHash = (Get-FileHash -Algorithm MD5 -Path $File).Hash.ToLower()
    
    # Calculate container MD5
    $ContainerHashOutput = docker exec voice-engine-voice_engine-1 md5sum $File 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ContainerHashOutput)) {
        Write-Host "  [!] ERROR: Could not find or hash '$File' in container!" -ForegroundColor Red
        $MismatchFound = $true
        continue
    }
    
    $ContainerHash = $ContainerHashOutput.Split(" ")[0].Trim().ToLower()
    
    if ($LocalHash -eq $ContainerHash) {
        Write-Host "  [+] MATCH: $File" -ForegroundColor Green
    } else {
        Write-Host "  [!] MISMATCH: $File" -ForegroundColor Red
        Write-Host "      Local:     $LocalHash" -ForegroundColor Red
        Write-Host "      Container: $ContainerHash" -ForegroundColor Red
        $MismatchFound = $true
    }
}

Write-Host ""
if ($MismatchFound) {
    Write-Host "================================================================" -ForegroundColor Red -BackgroundColor Black
    Write-Host "WARNING: CONTAINER FILES DO NOT MATCH LOCAL FILES!" -ForegroundColor Red -BackgroundColor Black
    Write-Host "The container is running stale code. Rebuild using --no-cache." -ForegroundColor Red -BackgroundColor Black
    Write-Host "================================================================" -ForegroundColor Red -BackgroundColor Black
    exit 1
} else {
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "SUCCESS: All local Python files are perfectly synced in Docker!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    exit 0
}
