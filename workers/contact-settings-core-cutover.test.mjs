import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Contact and SettingsContact cut over to Core settings and contact-messages", () => {
  const contactPage = read("src/pages/Contact.tsx");
  const settingsContactPage = read("src/pages/settings/SettingsContact.tsx");
  const coreContactService = read("src/services/CoreContactService.ts");

  for (const [name, source] of [
    ["Contact.tsx", contactPage],
    ["SettingsContact.tsx", settingsContactPage],
    ["CoreContactService.ts", coreContactService],
  ]) {
    assert.equal(
      source.includes("firebase/firestore"),
      false,
      `${name} must not import Firestore`
    );
    assert.equal(
      /services\/firebase/.test(source),
      false,
      `${name} must not access Firebase data services`
    );
    assert.equal(
      source.includes("onSnapshot"),
      false,
      `${name} must not use onSnapshot`
    );
    assert.equal(
      source.includes("addDoc"),
      false,
      `${name} must not use addDoc`
    );
    assert.equal(
      source.includes("setDoc"),
      false,
      `${name} must not use setDoc`
    );
    assert.equal(
      source.includes("updateDoc"),
      false,
      `${name} must not use updateDoc`
    );
    assert.equal(
      source.includes("collection(db"),
      false,
      `${name} must not use collection(db`
    );
  }

  assert.match(coreContactService, /CORE D1 ONLY/);
  assert.match(coreContactService, /coreApiRequest/);
  assert.match(coreContactService, /\/api\/core\/contact-messages/);
  assert.match(coreContactService, /async submit\(/);
  assert.match(coreContactService, /async list\(/);
  assert.match(coreContactService, /async markRead\(/);

  assert.match(contactPage, /CoreContactService/);
  assert.match(contactPage, /\/api\/core\/settings\/public/);
  assert.match(contactPage, /AppSettingsService/);
  assert.match(contactPage, /source:\s*"contact_page"/);

  assert.match(settingsContactPage, /CoreSettingsService/);
  assert.match(settingsContactPage, /CoreContactService/);
  assert.match(settingsContactPage, /CoreSettingsService\.get(?:<[^>]+>)?\(\s*"public"\s*\)/);
  assert.match(settingsContactPage, /CoreSettingsService\.save\(\s*"public"/);
  assert.match(settingsContactPage, /CoreContactService\.list/);
  assert.match(settingsContactPage, /CoreContactService\.markRead/);
});
