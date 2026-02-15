import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // ✅ يفتح على الشبكة
    port: 5173,
    strictPort: true,

    // ✅ مهم: خلي /api تروح لـ Vercel بدل localhost
    proxy: {
      "/api": {
        target: "https://queens-salon-web-gnxk.vercel.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
