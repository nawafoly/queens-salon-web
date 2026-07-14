$ErrorActionPreference = 'Stop'

$projectRoot = (Get-Location).Path
$patchRoot = Join-Path $PSScriptRoot 'patch-files'
$componentSource = Join-Path $patchRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx'
$componentTarget = Join-Path $projectRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx'
$cssPatchSource = Join-Path $PSScriptRoot 'employee-working-hours-redesign-v6.css'
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
$backupRoot = Join-Path $projectRoot ".chatgpt-backups\working-hours-v6-$stamp"
New-Item -ItemType Directory -Path (Join-Path $backupRoot 'src\pages\dashboardEmployees') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $backupRoot 'src\styles') -Force | Out-Null

Copy-Item $componentTarget (Join-Path $backupRoot 'src\pages\dashboardEmployees\BookingSettingsSection.tsx') -Force
Copy-Item $cssTarget (Join-Path $backupRoot 'src\styles\AdminHrEmployeeProfilePage.css') -Force

Copy-Item $componentSource $componentTarget -Force

$css = Get-Content $cssTarget -Raw
$markerPattern = '(?s)\r?\n?/\* EMPLOYEE WORKING HOURS REDESIGN V6 START \*/.*?/\* EMPLOYEE WORKING HOURS REDESIGN V6 END \*/\r?\n?'
$css = [regex]::Replace($css, $markerPattern, "`r`n")
$patchCss = Get-Content $cssPatchSource -Raw
$css = $css.TrimEnd() + "`r`n`r`n" + $patchCss.Trim() + "`r`n"
Set-Content -Path $cssTarget -Value $css -Encoding utf8

Write-Host ''
Write-Host 'Working-hours redesign V6 applied successfully.' -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Write-Host 'Refresh the browser with Ctrl + Shift + R.' -ForegroundColor Cyan
