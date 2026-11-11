import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  ...(mode === "ui-reference"
    ? {
        build: {
          outDir: "output/ui-reference-dist",
          rollupOptions: { input: "ui-reference.html" },
        },
      }
    : {}),
}));
