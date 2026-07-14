import test, { after, before, beforeEach } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || "waves-hotel-dashboard";
let env: RulesTestEnvironment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is required");
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: Number(host.split(":").pop() || 8080),
      rules: readFileSync(
        existsSync(resolve(process.cwd(), "firestore.rules"))
          ? resolve(process.cwd(), "firestore.rules")
          : resolve(process.cwd(), "../firestore.rules"),
        "utf8"
      ),
    },
  });
});

after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

function firestore(uid?: string, role?: string) {
  return uid
    ? env.authenticatedContext(uid, role ? { role } : {}).firestore()
    : env.unauthenticatedContext().firestore();
}

async function seed(path: string, value: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), value);
  });
}

test("package balances, ledger and invoices are Admin-SDK-write-only for every role", async () => {
  const paths = [
    "salons/main/client_packages/pkg-rules",
    "salons/main/client_package_transactions/tx-rules",
    "salons/main/invoices/invoice-rules",
  ];
  for (const path of paths) await seed(path, { clientId: "client-a", remainingSessions: 1 });

  for (const [uid, role] of [
    [undefined, undefined],
    ["staff-rules", "staff"],
    ["hr-rules", "hr"],
    ["admin-rules", "admin"],
    ["owner-rules", "owner"],
  ] as const) {
    const db = firestore(uid, role);
    for (const path of paths) {
      await assertFails(setDoc(doc(db, path), { remainingSessions: 999 }, { merge: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  }

  for (const role of ["admin", "owner"] as const) {
    await assertSucceeds(getDoc(doc(firestore(`${role}-read`, role), paths[0])));
  }
  await assertFails(getDoc(doc(firestore("staff-read", "staff"), paths[0])));
  await assertFails(getDoc(doc(firestore("client-read", "client"), paths[0])));
});

test("only owner/admin can create or disable catalog packages and nobody can delete them", async () => {
  const catalogPath = "salons/main/packages_catalog/catalog-rules";
  const value = { name: "Package", sessionsCount: 5, price: 100, allowedServiceIds: ["service-1"], active: true };
  for (const role of ["staff", "hr", "reception"] as const) {
    await assertFails(setDoc(doc(firestore(`${role}-catalog`, role), catalogPath), value));
  }
  await assertFails(setDoc(doc(firestore(), catalogPath), value));
  await assertSucceeds(setDoc(doc(firestore("admin-catalog", "admin"), catalogPath), value));
  await assertSucceeds(updateDoc(doc(firestore("owner-catalog", "owner"), catalogPath), { active: false }));
  await assertFails(deleteDoc(doc(firestore("owner-catalog", "owner"), catalogPath)));
});

test("package redemption bookings, tracks and slots cannot be forged directly", async () => {
  const owner = firestore("owner-package-write", "owner");
  const packageBooking = {
    status: "confirmed",
    lineType: "package_redemption",
    fromSessionPackage: true,
    clientPackageId: "pkg-rules",
    packageTransactionId: "reserve-rules",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
  };
  await assertFails(setDoc(doc(owner, "salons/main/bookings/pkg_forged"), packageBooking));
  await assertFails(setDoc(doc(owner, "salons/main/booking_tracks/pkg_forged"), {
    bookingId: "pkg_forged",
    ...packageBooking,
  }));
  await assertFails(setDoc(doc(owner, "salons/main/booking_slots/slot-package"), {
    bookingId: "pkg_forged",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
  }));

  await seed("salons/main/bookings/pkg_existing", packageBooking);
  await seed("salons/main/booking_tracks/pkg_existing", {
    bookingId: "pkg_existing",
    ...packageBooking,
    packageRedemptionState: "reserved",
  });
  await seed("salons/main/booking_slots/slot-existing", {
    bookingId: "pkg_existing",
    employeeId: "employee-1",
    date: "2026-07-20",
    time: "10:00",
  });
  await assertSucceeds(updateDoc(doc(owner, "salons/main/bookings/pkg_existing"), {
    status: "completed",
    completedAt: 1,
    completedByUid: "owner-package-write",
    updatedAt: 1,
  }));
  await assertFails(updateDoc(doc(owner, "salons/main/bookings/pkg_existing"), { clientPackageId: "other" }));
  await assertFails(updateDoc(doc(owner, "salons/main/booking_tracks/pkg_existing"), {
    packageRedemptionState: "consumed",
  }));
  await assertFails(deleteDoc(doc(owner, "salons/main/booking_slots/slot-existing")));
});

test("booking reads prevent cross-client access while operational roles retain scoped access", async () => {
  await seed("salons/main/bookings/client-booking", {
    userId: "client-a",
    status: "pending",
    employeeId: "employee-a",
  });
  const path = "salons/main/bookings/client-booking";
  await assertSucceeds(getDoc(doc(firestore("client-a", "client"), path)));
  await assertFails(getDoc(doc(firestore("client-b", "client"), path)));
  await assertFails(getDoc(doc(firestore("hr-booking", "hr"), path)));
  await assertSucceeds(getDoc(doc(firestore("admin-booking", "admin"), path)));
  await assertSucceeds(getDoc(doc(firestore("owner-booking", "owner"), path)));
});
