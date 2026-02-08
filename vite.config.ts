import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    target: "esnext",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 3000,
    open: false,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
