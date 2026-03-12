import type { IconType } from "react-icons";
import {
  FiDroplet,
  FiEdit3,
  FiEye,
  FiGift,
  FiHeart,
  FiPenTool,
  FiScissors,
  FiShoppingBag,
  FiStar,
  FiSun,
  FiWind,
  FiZap,
} from "react-icons/fi";

export type PriceLookupIcon = {
  Icon: IconType;
  label: string;
};

type ServiceIconKind =
  | "cut"
  | "color"
  | "blowdry"
  | "styling"
  | "makeup"
  | "lashes"
  | "nails"
  | "skin"
  | "body"
  | "hairRemoval"
  | "package"
  | "default";

type ServiceIconRule = {
  kind: ServiceIconKind;
  keys: string[];
};

const ICON_BY_KIND: Record<ServiceIconKind, IconType> = {
  cut: FiScissors,
  color: FiDroplet,
  blowdry: FiWind,
  styling: FiStar,
  makeup: FiPenTool,
  lashes: FiEye,
  nails: FiEdit3,
  skin: FiSun,
  body: FiHeart,
  hairRemoval: FiZap,
  package: FiGift,
  default: FiShoppingBag,
};

const PRICE_LOOKUP_LABEL_BY_KIND: Record<ServiceIconKind, string> = {
  cut: "قص",
  color: "صبغات",
  blowdry: "استشوار",
  styling: "تساريح",
  makeup: "مكياج",
  lashes: "رموش",
  nails: "أظافر",
  skin: "عناية",
  body: "عناية جسم",
  hairRemoval: "إزالة شعر",
  package: "باكيج",
  default: "خدمة",
};

const BOOKING_CARD_RULES: ServiceIconRule[] = [
  { kind: "cut", keys: ["قص", "حلاق", "trim", "cut"] },
  { kind: "color", keys: ["صبغ", "لون", "color", "dye", "balayage"] },
  { kind: "blowdry", keys: ["استشوار", "سشوار", "blow", "dryer"] },
  { kind: "styling", keys: ["تسري", "ستايل", "style", "updo"] },
  { kind: "makeup", keys: ["مكياج", "makeup", "bridal"] },
  { kind: "lashes", keys: ["رموش", "حواج", "lash", "brow"] },
  {
    kind: "nails",
    keys: ["أظافر", "اظافر", "مناكير", "بدكير", "nail", "manicure", "pedicure"],
  },
  { kind: "skin", keys: ["بشر", "عناية", "facial", "skin"] },
  { kind: "body", keys: ["مساج", "spa", "massage", "body"] },
  {
    kind: "hairRemoval",
    keys: ["واكس", "ليزر", "ازالة", "إزالة", "thread", "wax", "laser"],
  },
  { kind: "package", keys: ["باكيج", "عرض", "package", "bundle", "offer"] },
];

const PRICE_LOOKUP_RULES: ServiceIconRule[] = [
  { kind: "cut", keys: ["قص", "حلاقة", "اطراف", "أطراف", "غرة", "trim", "cut", "hair cut"] },
  { kind: "color", keys: ["صبغ", "صبغة", "لون", "ألوان", "هايلايت", "balayage", "color", "dye"] },
  { kind: "blowdry", keys: ["استشوار", "سشوار", "سيشوار", "blow dry", "blowdry", "dryer"] },
  { kind: "styling", keys: ["تسريحة", "تساريح", "تصفيف", "فير", "updo", "styling", "style"] },
  { kind: "makeup", keys: ["مكياج", "ميك اب", "ميكاب", "makeup", "bridal"] },
  { kind: "lashes", keys: ["رموش", "حواجب", "لاش", "eyelash", "lash", "brow"] },
  {
    kind: "nails",
    keys: ["أظافر", "اظافر", "مناكير", "بدكير", "بديكير", "nail", "manicure", "pedicure"],
  },
  { kind: "skin", keys: ["بشرة", "عناية", "facial", "skin", "clean"] },
  { kind: "body", keys: ["مساج", "تدليك", "حمام", "spa", "massage", "body"] },
  {
    kind: "hairRemoval",
    keys: ["واكس", "ليزر", "ازالة", "إزالة", "thread", "wax", "laser"],
  },
  { kind: "package", keys: ["باكيج", "عرض", "package", "bundle", "offer"] },
];

function pickServiceIconKind(args: {
  serviceName: string;
  rules: ServiceIconRule[];
  normalizeHay: (raw: string) => string;
  normalizeKey: (raw: string) => string;
}) {
  const hay = args.normalizeHay(String(args.serviceName || ""));
  for (const rule of args.rules) {
    const matched = rule.keys.some((k) => {
      const n = args.normalizeKey(k);
      return !!n && hay.includes(n);
    });
    if (matched) return rule.kind;
  }
  return "default" as const;
}

export function pickBookingCardIcon(serviceName: string): IconType {
  const kind = pickServiceIconKind({
    serviceName,
    rules: BOOKING_CARD_RULES,
    normalizeHay: (raw) => String(raw || "").trim().toLowerCase(),
    normalizeKey: (raw) => String(raw || ""),
  });
  return ICON_BY_KIND[kind];
}

export function pickPriceLookupIcon(
  serviceName: string,
  normalizeSearchText: (raw: string) => string
): PriceLookupIcon {
  const kind = pickServiceIconKind({
    serviceName,
    rules: PRICE_LOOKUP_RULES,
    normalizeHay: (raw) => normalizeSearchText(String(raw || "")),
    normalizeKey: (raw) => normalizeSearchText(String(raw || "")),
  });

  return { Icon: ICON_BY_KIND[kind], label: PRICE_LOOKUP_LABEL_BY_KIND[kind] };
}

