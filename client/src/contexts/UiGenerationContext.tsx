import { createContext, useContext, useEffect, useMemo } from "react";

import { useOperationalContext } from "./OperationalContext";

export type UiGeneration = "legacy" | "modular-control";

const UiGenerationContext = createContext<UiGeneration>("legacy");

export function UiGenerationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { flags } = useOperationalContext();
  const generation: UiGeneration = flags?.uiV2 ? "modular-control" : "legacy";

  useEffect(() => {
    const root = document.documentElement;
    if (generation === "modular-control") {
      root.setAttribute("data-ui-system", "modular-control");
    } else {
      root.removeAttribute("data-ui-system");
    }

    return () => root.removeAttribute("data-ui-system");
  }, [generation]);

  const value = useMemo(() => generation, [generation]);
  return (
    <UiGenerationContext.Provider value={value}>
      {children}
    </UiGenerationContext.Provider>
  );
}

export function useUiGeneration(): UiGeneration {
  return useContext(UiGenerationContext);
}

export function useModularControl(): boolean {
  return useUiGeneration() === "modular-control";
}
