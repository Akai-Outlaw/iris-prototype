import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "galaxy", test: /node_modules\/three/ },
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)/,
            },
            { name: "contracts", test: /node_modules\/zod/ },
          ],
        },
      },
    },
  },
  clearScreen: false,
});
