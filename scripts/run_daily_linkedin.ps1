# LinkedIn Pain Point Scraper — Daily Pipeline Script
# Run by Windows Task Scheduler once per day.
#
# Usage (manual):
#   .\scripts\run_daily_linkedin.ps1
#
# The script:
#   1. Activates the Python virtual environment (if present)
#   2. Loads .env variables
#   3. Runs db-migrate to ensure schema is current
#   4. Runs the full daily pipeline
#   5. Logs all output to logs/daily_linkedin_YYYY-MM-DD.log

param(
    [string]$WorkspaceRoot = $PSScriptRoot | Split-Path -Parent,
    [switch]$PriorityOnly,
    [int]$MaxPages = 0,
    [int]$MaxExpand = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$LogDir       = Join-Path $WorkspaceRoot "logs"
$EnvFile      = Join-Path $WorkspaceRoot ".env"
$VenvPython   = Join-Path $WorkspaceRoot ".venv\Scripts\python.exe"
$SystemPython = "python"

$DateStamp    = Get-Date -Format "yyyy-MM-dd"
$LogFile      = Join-Path $LogDir "daily_linkedin_$DateStamp.log"

# Ensure log directory exists
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

# ---------------------------------------------------------------------------
# Logging helper
# ---------------------------------------------------------------------------

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts  [$Level]  $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------

if (Test-Path $EnvFile) {
    Write-Log "Loading .env from $EnvFile"
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            $key   = $Matches[1].Trim()
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
} else {
    Write-Log "No .env file found at $EnvFile — using system environment variables." "WARNING"
}

# ---------------------------------------------------------------------------
# Resolve Python executable
# ---------------------------------------------------------------------------

if (Test-Path $VenvPython) {
    $Python = $VenvPython
    Write-Log "Using venv Python: $Python"
} else {
    $Python = $SystemPython
    Write-Log "Using system Python: $Python"
}

# ---------------------------------------------------------------------------
# Build CLI arguments
# ---------------------------------------------------------------------------

$RunArgs = @("run-daily")

if ($PriorityOnly) {
    $RunArgs += "--priority-only"
}
if ($MaxPages -gt 0) {
    $RunArgs += "--max-pages", $MaxPages
}
if ($MaxExpand -gt 0) {
    $RunArgs += "--max-expand", $MaxExpand
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

Write-Log "=== LinkedIn Daily Pipeline START ===" "INFO"
Write-Log "Working directory: $WorkspaceRoot"
Write-Log "Log file: $LogFile"

Push-Location $WorkspaceRoot

try {
    # 1. Ensure DB schema is current
    Write-Log "Step 1: db-migrate"
    & $Python -m linkedin_scraper.cli db-migrate 2>&1 | Tee-Object -Append -FilePath $LogFile
    if ($LASTEXITCODE -ne 0) { throw "db-migrate failed with exit code $LASTEXITCODE" }

    # 2. Run daily pipeline
    Write-Log "Step 2: run-daily ($($RunArgs -join ' '))"
    & $Python -m linkedin_scraper.cli @RunArgs 2>&1 | Tee-Object -Append -FilePath $LogFile
    if ($LASTEXITCODE -ne 0) { throw "run-daily failed with exit code $LASTEXITCODE" }

    Write-Log "=== LinkedIn Daily Pipeline COMPLETE ===" "INFO"

} catch {
    Write-Log "PIPELINE FAILED: $_" "ERROR"
    exit 1
} finally {
    Pop-Location
}
