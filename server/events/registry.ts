import type { BusinessEvent } from "./types";
import { createNotificationProjectorConsumer } from "../notifications/projector";
import { createContextEventConsumer } from "../tars/context/consumer";

export type BusinessEventConsumer = {
  name: string;
  eventTypes: readonly string[] | "*";
  handle(event: BusinessEvent): Promise<void>;
};

export type EventConsumerRegistry = {
  register(consumer: BusinessEventConsumer): void;
  get(name: string): BusinessEventConsumer | null;
  list(): BusinessEventConsumer[];
};

export function createEventConsumerRegistry(): EventConsumerRegistry {
  const consumers = new Map<string, BusinessEventConsumer>();
  return {
    register(consumer) {
      if (consumers.has(consumer.name)) {
        throw new Error(`EVENT_CONSUMER_DUPLICATE:${consumer.name}`);
      }
      consumers.set(consumer.name, consumer);
    },
    get(name) {
      return consumers.get(name) ?? null;
    },
    list() {
      return Array.from(consumers.values());
    },
  };
}

export const eventConsumerRegistry = createEventConsumerRegistry();

export function registerEventConsumer(consumer: BusinessEventConsumer): void {
  eventConsumerRegistry.register(consumer);
}

registerEventConsumer(createNotificationProjectorConsumer());
registerEventConsumer(createContextEventConsumer());
