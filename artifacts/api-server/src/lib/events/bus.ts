/**
 * EventBus — centralized in-process event bus.
 *
 * Responsibilities:
 *   1. Persist every domain event to the `domain_events` PostgreSQL table.
 *   2. Broadcast events to all connected SSE clients in real-time.
 *   3. Emit typed Node EventEmitter events for internal consumers.
 *
 * Usage from routes:
 *   void eventBus.publish({ event_type: "gate.opened", payload: { ... } });
 *
 * Note: persistence is fire-and-forget (non-blocking). A persistence failure
 * logs the error but does not fail the originating HTTP request.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { domainEventsTable } from "@workspace/db";
import { logger } from "../logger";
import {
  EVENT_CATEGORY_MAP,
  type DomainEvent,
  type DomainEventInput,
  type EventCategory,
} from "./types";

class EventBus extends EventEmitter {
  private readonly sseClients = new Set<{ write: (data: string) => void; id: string }>();

  // ── Publish ────────────────────────────────────────────────────────────────

  async publish(input: DomainEventInput): Promise<DomainEvent> {
    const category: EventCategory =
      EVENT_CATEGORY_MAP[input.event_type] ?? "access";

    const event: DomainEvent = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      category,
      severity: input.severity ?? "info",
      ...input,
    };

    // 1. Persist to DB (fire-and-forget — never blocks the caller)
    this.persistAsync(event).catch((err) =>
      logger.error({ err, event_type: event.event_type }, "EventBus: persist failed"),
    );

    // 2. Broadcast to all SSE clients
    this.broadcastSSE(event);

    // 3. Emit on EventEmitter for internal handlers
    this.emit(event.event_type, event);
    this.emit(event.category, event);

    return event;
  }

  // ── SSE client management ──────────────────────────────────────────────────

  addSSEClient(
    res: import("express").Response,
    clientId: string,
  ): () => void {
    const client = {
      id: clientId,
      write: (data: string) => {
        try {
          (res as any).write(data);
        } catch {
          this.sseClients.delete(client);
        }
      },
    };
    this.sseClients.add(client);

    return () => this.sseClients.delete(client);
  }

  get clientCount(): number {
    return this.sseClients.size;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private broadcastSSE(event: DomainEvent): void {
    if (this.sseClients.size === 0) return;
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      client.write(frame);
    }
  }

  private async persistAsync(event: DomainEvent): Promise<void> {
    await db.insert(domainEventsTable).values({
      id: event.id,
      event_type: event.event_type,
      category: event.category,
      severity: event.severity,
      payload: (event.payload ?? null) as any,
      vehicle_id: event.vehicle_id ?? null,
      villa_id: event.villa_id ?? null,
      camera_id: event.camera_id ?? null,
      reservation_id: event.reservation_id ?? null,
      operator_id: event.operator_id ?? null,
      source: event.source ?? "api",
      ip_address: event.ip_address ?? null,
    });
  }
}

// Singleton — one bus per API server process
export const eventBus = new EventBus();
