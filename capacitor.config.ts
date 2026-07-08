import type { CapacitorConfig } from "@capacitor/cli";

const requestedVariant = String(process.env.CAP_APP_VARIANT || "web")
  .trim()
  .toLowerCase();
const isStaffApp = requestedVariant === "staff" || requestedVariant === "hr";
const isCustomerApp = requestedVariant === "customer" || requestedVariant === "client";

const config: CapacitorConfig = isStaffApp
  ? {
      appId: "com.queenssalon.staff",
      appName: "Queens Staff Portal",
      webDir: "dist-staff",
      backgroundColor: "#05093f",
      android: {
        path: "android-hr",
        backgroundColor: "#05093f",
      },
    }
  : {
      appId: "com.queenssalon.app",
      appName: "Queens Salon",
      webDir: isCustomerApp ? "dist-customer" : "dist",
      android: {
        path: "android",
      },
    };

export default config;
