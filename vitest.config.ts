import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Guardia globale: nessun test può raggiungere la rete (v. il file).
    setupFiles: ["server/_core/testSetup.ts"],
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/lib/**/*.test.ts",
      // Le regole condivise fra server e client vivono in `shared/`: senza
      // questa riga i loro test esistono e non girano mai, che è peggio che
      // non averli — sembrano una rete e non lo sono.
      "shared/**/*.test.ts",
    ],
  },
});
