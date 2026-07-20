import { randomUUID } from "node:crypto";
import type { AuditEvent } from "./shared/types.js";

export class AuditLog {
  private readonly entries: AuditEvent[] = [];

  record(type: string, detail: string): AuditEvent {
    const event = { id: `audit_${randomUUID()}`, type, detail, at: new Date().toISOString() };
    this.entries.unshift(event);
    return event;
  }

  list(): AuditEvent[] {
    return [...this.entries];
  }
}
