const coreBase = String(process.env.CORE_WORKER_URL || "https://queens-salon-core-api.maedin.workers.dev").replace(/\/+$/, "");
const packagesBase = String(process.env.PACKAGES_WORKER_URL || "https://queens-salon-packages-api.maedin.workers.dev").replace(/\/+$/, "");

const checks = [
  { name: "Core sections for /booking", url: `${coreBase}/api/core/sections?active=true`, expected: [200] },
  { name: "Core staff for /booking", url: `${coreBase}/api/core/staff?active=true`, expected: [200] },
  { name: "Core discounts for /booking", url: `${coreBase}/api/core/discounts?active=true`, expected: [200] },
  { name: "Packages health", url: `${packagesBase}/api/packages/health`, expected: [200] },
  { name: "Packages my-wallet route", url: `${packagesBase}/api/packages/my-wallet?salonId=main`, expected: [401] },
  { name: "Packages my-catalog route", url: `${packagesBase}/api/packages/my-catalog?salonId=main`, expected: [401] },
];

let failed = false;
for (const check of checks) {
  try {
    const response = await fetch(check.url, { redirect: "manual" });
    const ok = check.expected.includes(response.status);
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${response.status}`);
    if (!ok) failed = true;
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  console.error("Worker verification failed. Deploy both Core and Packages workers, then retry.");
  process.exit(1);
}

console.log("All client booking and package worker routes are deployed.");
