$ErrorActionPreference = "Stop"

$projectRoot = (Get-Location).Path
$patchRoot = Join-Path $PSScriptRoot "patch-files"

$sourceComponent = Join-Path $patchRoot "src\pages\dashboardEmployees\ServicesSection.tsx"
$sourceCss = Join-Path $patchRoot "employee-services-redesign.css"

$targetComponent = Join-Path $projectRoot "src\pages\dashboardEmployees\ServicesSection.tsx"
$targetCss = Join-Path $projectRoot "src\styles\AdminHrEmployeeProfilePage.css"

foreach ($requiredPath in @($sourceComponent, $sourceCss, $targetComponent, $targetCss)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required file was not found: $requiredPath"
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $targetComponent "$targetComponent.bak-$stamp" -Force
Copy-Item $targetCss "$targetCss.bak-$stamp" -Force

Copy-Item $sourceComponent $targetComponent -Force

$startMarker = "/* EMPLOYEE SERVICES REDESIGN V4 START */"
$endMarker = "/* EMPLOYEE SERVICES REDESIGN V4 END */"

$currentCss = [System.IO.File]::ReadAllText($targetCss)
$pattern = "(?s)" + [regex]::Escape($startMarker) + ".*?" + [regex]::Escape($endMarker)
$currentCss = [regex]::Replace($currentCss, $pattern, "").TrimEnd()
$fragment = [System.IO.File]::ReadAllText($sourceCss).Trim()
$updatedCss = $currentCss + [Environment]::NewLine + [Environment]::NewLine + $fragment + [Environment]::NewLine

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetCss, $updatedCss, $utf8NoBom)

Write-Host ""
Write-Host "Employee services redesign applied successfully." -ForegroundColor Green
Write-Host "Backups created with suffix: .bak-$stamp" -ForegroundColor DarkGray
Write-Host "Refresh the browser with Ctrl + Shift + R." -ForegroundColor Cyan
