import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 : client bureau, 5174 : client web.
    port: 5175,
    strictPort: true,
  },
});
