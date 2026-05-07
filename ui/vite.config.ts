import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: process.env.KVIEW_E2E_API_TARGET
      ? {
          "/api": {
            target: process.env.KVIEW_E2E_API_TARGET,
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
            return "react-vendor";
          }
          if (id.includes("/node_modules/@mui/icons-material/")) {
            return "mui-icons-vendor";
          }
          if (id.includes("/node_modules/@mui/x-data-grid/")) {
            return "mui-grid-vendor";
          }
          if (id.includes("/node_modules/@mui/") || id.includes("/node_modules/@emotion/")) {
            return "mui-vendor";
          }
          if (id.includes("/node_modules/@xterm/")) {
            return "terminal-vendor";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
    },
  },
});
