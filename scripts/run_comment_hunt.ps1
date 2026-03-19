# LinkedIn Comment Hunt Script
# Run by Windows Task Scheduler at a second time each day (e.g. 2 PM).
# Focuses on priority "Gold Mine" queries only and expands comments
# for any posts not yet expanded.
#
# This keeps the daytime run fast (priority queries only) while the
# morning run handles the full query set.

param(
    [string]$WorkspaceRoot = $PSScriptRoot | Split-Path -Parent,
    [int]$MinComments = 5,
    [int]$Limit = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$LogDir     = Join-Path $WorkspaceRoot "logs"
$EnvFile    = Join-Path $WorkspaceRoot ".env"
$VenvPython = Join-Path $WorkspaceRoot ".venv\Scripts\python.exe"
$DateStamp  = Get-Date -Format "yyyy-MM-dd"
$LogFile    = Join-Path $LogDir "comment_hunt_$DateStamp.log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts  [$Level]  $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim().Trim('"').Trim("'"), "Process")
        }
    }
}

$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

Write-Log "=== Comment Hunt START ==="
Push-Location $WorkspaceRoot

try {
    Write-Log "Step 1: Scraping priority search queries"
    & $Python -m linkedin_scraper.cli run-daily --priority-only --no-csv 2>&1 | Tee-Object -Append -FilePath $LogFile
    if ($LASTEXITCODE -ne 0) { throw "Priority scrape failed" }

    Write-Log "Step 2: Expanding comments (since=24h, min-comments=$MinComments, limit=$Limit)"
    & $Python -m linkedin_scraper.cli scrape-comments --since 24h --min-comments $MinComments --limit $Limit 2>&1 | Tee-Object -Append -FilePath $LogFile
    if ($LASTEXITCODE -ne 0) { throw "scrape-comments failed" }

    Write-Log "Step 3: Export updated CSV"
    & $Python -m linkedin_scraper.cli export-csv --since 1d 2>&1 | Tee-Object -Append -FilePath $LogFile

    Write-Log "=== Comment Hunt COMPLETE ==="
} catch {
    Write-Log "COMMENT HUNT FAILED: $_" "ERROR"
    exit 1
} finally {
    Pop-Location
}
