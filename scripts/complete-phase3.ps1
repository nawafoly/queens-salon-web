$ErrorActionPreference = "Stop"
Set-Location "C:\Users\nawaf\Downloads\queens-salon-web"

Write-Host "1/6 Applying final client merge migration..." -ForegroundColor Cyan
npx wrangler d1 migrations apply queens-salon-core --remote --config .\wrangler.core.jsonc
if ($LASTEXITCODE -ne 0) { throw "Core migration failed." }

Write-Host "2/6 Rechecking duplicate identities..." -ForegroundColor Cyan
npm run dedupe:core-clients:dry
if ($LASTEXITCODE -ne 0) { throw "Client dedupe dry-run failed." }

$dedup = Get-Content .\core-client-dedup-main.sql.report.json -Raw | ConvertFrom-Json
if ([int]$dedup.blockingGroupCount -ne 0) {
    $dedup.blockingGroups | ConvertTo-Json -Depth 20
    throw "Blocking client groups still exist: $($dedup.blockingGroupCount)"
}

Write-Host "3/6 Regenerating package-to-Core dry-run..." -ForegroundColor Cyan
npm run migrate:packages-to-core:dry
if ($LASTEXITCODE -ne 0) { throw "Packages-to-Core dry-run failed." }

$packages = Get-Content .\packages-to-core-main.sql.report.json -Raw | ConvertFrom-Json
$packages | Select-Object coreClientsMatched,coreClientsCreated,aliasesCreated,catalogRows,clientPackageRows,transactionRows | Format-List

Write-Host "4/6 Applying package data migration with automatic backups..." -ForegroundColor Cyan
npm run migrate:packages-to-core
if ($LASTEXITCODE -ne 0) { throw "Packages-to-Core apply failed." }

Write-Host "5/6 Verifying remote Core package counts..." -ForegroundColor Cyan
npx wrangler d1 execute queens-salon-core --remote --config .\wrangler.core.jsonc --command "SELECT 'package_catalog' AS table_name,COUNT(*) AS row_count FROM package_catalog WHERE salon_id='main' UNION ALL SELECT 'client_packages',COUNT(*) FROM client_packages WHERE salon_id='main' UNION ALL SELECT 'package_transactions',COUNT(*) FROM package_transactions WHERE salon_id='main';"
if ($LASTEXITCODE -ne 0) { throw "Remote package verification failed." }

Write-Host "6/6 Running unified tests and build..." -ForegroundColor Cyan
npm run verify:core:unified
if ($LASTEXITCODE -ne 0) { throw "Unified verification failed." }

Write-Host ""
Write-Host "PHASE 3 COMPLETE" -ForegroundColor Green
Write-Host "BlockingGroups: $($dedup.blockingGroupCount)"
Write-Host "CatalogRows: $($packages.catalogRows)"
Write-Host "ClientPackages: $($packages.clientPackageRows)"
Write-Host "Transactions: $($packages.transactionRows)"
