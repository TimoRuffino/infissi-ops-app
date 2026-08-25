import type { WorkflowDefinition } from "./types";
import { createCustomerJobWorkflow } from "./createCustomerJob";

export type WorkflowRegistry = {
  register(definition: WorkflowDefinition): void;
  get(id: string, version: number): WorkflowDefinition | null;
  list(): WorkflowDefinition[];
};

export function createWorkflowRegistry(): WorkflowRegistry {
  const workflows = new Map<string, WorkflowDefinition>();
  const key = (id: string, version: number) => `${id}:v${version}`;
  return {
    register(definition) {
      const id = key(definition.id, definition.version);
      if (workflows.has(id)) throw new Error(`WORKFLOW_DUPLICATE:${id}`);
      workflows.set(id, definition);
    },
    get(id, version) {
      return workflows.get(key(id, version)) ?? null;
    },
    list() {
      return Array.from(workflows.values());
    },
  };
}

export const workflowRegistry = createWorkflowRegistry();

export function registerWorkflow(definition: WorkflowDefinition): void {
  workflowRegistry.register(definition);
}

export function registerBuiltInWorkflows(): void {
  const definitions = [createCustomerJobWorkflow()];
  for (const definition of definitions) {
    if (!workflowRegistry.get(definition.id, definition.version)) {
      workflowRegistry.register(definition);
    }
  }
}
