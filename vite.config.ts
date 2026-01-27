import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // ✅ يفتح على الشبكة
    port: 5173,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});

