import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer"),
      "@shared": path.resolve(__dirname, "src/shared")
    }
  }
});
