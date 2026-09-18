import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("installed app uses the MALIKAT product name and branded icons", async () => {
  const manifest = JSON.parse(await read("public/manifest.json"));

  assert.equal(manifest.name, "MALIKAT");
  assert.equal(manifest.short_name, "MALIKAT");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.src === "/logo192.png" && icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/logo512.png" && icon.sizes === "512x512"));
  assert.ok(manifest.icons.every((icon) => icon.purpose === "any"));
});

test("native Android launcher labels use the MALIKAT brand", async () => {
  const [customerStrings, staffStrings] = await Promise.all([
    read("android/app/src/main/res/values/strings.xml"),
    read("android-hr/app/src/main/res/values/strings.xml"),
  ]);

  assert.match(customerStrings, /<string name="app_name">MALIKAT<\/string>/);
  assert.match(staffStrings, /<string name="app_name">MALIKAT HR<\/string>/);
});

test("the public app exposes a dedicated install route and prompt flow", async () => {
  const [app, installPage, installService] = await Promise.all([
    read("src/App.tsx"),
    read("src/pages/Install.tsx"),
    read("src/services/appInstall.ts"),
  ]);

  assert.match(app, /path="\/install"/);
  assert.match(installPage, /تثبيت MALIKAT على هذا الجهاز/);
  assert.match(installPage, /إضافة إلى الشاشة الرئيسية/);
  assert.match(installService, /beforeinstallprompt/);
  assert.match(installService, /appinstalled/);
});
