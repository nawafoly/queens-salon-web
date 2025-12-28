import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", // 🔴 أو host: true (الاثنين صحيح)
    port: 5173,
    strictPort: true,
  },
});
