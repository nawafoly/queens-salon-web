import { readFileSync, writeFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const credentialsPath = process.argv[2];
const outputPath = process.argv[3];

const serviceAccount = JSON.parse(
  readFileSync(credentialsPath, "utf8")
);

initializeApp({
  credential: cert(serviceAccount),
});

const targetUids = [
  "0YYs6i4o5QgN0n2Lg16gBx0OEKg2",
  "51XqZbYHQWWbwIwoKvIFGgePBKm2",
  "J4a1wCCP2gYT445xJeOjMKfUqM12",
  "sWCJcEXXfehavKroHRQvv9M3UXm1",
  "t36cUYFVA4fBlrmwUjkRhUJY0f12",
  "tia8CSOIfZfD60LTuPa90cdnI0L2",
  "Ltv60Mp2RTTqSs7QLlVOtWSQ3Gp1",
  "vwczkxZaKASzyPD269soM7KoTcq1",
  "VjtXO2JSgza3mYUnhTJ5QNh3MBp1"
];

const auth = getAuth();
const records = [];

for (const uid of targetUids) {
  try {
    const user = await auth.getUser(uid);

    records.push({
      uid: user.uid,
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      createdAt: user.metadata.creationTime ?? "",
      lastSignInAt: user.metadata.lastSignInTime ?? "",
      providers: user.providerData.map((item) => item.providerId),
    });
  } catch (error) {
    records.push({
      uid,
      notFound: error?.code === "auth/user-not-found",
      errorCode: error?.code ?? "unknown",
    });
  }
}

writeFileSync(
  outputPath,
  JSON.stringify({ records }, null, 2),
  "utf8"
);

console.log(`written: ${outputPath}`);
