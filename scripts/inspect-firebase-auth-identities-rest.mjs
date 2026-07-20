import { readFileSync, writeFileSync } from "node:fs";
import { createSign } from "node:crypto";

const credentialsPath = process.argv[2];
const outputPath = process.argv[3];

if (!credentialsPath || !outputPath) {
  throw new Error("credentials path and output path are required");
}

const serviceAccount = JSON.parse(
  readFileSync(credentialsPath, "utf8")
);

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const now = Math.floor(Date.now() / 1000);

const header = {
  alg: "RS256",
  typ: "JWT",
};

const payload = {
  iss: serviceAccount.client_email,
  scope: "https://www.googleapis.com/auth/cloud-platform",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
};

const unsignedJwt =
  `${base64url(JSON.stringify(header))}.` +
  `${base64url(JSON.stringify(payload))}`;

const signer = createSign("RSA-SHA256");
signer.update(unsignedJwt);
signer.end();

const signature = signer
  .sign(serviceAccount.private_key)
  .toString("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const assertion = `${unsignedJwt}.${signature}`;

const tokenResponse = await fetch(
  "https://oauth2.googleapis.com/token",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }
);

const tokenPayload = await tokenResponse.json();

if (!tokenResponse.ok || !tokenPayload.access_token) {
  throw new Error(
    `OAuth token failed: ${JSON.stringify(tokenPayload)}`
  );
}

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

const lookupResponse = await fetch(
  `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/accounts:lookup`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      localId: targetUids,
    }),
  }
);

const lookupPayload = await lookupResponse.json();

if (!lookupResponse.ok) {
  throw new Error(
    `Firebase Auth lookup failed: ${JSON.stringify(lookupPayload)}`
  );
}

const foundUsers = new Map(
  (lookupPayload.users || []).map((user) => [
    user.localId,
    user,
  ])
);

const records = targetUids.map((uid) => {
  const user = foundUsers.get(uid);

  if (!user) {
    return {
      uid,
      notFound: true,
    };
  }

  return {
    uid,
    email: user.email ?? "",
    displayName: user.displayName ?? "",
    disabled: Boolean(user.disabled),
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt ?? "",
    lastLoginAt: user.lastLoginAt ?? "",
    providers: (user.providerUserInfo || []).map(
      (item) => item.providerId
    ),
  };
});

writeFileSync(
  outputPath,
  JSON.stringify({ records }, null, 2),
  "utf8"
);

console.log(`written: ${outputPath}`);
console.log(`records: ${records.length}`);
