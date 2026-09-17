import fs from "node:fs";

import { generateVapidKeys } from "@mmmike/web-push/vapid";

const outputPath = ".web-push-vapid.local.json";

if (fs.existsSync(outputPath)) {
  console.error(`[web-push] ${outputPath} already exists. Delete it only if you intentionally rotate VAPID keys.`);
  process.exit(1);
}

const keys = await generateVapidKeys();

fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "https://queens-salon-web.vercel.app",
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
  { encoding: "utf8", mode: 0o600 },
);

console.log(`[web-push] Generated ${outputPath}`);
console.log("[web-push] Keep this file local. Never commit or paste the private key into chat.");
console.log("[web-push] Next: configure the Core Worker secrets, apply migration 0076, then deploy the Core Worker.");
