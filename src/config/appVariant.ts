export type AppVariant = "web" | "customer" | "staff";

function resolveAppVariant(raw: unknown): AppVariant {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "staff" || value === "hr" || value === "internal") return "staff";
  if (value === "customer" || value === "client") return "customer";
  return "web";
}

export const APP_VARIANT = resolveAppVariant(import.meta.env.VITE_APP_VARIANT);
export const IS_STAFF_APP = APP_VARIANT === "staff";
export const IS_CUSTOMER_APP = APP_VARIANT === "customer";
export const IS_WEB_APP = APP_VARIANT === "web";
