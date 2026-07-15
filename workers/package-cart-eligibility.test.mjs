import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPackageCartEligibility } from "../src/helpers/packageCartEligibility.ts";
import {
  originUsesSamePackagesWorker,
  packageWalletDisplayState,
  shouldDiscardCachedWallet,
} from "../src/helpers/packageWalletDiagnostics.ts";

const nowMs = Date.parse("2027-01-01T00:00:00.000Z");

function pkg(overrides = {}) {
  return {
    id: "pkg-a",
    packageNameSnapshot: "Package A",
    allowedServiceIdsSnapshot: ["svc-a"],
    remainingSessions: 10,
    reservedSessions: 0,
    status: "active",
    expiresAt: "2027-12-31T00:00:00.000Z",
    ...overrides,
  };
}

test("single eligible service can redeem from package", () => {
  const [entry] = buildPackageCartEligibility({
    items: [{ id: "cart-a", serviceId: "svc-a" }],
    packages: [pkg()],
    nowMs,
  });

  assert.equal(entry.isPackageEligible, true);
  assert.equal(entry.eligiblePackageId, "pkg-a");
  assert.equal(entry.remainingSessions, 10);
  assert.equal(entry.canRedeem, true);
  assert.equal(entry.paymentMode, "package");
});

test("eligible service plus noneligible service keeps eligibility per cart item", () => {
  const result = buildPackageCartEligibility({
    items: [
      { id: "eligible", serviceId: "svc-a" },
      { id: "cash", serviceId: "svc-x" },
    ],
    packages: [pkg()],
    nowMs,
  });

  assert.equal(result[0].canRedeem, true);
  assert.equal(result[0].paymentMode, "package");
  assert.equal(result[1].isPackageEligible, false);
  assert.equal(result[1].canRedeem, false);
  assert.equal(result[1].paymentMode, "cash/card");
});

test("two eligible services reserve sessions independently inside draft cart", () => {
  const result = buildPackageCartEligibility({
    items: [
      { id: "first", serviceId: "svc-a" },
      { id: "second", serviceId: "svc-a" },
    ],
    packages: [pkg({ remainingSessions: 2 })],
    nowMs,
  });

  assert.equal(result[0].canRedeem, true);
  assert.equal(result[0].remainingSessions, 2);
  assert.equal(result[1].canRedeem, true);
  assert.equal(result[1].remainingSessions, 1);
});

test("one remaining session with two eligible services only covers one item", () => {
  const result = buildPackageCartEligibility({
    items: [
      { id: "first", serviceId: "svc-a" },
      { id: "second", serviceId: "svc-a" },
    ],
    packages: [pkg({ remainingSessions: 1 })],
    nowMs,
  });

  assert.equal(result[0].canRedeem, true);
  assert.equal(result[1].isPackageEligible, true);
  assert.equal(result[1].canRedeem, false);
  assert.equal(result[1].paymentMode, "cash/card");
});

test("same service repeated twice can consume two sessions when balance allows", () => {
  const result = buildPackageCartEligibility({
    items: [
      { id: "repeat-a", serviceId: "svc-a" },
      { id: "repeat-b", serviceId: "svc-a" },
    ],
    packages: [pkg({ remainingSessions: 2 })],
    nowMs,
  });

  assert.deepEqual(result.map((entry) => entry.canRedeem), [true, true]);
  assert.deepEqual(result.map((entry) => entry.paymentMode), ["package", "package"]);
});

test("removing a cart item restores temporary reserved balance for remaining items", () => {
  const before = buildPackageCartEligibility({
    items: [
      { id: "removed", serviceId: "svc-a" },
      { id: "remaining", serviceId: "svc-a" },
    ],
    packages: [pkg({ remainingSessions: 1 })],
    nowMs,
  });
  assert.deepEqual(before.map((entry) => entry.canRedeem), [true, false]);

  const after = buildPackageCartEligibility({
    items: [{ id: "remaining", serviceId: "svc-a" }],
    packages: [pkg({ remainingSessions: 1 })],
    nowMs,
  });
  assert.equal(after[0].canRedeem, true);
  assert.equal(after[0].remainingSessions, 1);
});

test("nearest expiring package is selected by default and explicit selection wins", () => {
  const packages = [
    pkg({ id: "pkg-late", expiresAt: "2027-12-31T00:00:00.000Z" }),
    pkg({ id: "pkg-soon", expiresAt: "2027-02-01T00:00:00.000Z" }),
  ];

  const [auto] = buildPackageCartEligibility({
    items: [{ id: "cart-a", serviceId: "svc-a" }],
    packages,
    nowMs,
  });
  assert.equal(auto.eligiblePackageId, "pkg-soon");

  const [selected] = buildPackageCartEligibility({
    items: [{ id: "cart-a", serviceId: "svc-a" }],
    packages,
    selectedPackageByItemId: { "cart-a": "pkg-late" },
    nowMs,
  });
  assert.equal(selected.eligiblePackageId, "pkg-late");
});

test("wallet display state does not fall back to zero counts on API error", () => {
  const state = packageWalletDisplayState({
    status: "error",
    activePackages: 0,
    totalRemainingSessions: 0,
  });

  assert.equal(state.state, "error");
  assert.equal(state.message, "تعذر تحميل رصيد الباقات");
  assert.equal(state.showZeroFallback, false);
  assert.equal(state.activePackages, undefined);
  assert.equal(state.totalRemainingSessions, undefined);
});

test("stale wallet from previous client is discarded when canonical client changes", () => {
  assert.equal(shouldDiscardCachedWallet({
    cachedLocalClientId: "local-a",
    cachedCanonicalClientId: "canonical-a",
    nextLocalClientId: "local-b",
    nextCanonicalClientId: "canonical-b",
  }), true);
});

test("old localStorage selected client id is discarded when worker returns different canonical id", () => {
  assert.equal(shouldDiscardCachedWallet({
    cachedLocalClientId: "old-local-id",
    nextLocalClientId: "old-local-id",
    nextCanonicalClientId: "canonical-from-worker",
  }), true);
});

test("both production domains are treated as the same packages worker surface", () => {
  const allowedOrigins = [
    "https://queens-salon-web.vercel.app",
    "https://queens-salon-web-gnxk.vercel.app",
  ];

  assert.equal(originUsesSamePackagesWorker({
    origin: "https://queens-salon-web.vercel.app",
    allowedOrigins,
  }), true);
  assert.equal(originUsesSamePackagesWorker({
    origin: "https://queens-salon-web-gnxk.vercel.app",
    allowedOrigins,
  }), true);
});
