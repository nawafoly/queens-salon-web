import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const variant = String(env.VITE_APP_VARIANT || "web").trim().toLowerCase();
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
          target: "https://queens-salon-web-gnxk.vercel.app",
          changeOrigin: true,
          secure: true,
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
