# One-time setup script for Windows Task Scheduler.
# Creates two scheduled tasks:
#   1. LinkedIn Daily Pipeline  — runs at 6:00 AM every day
#   2. LinkedIn Comment Hunt    — runs at 2:00 PM every day
#
# Run this script ONCE as Administrator:
#   Right-click PowerShell -> "Run as Administrator"
#   .\scripts\setup_schedule.ps1

param(
    [string]$WorkspaceRoot = $PSScriptRoot | Split-Path -Parent,
    [string]$DailyTime     = "06:00",
    [string]$HuntTime      = "14:00",
    [string]$TaskUser      = $env:USERNAME
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VenvPython   = Join-Path $WorkspaceRoot ".venv\Scripts\powershell.exe"
$PowerShell   = "powershell.exe"

$DailyScript  = Join-Path $WorkspaceRoot "scripts\run_daily_linkedin.ps1"
$HuntScript   = Join-Path $WorkspaceRoot "scripts\run_comment_hunt.ps1"

$DailyAction  = New-ScheduledTaskAction `
    -Execute $PowerShell `
    -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -File `"$DailyScript`"" `
    -WorkingDirectory $WorkspaceRoot

$HuntAction   = New-ScheduledTaskAction `
    -Execute $PowerShell `
    -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -File `"$HuntScript`"" `
    -WorkingDirectory $WorkspaceRoot

$DailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
$HuntTrigger  = New-ScheduledTaskTrigger -Daily -At $HuntTime

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable

function Register-OrUpdate {
    param($Name, $Action, $Trigger)
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Write-Host "Updating existing task: $Name"
        Set-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Settings $Settings
    } else {
        Write-Host "Creating new task: $Name"
        Register-ScheduledTask `
            -TaskName $Name `
            -Action $Action `
            -Trigger $Trigger `
            -Settings $Settings `
            -RunLevel Highest `
            -Force
    }
}

Register-OrUpdate -Name "LinkedIn Daily Pipeline"  -Action $DailyAction -Trigger $DailyTrigger
Register-OrUpdate -Name "LinkedIn Comment Hunt"    -Action $HuntAction  -Trigger $HuntTrigger

Write-Host ""
Write-Host "=== Scheduled tasks created ==="
Write-Host "  LinkedIn Daily Pipeline  -> every day at $DailyTime"
Write-Host "  LinkedIn Comment Hunt    -> every day at $HuntTime"
Write-Host ""
Write-Host "To verify: Get-ScheduledTask -TaskName 'LinkedIn Daily Pipeline'"
Write-Host "To run now: Start-ScheduledTask -TaskName 'LinkedIn Daily Pipeline'"
Write-Host "To disable: Disable-ScheduledTask -TaskName 'LinkedIn Daily Pipeline'"
