import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4243",
      "/webhooks": "http://localhost:4242",
    },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
