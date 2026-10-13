import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri drives the dev server; it expects a fixed port and no auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5190,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "safari15" },
});
