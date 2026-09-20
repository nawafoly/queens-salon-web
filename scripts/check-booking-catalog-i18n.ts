import fs from "node:fs";
import path from "node:path";
import { translateBookingCatalogLabel } from "../src/helpers/dashboardBookingsLanguage.ts";

const ARABIC_RE = /[\u0600-\u06FF]/;
const TECHNICAL_DASH_RE = /[-–—]/;

const exactCases = new Map<string, string>([
  ["قسم بديكير و منيكير", "Pedicure & Manicure"],
  ["ميك اب", "Makeup"],
  ["قسم الصبغات والمعالجات", "Color & Treatments"],

  ["استشوار شعر قصير جداً", "Extra Short Hair Blow Dry"],
  ["استشوار شعر متوسط", "Medium Hair Blow Dry"],
  ["استشوار شعر طويل", "Long Hair Blow Dry"],
  ["استشوار شعر طويل جداً", "Extra Long Hair Blow Dry"],

  ["تساريح اميرات سن ٨ الى ١٣", "Princess Hairstyle Ages 8 to 13"],
  ["تسريحة شعر طويل", "Long Hair Styling"],
  ["تسريحة شعر قصير", "Short Hair Styling"],
  ["تسريحة شعر متوسط", "Medium Hair Styling"],

  ["قص شعر اطراف", "Hair Ends Trim"],
  ["قص شعر طول واحد", "One Length Haircut"],
  ["قص شعر غره", "Bangs Trim"],
  ["قص شعر مدرج", "Layered Haircut"],

  ["صبغة جذور", "Root Color"],
  ["صبغه شعر قصير", "Short Hair Dye"],
  ["صبغه شعر قصير جداً", "Extra Short Hair Dye"],
  ["صبغه شعر قصير جدا مع سحب لون", "Extra Short Hair Dye with Color Removal"],
  ["صبغه شعر متوسط", "Medium Hair Dye"],
  ["صبغه شعر متوسط مع سحب لون", "Medium Hair Dye with Color Removal"],
  ["صبغه شعر طويل", "Long Hair Dye"],
  ["صبغه شعر طويل جداً", "Extra Long Hair Dye"],
  ["صبغه شعر طويل مع سحب لون", "Long Hair Dye with Color Removal"],
  ["سحب لون مع صبغة شعر متوسط", "Medium Hair Dye with Color Removal"],

  ["فلر شعر قصير", "Short Hair Filler Treatment"],
  ["فلر شعر متوسط", "Medium Hair Filler Treatment"],
  ["فلر شعر طويل", "Long Hair Filler Treatment"],
  ["كافيار شعر طويل", "Long Hair Caviar Treatment"],
  ["تنظيف فروة الشعر", "Scalp Cleansing"],
  ["رنساج", "Hair Toner"],

  ["برد اظافر", "Nail Filing"],
  ["حلاوة جسم", "Body Sugaring"],
  ["حلاوة كامل / رجل", "Full Leg Sugaring"],
  ["حلاوة كامل / يد", "Full Arm Sugaring"],
  ["حلاوة نصف / رجل", "Half Leg Sugaring"],
  ["حلاوة نصف/ يد", "Half Arm Sugaring"],

  ["تركيب رموش", "Lash Application"],
  ["تركيب رموش مؤقته من العميلة", "Temporary Lash Application with Client Lashes"],
  ["تركيب رموش بالحبة اسبوعية", "Weekly Individual Lash Extensions"],
  ["تركيب رموش بالحبة شهرية (رتوش مجاناً)", "Monthly Individual Lash Extensions with Free Retouch"],
  ["تركيب رموش بالحبة يومية", "Daily Individual Lash Extensions"],
  ["رفع رموش", "Lash Lift"],

  ["تشقير حواجب", "Eyebrow Bleaching"],
  ["تشقير وصبغه حواجب", "Eyebrow Bleaching and Tint"],
  ["رسمة ايلينر", "Eyeliner"],

  ["مكياج بناتي", "Girls Makeup"],
  ["مكياج سهره", "Evening Makeup"],
  ["مكياج لبناني", "Lebanese Makeup"],

  ["واكس جسم كامل", "Full Body Waxing"],
]);

for (const [arabic, expected] of exactCases) {
  const actual = translateBookingCatalogLabel(
    "en",
    arabic,
    arabic.startsWith("قسم ") ? "section" : "service"
  );

  if (actual !== expected) {
    throw new Error(
      "catalog translation mismatch: " +
        arabic +
        " => " +
        actual +
        " (expected " +
        expected +
        ")"
    );
  }

  if (TECHNICAL_DASH_RE.test(actual)) {
    throw new Error("natural English label contains a technical dash: " + arabic + " => " + actual);
  }
}

const sourcePaths = [
  "src/pages/Pricing.tsx",
  "src/helpers/servicesCatalog.ts",
  "src/helpers/serviceIcons.ts",
  "src/components/dashboard-v2/employee-workspace/EmployeeWorkspaceProfileTabsV2.tsx",
];

const candidates = new Set<string>(exactCases.keys());
for (const relative of sourcePaths) {
  const full = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, "utf8");

  for (const match of source.matchAll(/["'`]([^"'\n`]*[\u0600-\u06FF][^"'\n`]*)["'`]/g)) {
    const value = String(match[1] || "").trim();
    if (value && value.length <= 120) candidates.add(value);
  }
}

const failures: Array<{ source: string; translated: string; reason: string }> = [];
for (const source of candidates) {
  const translated = translateBookingCatalogLabel(
    "en",
    source,
    source.startsWith("قسم ") ? "section" : "service"
  );

  if (ARABIC_RE.test(translated)) {
    failures.push({ source, translated, reason: "Arabic leaked into English output" });
  }

  if (TECHNICAL_DASH_RE.test(translated)) {
    failures.push({ source, translated, reason: "Technical dash leaked into client-facing label" });
  }
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  throw new Error("English catalog output failed natural-language coverage.");
}

console.log("booking catalog natural English coverage OK:", candidates.size, "labels checked");
