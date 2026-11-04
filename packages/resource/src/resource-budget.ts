import { throwInputRejected } from "./errors";

export type ResourceBudgetLimits = {
  readonly bytes: number;
  readonly items: number;
  readonly clientBytes: number;
  readonly clientItems: number;
};
export type ResourceBudgetSnapshot = {
  readonly bytes: number;
  readonly items: number;
  readonly peakBytes: number;
  readonly peakItems: number;
  readonly settled: number;
  readonly duplicateSettlements: number;
};

/** A ledger for one allocation/queue owner, never a combined transfer+cache counter. */
export class ResourceBudget {
  private readonly entries = new Map<string, { client: string; bytes: number }>();
  private usedBytes = 0;
  private peakBytes = 0;
  private peakItems = 0;
  private settled = 0;
  private duplicateSettlements = 0;
  private readonly limits: ResourceBudgetLimits;

  constructor(limits: ResourceBudgetLimits) {
    for (const value of [limits.bytes, limits.items, limits.clientBytes, limits.clientItems]) {
      if (!Number.isSafeInteger(value) || value <= 0) throwInputRejected("invalid resource budget");
    }
    if (limits.clientBytes > limits.bytes || limits.clientItems > limits.items) {
      throwInputRejected("per-client budget exceeds global budget");
    }
    this.limits = { ...limits };
  }

  reserve(id: string, client: string, bytes: number): boolean {
    if (
      !id ||
      id.length > 128 ||
      !client ||
      client.length > 128 ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0
    ) {
      throwInputRejected("invalid resource reservation");
    }
    if (this.entries.has(id)) throwInputRejected("resource reservation identity reused");
    let clientBytes = 0;
    let clientItems = 0;
    for (const entry of this.entries.values()) {
      if (entry.client === client) {
        clientBytes += entry.bytes;
        clientItems++;
      }
    }
    if (
      bytes > this.limits.bytes - this.usedBytes ||
      bytes > this.limits.clientBytes - clientBytes ||
      this.entries.size >= this.limits.items ||
      clientItems >= this.limits.clientItems
    )
      return false;
    this.entries.set(id, { client, bytes });
    this.usedBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.usedBytes);
    this.peakItems = Math.max(this.peakItems, this.entries.size);
    return true;
  }

  settle(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      this.duplicateSettlements++;
      return false;
    }
    this.entries.delete(id);
    this.usedBytes -= entry.bytes;
    this.settled++;
    return true;
  }

  snapshot(): ResourceBudgetSnapshot {
    return {
      bytes: this.usedBytes,
      items: this.entries.size,
      peakBytes: this.peakBytes,
      peakItems: this.peakItems,
      settled: this.settled,
      duplicateSettlements: this.duplicateSettlements,
    };
  }
}
