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
      // Stessa ragione un piano più in là: un componente può portarsi
      // accanto il proprio modulo di testi o di calcolo puro (es.
      // `components/abbonamento/testi.ts`, WS4 §8). L'ambiente resta `node`,
      // quindi qui girano solo i test SENZA DOM: la logica pura, non il
      // rendering.
      "client/src/components/**/*.test.ts",
      // Le regole condivise fra server e client vivono in `shared/`: senza
      // questa riga i loro test esistono e non girano mai, che è peggio che
      // non averli — sembrano una rete e non lo sono.
      "shared/**/*.test.ts",
    ],
  },
});
