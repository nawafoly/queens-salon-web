$ErrorActionPreference = "Stop"

$projectRoot = (Get-Location).Path
$patchRoot = Join-Path $PSScriptRoot "patch-files"

$sourceComponent = Join-Path $patchRoot "src\pages\dashboardEmployees\ServicesSection.tsx"
$sourceCss = Join-Path $patchRoot "employee-services-redesign-v5.css"

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

$currentCss = [System.IO.File]::ReadAllText($targetCss)

$markers = @(
  @("/* EMPLOYEE SERVICES REDESIGN V4 START */", "/* EMPLOYEE SERVICES REDESIGN V4 END */"),
  @("/* EMPLOYEE SERVICES REDESIGN V5 START */", "/* EMPLOYEE SERVICES REDESIGN V5 END */")
)

foreach ($markerPair in $markers) {
  $pattern = "(?s)" + [regex]::Escape($markerPair[0]) + ".*?" + [regex]::Escape($markerPair[1])
  $currentCss = [regex]::Replace($currentCss, $pattern, "").TrimEnd()
}

$fragment = [System.IO.File]::ReadAllText($sourceCss).Trim()
$updatedCss = $currentCss + [Environment]::NewLine + [Environment]::NewLine + $fragment + [Environment]::NewLine

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetCss, $updatedCss, $utf8NoBom)

Write-Host ""
Write-Host "Employee services V5 hotfix applied successfully." -ForegroundColor Green
Write-Host "- Service names now wrap clearly inside cards." -ForegroundColor Cyan
Write-Host "- Selected-services panel now has a real working scroll area." -ForegroundColor Cyan
Write-Host "Backups created with suffix: .bak-$stamp" -ForegroundColor DarkGray
Write-Host "Refresh the browser with Ctrl + Shift + R." -ForegroundColor Yellow
