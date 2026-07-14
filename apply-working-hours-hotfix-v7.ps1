$ErrorActionPreference = 'Stop'

$projectRoot = (Get-Location).Path
$patchRoot = Join-Path $PSScriptRoot 'patch-files'
$componentSource = Join-Path $patchRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx'
$componentTarget = Join-Path $projectRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx'
$cssPatchSource = Join-Path $PSScriptRoot 'employee-working-hours-hotfix-v7.css'
$cssTarget = Join-Path $projectRoot 'src\styles\AdminHrEmployeeProfilePage.css'

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
  throw 'Run this script from the queens-salon-web project folder.'
}

foreach ($requiredPath in @($componentSource, $componentTarget, $cssPatchSource, $cssTarget)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required file was not found: $requiredPath"
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $projectRoot ".chatgpt-backups\working-hours-v7-$stamp"
New-Item -ItemType Directory -Path (Join-Path $backupRoot 'src\pages\dashboardEmployees') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $backupRoot 'src\styles') -Force | Out-Null

Copy-Item $componentTarget (Join-Path $backupRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx') -Force
Copy-Item $cssTarget (Join-Path $backupRoot 'src\styles\AdminHrEmployeeProfilePage.css') -Force
Copy-Item $componentSource $componentTarget -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$css = [System.IO.File]::ReadAllText($cssTarget, [System.Text.Encoding]::UTF8)
$markerPattern = '(?s)\r?\n?/\* EMPLOYEE WORKING HOURS HOTFIX V7 START \*/.*?/\* EMPLOYEE WORKING HOURS HOTFIX V7 END \*/\r?\n?'
$css = [regex]::Replace($css, $markerPattern, "`r`n")
$patchCss = [System.IO.File]::ReadAllText($cssPatchSource, [System.Text.Encoding]::UTF8)
$css = $css.TrimEnd() + "`r`n`r`n" + $patchCss.Trim() + "`r`n"
[System.IO.File]::WriteAllText($cssTarget, $css, $utf8NoBom)

Write-Host ''
Write-Host 'Working-hours hotfix V7 applied successfully.' -ForegroundColor Green
Write-Host 'Fixed status icon encoding and full-width overrides editor.' -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Write-Host 'Refresh the browser with Ctrl + Shift + R.' -ForegroundColor Cyan
