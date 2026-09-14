import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const TARGETS = [
  ["ChatBot.tsx", "src/components/ChatBot.tsx"],
  ["Testimonials.tsx", "src/components/Testimonials.tsx"],
  ["About.tsx", "src/pages/About.tsx"],
  ["userProfile.ts", "src/services/userProfile.ts"],
  ["authService.ts", "src/services/authService.ts"],
];

test("reachable web flows have zero Firestore data imports", () => {
  for (const [name, path] of TARGETS) {
    const source = read(path);
    assert.equal(source.includes("firebase/firestore"), false, `${name} must not import Firestore`);
    assert.equal(/services\/firebase/.test(source) && name !== "authService.ts", false,
      `${name} must not access Firebase data services`);
    assert.equal(source.includes("onSnapshot"), false, `${name} must not use onSnapshot`);
    assert.equal(source.includes("addDoc"), false, `${name} must not use addDoc`);
    assert.equal(source.includes("setDoc"), false, `${name} must not use setDoc`);
    assert.equal(source.includes("updateDoc"), false, `${name} must not use updateDoc`);
    assert.equal(source.includes("deleteDoc"), false, `${name} must not use deleteDoc`);
    assert.equal(source.includes("getDocs"), false, `${name} must not use getDocs`);
    assert.equal(source.includes("getDoc"), false, `${name} must not use getDoc`);
    assert.equal(source.includes("collection(db"), false, `${name} must not use collection(db`);
  }

  // authService may import firebase auth + firebase.ts for Auth only.
  const authService = read("src/services/authService.ts");
  assert.match(authService, /from "\.\/firebase"/);
  assert.equal(authService.includes("firebase/firestore"), false);
  assert.match(authService, /\/api\/core\/auth\/ensure-client/);
  assert.match(authService, /CORE D1 ONLY|no Firestore fallback/i);

  const userProfile = read("src/services/userProfile.ts");
  assert.match(userProfile, /CORE D1 ONLY/);
  assert.match(userProfile, /CoreAccountService/);
  assert.match(userProfile, /\/api\/core\/client\/me/);
  assert.match(userProfile, /\/api\/core\/auth\/ensure-client/);

  const chat = read("src/components/ChatBot.tsx");
  assert.match(chat, /CoreCatalogService|AppSettingsService/);
  assert.match(chat, /\/api\/core\/bookings\/taken-times/);

  const testimonials = read("src/components/Testimonials.tsx");
  assert.match(testimonials, /CoreTestimonialsService/);

  const about = read("src/pages/About.tsx");
  assert.match(about, /CoreStaffPublicService/);
  assert.equal(about.toLowerCase().includes("staff_public"), false);
});

test("Core worker exposes testimonials, public-about, taken-times, ensure-client", () => {
  const index = read("workers/core/index.js");
  assert.match(index, /staff:public-about/);
  assert.match(index, /bookings:taken-times/);
  assert.match(index, /auth:ensure-client/);
  assert.match(index, /case "testimonials"/);
  assert.match(index, /listPublicAboutStaff/);
  assert.match(index, /listTakenBookingTimes/);
  assert.match(index, /ensureClientAccount/);
  assert.match(index, /createTestimonial/);

  assert.ok(fs.existsSync(new URL("../migrations/core/0070_testimonials_and_client_profile.sql", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../workers/core/repositories/testimonials.js", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../workers/core/repositories/staff-public.js", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../workers/core/repositories/auth-register.js", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../src/services/CoreTestimonialsService.ts", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../src/services/CoreStaffPublicService.ts", import.meta.url)));
});
