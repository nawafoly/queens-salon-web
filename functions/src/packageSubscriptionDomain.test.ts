import test from "node:test";
import assert from "node:assert/strict";
import {
  PackageDomainError,
  adjustRemainingBalance,
  buildPurchasedPackageSnapshot,
  cancelPackage,
  consumeOneReservedSession,
  isEligiblePackage,
  reserveOneSession,
  restoreOneReservedSession,
  selectNearestExpiringPackage,
  transactionId,
  shouldConsumeCancelledReservation,
  DEFAULT_PACKAGE_CANCELLATION_POLICY,
  type PackageBalances,
  type PackageCandidate,
} from "./packageSubscriptionDomain.js";

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function balances(total: number, remaining = total): PackageBalances {
  return {
    totalSessions: total,
    remainingSessions: remaining,
    reservedSessions: 0,
    usedSessions: total - remaining,
    status: remaining > 0 ? "active" : "exhausted",
  };
}

test("builds generic 10-session and 5-session purchase snapshots", () => {
  const ten = buildPurchasedPackageSnapshot({
    name: "Ten visits",
    sessionsCount: 10,
    price: 300,
    allowedServiceIds: ["hair-long", "hair-short"],
    validityDays: 90,
  });
  const five = buildPurchasedPackageSnapshot({
    name: "Five visits",
    sessionsCount: 5,
    price: 175,
    serviceIds: ["hair-short"],
  });
  assert.equal(ten.sessionsCount, 10);
  assert.equal(ten.price, 300);
  assert.deepEqual(ten.allowedServiceIds, ["hair-long", "hair-short"]);
  assert.equal(five.sessionsCount, 5);
  assert.equal(five.price, 175);
});

test("supports a package for a different service type", () => {
  const skin = buildPurchasedPackageSnapshot({
    name: "Skin care",
    sessionsCount: 4,
    price: 500,
    allowedServiceIds: ["facial-cleaning"],
  });
  assert.deepEqual(skin.allowedServiceIds, ["facial-cleaning"]);
});

test("catalog changes do not mutate the sold snapshot", () => {
  const catalog: Record<string, unknown> = {
    name: "Original",
    sessionsCount: 6,
    price: 420,
    allowedServiceIds: ["nails"],
  };
  const sold = buildPurchasedPackageSnapshot(catalog);
  catalog.name = "Changed";
  catalog.sessionsCount = 99;
  catalog.price = 1;
  catalog.allowedServiceIds = ["other"];
  assert.deepEqual(sold, {
    name: "Original",
    sessionsCount: 6,
    price: 420,
    allowedServiceIds: ["nails"],
  });
});

test("rejects unsafe catalog limits and non-finite numeric values", () => {
  for (const catalog of [
    { name: "Too many", sessionsCount: 1001, price: 1, allowedServiceIds: ["service"] },
    { name: "Too expensive", sessionsCount: 1, price: 1_000_000.01, allowedServiceIds: ["service"] },
    { name: "Too long", sessionsCount: 1, price: 1, validityDays: 3651, allowedServiceIds: ["service"] },
    { name: "Not finite", sessionsCount: 1, price: Number.POSITIVE_INFINITY, allowedServiceIds: ["service"] },
    { name: "Path injection", sessionsCount: 1, price: 1, allowedServiceIds: ["services/other"] },
  ]) {
    assert.throws(
      () => buildPurchasedPackageSnapshot(catalog),
      (error: unknown) => error instanceof PackageDomainError
    );
  }
});

test("reserves, consumes, and exhausts the last session", () => {
  const reserved = reserveOneSession(balances(1), NOW);
  assert.equal(reserved.after.remainingSessions, 0);
  assert.equal(reserved.after.reservedSessions, 1);
  assert.equal(reserved.after.status, "active");
  const consumed = consumeOneReservedSession(reserved.after, NOW);
  assert.equal(consumed.after.reservedSessions, 0);
  assert.equal(consumed.after.usedSessions, 1);
  assert.equal(consumed.after.status, "exhausted");
});

test("restores a reserved session after cancellation flow", () => {
  const reserved = reserveOneSession(balances(5), NOW);
  const restored = restoreOneReservedSession(reserved.after, NOW);
  assert.equal(restored.after.remainingSessions, 5);
  assert.equal(restored.after.reservedSessions, 0);
  assert.equal(restored.sessionsDelta, 1);
});

test("stable transaction ids make reserve, consume, restore and purchase idempotent", () => {
  const ledger = new Map<string, string>();
  const applyOnce = (id: string) => {
    if (ledger.has(id)) return false;
    ledger.set(id, id);
    return true;
  };
  const ids = [
    transactionId("purchase", "invoice-1"),
    transactionId("reserve", "booking-1"),
    transactionId("consume", "booking-1"),
    transactionId("restore", "booking-1"),
  ];
  ids.forEach((id) => {
    assert.equal(applyOnce(id), true);
    assert.equal(applyOnce(id), false);
  });
  assert.equal(ledger.size, 4);
});

test("idempotency document ids safely encode untrusted source ids", () => {
  const id = transactionId("purchase", "provider/invoice/2026/1");
  assert.equal(id.includes("/"), false);
  assert.equal(id, transactionId("purchase", "provider/invoice/2026/1"));
  assert.notEqual(id, transactionId("purchase", "provider/invoice/2026/2"));
});

test("two concurrent reservations cannot consume the same last session", async () => {
  let state = balances(1);
  let queue = Promise.resolve();
  const reserveAtomically = async () => {
    let release: () => void = () => undefined;
    const prior = queue;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const transition = reserveOneSession(state, NOW);
      state = transition.after;
      return true;
    } finally {
      release();
    }
  };
  const results = await Promise.allSettled([reserveAtomically(), reserveAtomically()]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(state.remainingSessions, 0);
  assert.equal(state.reservedSessions, 1);
});

test("rejects a service that is not included", () => {
  const candidate: PackageCandidate = {
    id: "pkg-1",
    clientId: "client-1",
    allowedServiceIdsSnapshot: ["hair"],
    ...balances(3),
  };
  assert.equal(isEligiblePackage(candidate, "client-1", "skin", NOW), false);
});

test("rejects expired and exhausted packages", () => {
  const expired: PackageCandidate = {
    id: "expired",
    clientId: "client-1",
    allowedServiceIdsSnapshot: ["hair"],
    ...balances(2),
    expiresAtMs: NOW - 1,
  };
  const exhausted: PackageCandidate = {
    id: "exhausted",
    clientId: "client-1",
    allowedServiceIdsSnapshot: ["hair"],
    ...balances(2, 0),
  };
  assert.equal(isEligiblePackage(expired, "client-1", "hair", NOW), false);
  assert.equal(isEligiblePackage(exhausted, "client-1", "hair", NOW), false);
});

test("rejects an appointment after expiry even when booked before expiry", () => {
  const candidate: PackageCandidate = {
    id: "expiring",
    clientId: "client-1",
    allowedServiceIdsSnapshot: ["hair"],
    totalSessions: 1,
    remainingSessions: 1,
    reservedSessions: 0,
    usedSessions: 0,
    status: "active",
    expiresAtMs: NOW + 1_000,
  };
  assert.equal(isEligiblePackage(candidate, "client-1", "hair", NOW, NOW + 2_000), false);
  assert.equal(isEligiblePackage(candidate, "client-1", "hair", NOW, NOW + 500), true);
});

test("a reservation made for an in-validity appointment can complete after expiry", () => {
  const expiredWithReservation: PackageBalances = {
    totalSessions: 1,
    remainingSessions: 0,
    reservedSessions: 1,
    usedSessions: 0,
    expiresAtMs: NOW - 1,
    status: "active",
  };
  const consumed = consumeOneReservedSession(expiredWithReservation, NOW);
  assert.equal(consumed.after.usedSessions, 1);
  assert.equal(consumed.after.status, "expired");
  const restored = restoreOneReservedSession(expiredWithReservation, NOW);
  assert.equal(restored.after.remainingSessions, 1);
  assert.equal(restored.after.status, "expired");
});

test("late-cancellation policy is configurable and defaults to four hours", () => {
  assert.equal(shouldConsumeCancelledReservation({
    nowMs: NOW,
    appointmentAtMs: NOW + 60 * 60_000,
    policy: DEFAULT_PACKAGE_CANCELLATION_POLICY,
  }), true);
  assert.equal(shouldConsumeCancelledReservation({
    nowMs: NOW,
    appointmentAtMs: NOW + 5 * 60 * 60_000,
    policy: DEFAULT_PACKAGE_CANCELLATION_POLICY,
  }), false);
  assert.equal(shouldConsumeCancelledReservation({
    nowMs: NOW,
    appointmentAtMs: NOW + 60 * 60_000,
    policy: { ...DEFAULT_PACKAGE_CANCELLATION_POLICY, lateCancellationConsumesSession: false },
  }), false);
});

test("selects the nearest expiring eligible package", () => {
  const candidates: PackageCandidate[] = [
    {
      id: "later",
      clientId: "client-1",
      allowedServiceIdsSnapshot: ["hair"],
      ...balances(3),
      expiresAtMs: NOW + 10_000,
    },
    {
      id: "sooner",
      clientId: "client-1",
      allowedServiceIdsSnapshot: ["hair"],
      ...balances(3),
      expiresAtMs: NOW + 1_000,
    },
  ];
  assert.equal(selectNearestExpiringPackage(candidates, "client-1", "hair", NOW)?.id, "sooner");
});

test("prevents negative balances", () => {
  assert.throws(
    () => adjustRemainingBalance(balances(2, 1), -2, NOW),
    (error: unknown) => error instanceof PackageDomainError && error.code === "NEGATIVE_BALANCE"
  );
});

test("duplicate consume and restore attempts fail after the first state transition", () => {
  const reserved = reserveOneSession(balances(2), NOW).after;
  const consumed = consumeOneReservedSession(reserved, NOW).after;
  assert.throws(() => consumeOneReservedSession(consumed, NOW), PackageDomainError);

  const reservedAgain = reserveOneSession(balances(2), NOW).after;
  const restored = restoreOneReservedSession(reservedAgain, NOW).after;
  assert.throws(() => restoreOneReservedSession(restored, NOW), PackageDomainError);
});

test("cancelling a package is idempotent and never changes balances", () => {
  const first = cancelPackage(balances(3), NOW);
  const second = cancelPackage(first.after, NOW);
  assert.equal(first.after.status, "cancelled");
  assert.deepEqual(second.after, first.after);
  assert.equal(second.sessionsDelta, 0);
});
