import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("dashboard loyalty is Core D1 only", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const service = read("src/services/CoreClientService.ts");
  const repo = read("workers/core/repositories/clients.js");

  assert.match(
    page,
    /CoreClientService\.list\(search\.trim\(\), \{ includeLoyalty: true \}\)/
  );
  assert.match(
    page,
    /CoreClientService\.list\(searchRef\.current\.trim\(\), \{ includeLoyalty: true \}\)/
  );
  assert.match(page, /CoreClientService\.loyaltySummary\(\)/);
  assert.match(page, /CoreClientService\.patch\(client\.id, \{ vip: nextVip \}\)/);

  assert.doesNotMatch(page, /firebase\/firestore|services\/firebase|FirestoreReadStats/);
  assert.doesNotMatch(page, /\b(getDoc|getDocs|setDoc|updateDoc|collection|doc)\b/);
  assert.doesNotMatch(page, /const filtered = useMemo|clients\.filter\(/);

  assert.match(service, /includeLoyalty/);
  assert.match(service, /loyaltyBalance/);
  assert.match(service, /\/api\/core\/clients\/loyalty-summary/);

  assert.match(repo, /WITH completed_bookings AS/);
  assert.match(repo, /FROM bookings/);
  assert.match(repo, /status = 'completed'/);
  assert.match(repo, /LEFT JOIN refunds r/);
  assert.match(repo, /r\.status = 'completed'/);
  assert.match(repo, /MIN\(\s*cb\.earned_points/);

  assert.match(repo, /FROM loyalty_point_transactions/);
  assert.match(repo, /type IN \('redeem', 'adjustment'\)/);

  assert.doesNotMatch(
    repo,
    /SUM\(CASE WHEN type = 'earn' THEN points ELSE 0 END\)/
  );
  assert.doesNotMatch(
    repo,
    /SUM\(CASE WHEN type = 'refund' THEN points ELSE 0 END\)/
  );
});

test("dashboard loyalty summary covers the full salon, not the bounded client rows", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const repo = read("workers/core/repositories/clients.js");

  const summaryUses = page.match(/formatNumber\(summary\.totalClients\)/g) || [];
  assert.ok(
    summaryUses.length >= 2,
    "header and total-clients metric must both use the full-salon summary"
  );

  assert.match(page, /حد العرض 500/);
  assert.match(repo, /COUNT\(\*\) AS total_clients/);
  assert.match(repo, /SUM\(CASE WHEN vip = 1 THEN 1 ELSE 0 END\)/);
  assert.match(repo, /SUM\(CASE WHEN loyalty_balance > 0 THEN 1 ELSE 0 END\)/);
  assert.match(repo, /SUM\(loyalty_balance\)/);
});

test("dashboard loyalty search runs in Core before the 500-row bound", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const repo = read("workers/core/repositories/clients.js");

  assert.match(page, /window\.setTimeout\(\(\) => \{/);
  assert.match(page, /\}, 300\)/);
  assert.match(page, /generation !== loadGenerationRef\.current/);
  assert.match(page, /searchRef\.current = value/);

  const listStart = repo.indexOf("export async function listClients");
  const summaryStart = repo.indexOf("export async function getClientLoyaltySummary");

  assert.ok(listStart >= 0, "listClients must exist");
  assert.ok(summaryStart > listStart, "loyalty summary must follow listClients");

  const listSection = repo.slice(listStart, summaryStart);

  assert.match(
    listSection,
    /INSTR\(LOWER\(COALESCE\(c\.name, ''\)\), \?\) > 0/
  );
  assert.doesNotMatch(listSection, / LIKE \?/);
  assert.doesNotMatch(listSection, /%\$\{search\}%/);

  const loyaltyFilter = listSection.indexOf(
    "WHERE c.salon_id = ?${searchClause}"
  );
  const loyaltyLimit = listSection.indexOf("LIMIT 500", loyaltyFilter);

  assert.ok(loyaltyFilter >= 0, "loyalty SQL search clause must exist");
  assert.ok(
    loyaltyLimit > loyaltyFilter,
    "loyalty search must execute before LIMIT 500"
  );

  const plainFilter = listSection.indexOf(
    "WHERE salon_id = ?${plainSearchClause}"
  );
  const plainLimit = listSection.indexOf("LIMIT 500", plainFilter);

  assert.ok(plainFilter >= 0, "plain client SQL search clause must exist");
  assert.ok(
    plainLimit > plainFilter,
    "plain client search must execute before LIMIT 500"
  );
});

test("dashboard loyalty summary is one canonical Core query without N+1 repair", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");
  const repo = read("workers/core/repositories/clients.js");

  assert.doesNotMatch(page, /\.map\([^)]*CoreClientService\.overview/);

  assert.match(repo, /booking_loyalty AS/);
  assert.match(repo, /manual_loyalty AS/);
  assert.match(repo, /LEFT JOIN booking_loyalty bl/);
  assert.match(repo, /LEFT JOIN manual_loyalty ml/);
});

test("automatic loyalty truth is derived from bookings and refunds, not generated ledger rows", () => {
  const repo = read("workers/core/repositories/clients.js");

  assert.match(
    repo,
    /CAST\(COALESCE\(total_halalas, 0\) \/ 100 AS INTEGER\) AS earned_points/
  );
  assert.match(repo, /r\.booking_id = cb\.id/);
  assert.match(repo, /SUM\(COALESCE\(rb\.reversed_points, 0\)\)/);

  const manualStart = repo.indexOf("manual_loyalty AS");
  const manualEnd = repo.indexOf("SELECT", repo.indexOf(")", manualStart) + 1);
  const manualSection = repo.slice(
    manualStart,
    manualEnd > manualStart ? manualEnd : undefined
  );

  assert.doesNotMatch(manualSection, /type = 'earn'/);
  assert.doesNotMatch(manualSection, /type = 'refund'/);
});

test("VIP canonical write is not reported as failed when only summary refresh fails", () => {
  const page = read("src/pages/DashboardLoyalty.tsx");

  const toggleStart = page.indexOf("const toggleVip");
  const toggleEnd = page.indexOf("useEffect(() => {", toggleStart);

  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart);

  const section = page.slice(toggleStart, toggleEnd);

  const patchPos = section.indexOf("CoreClientService.patch");
  const clientUpdatePos = section.indexOf("setClients((current)");
  const summaryGenerationPos = section.indexOf(
    "++summaryGenerationRef.current"
  );
  const summaryPos = section.indexOf("CoreClientService.loyaltySummary()");

  assert.ok(patchPos >= 0);
  assert.ok(clientUpdatePos > patchPos);
  assert.ok(summaryGenerationPos > clientUpdatePos);
  assert.ok(summaryPos > summaryGenerationPos);
  assert.match(
    section,
    /summaryGeneration === summaryGenerationRef\.current/
  );

  assert.match(
    section,
    /تم تحديث حالة VIP في Core D1، لكن تعذر تحديث/
  );
});
