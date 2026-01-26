// src/data/catalogFallback.ts
import { STRICT_FIREBASE } from "../config/strictFirebase";
import { pricingSections } from "../pages/Pricing";

if (STRICT_FIREBASE) {
  throw new Error("🔥 catalogFallback is disabled (STRICT_FIREBASE=true)");
}

export const catalogFallback = pricingSections;
