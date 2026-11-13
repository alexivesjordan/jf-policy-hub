import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/lib/installs/product-lines.test.ts",
      "src/lib/installs/permissions.test.ts",
      "src/lib/installs/visit-pdf.test.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
