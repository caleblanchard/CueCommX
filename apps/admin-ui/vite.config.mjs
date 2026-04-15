import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  test: {
    coverage: {
      provider: "v8",
    },
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
