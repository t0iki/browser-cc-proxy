import type { CDPEvent } from '../cdp/types.js';

export class RingBuffer {
  private buffer: (CDPEvent | undefined)[];
  private head: number = 0;
  private tailIndex: number = 0;
  private count: number = 0;
  private sequence: number = 0;
  private lastUpdateAt: number = Date.now();

  constructor(private capacity: number = 10000) {
    this.buffer = new Array(capacity);
  }

  push(event: CDPEvent): void {
    const eventWithSeq = { ...event, seq: this.sequence++ };
    
    if (this.count === this.capacity) {
      // Buffer is full, overwrite oldest
      this.buffer[this.tailIndex] = eventWithSeq;
      this.tailIndex = (this.tailIndex + 1) % this.capacity;
      this.head = (this.head + 1) % this.capacity;
    } else {
      // Buffer has space
      this.buffer[this.tailIndex] = eventWithSeq;
      this.tailIndex = (this.tailIndex + 1) % this.capacity;
      this.count++;
    }
    
    this.lastUpdateAt = Date.now();
  }

  sliceByOffset(offset: number, limit: number): { events: CDPEvent[], nextOffset: number } {
    const events: CDPEvent[] = [];
    let currentOffset = Math.max(0, this.sequence - this.count);
    
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.capacity;
      const event = this.buffer[index];
      
      if (event && currentOffset >= offset) {
        events.push(event);
        if (events.length >= limit) break;
      }
      currentOffset++;
    }
    
    return {
      events,
      nextOffset: currentOffset
    };
  }

  getTail(limit: number = 200): { events: CDPEvent[], nextOffset: number } {
    const start = Math.max(0, this.sequence - limit);
    return this.sliceByOffset(start, limit);
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tailIndex = 0;
    this.count = 0;
    this.sequence = 0;
    this.lastUpdateAt = Date.now();
  }

  size(): number {
    return this.count;
  }

  getLastUpdateAt(): number {
    return this.lastUpdateAt;
  }

  isExpired(ttlMs: number): boolean {
    return Date.now() - this.lastUpdateAt > ttlMs;
  }
}