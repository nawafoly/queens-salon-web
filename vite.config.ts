import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const variant = String(env.VITE_APP_VARIANT || "web").trim().toLowerCase();
  const partnersApiTarget = String(
    env.VITE_PARTNERS_WORKER_URL || "http://127.0.0.1:8787"
  ).replace(/\/+$/, "");
  const outDir =
    variant === "staff"
      ? "dist-staff"
      : variant === "customer"
        ? "dist-customer"
        : "dist";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: partnersApiTarget,
          changeOrigin: true,
          secure: partnersApiTarget.startsWith("https://"),
        },
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
    },
  };
});
