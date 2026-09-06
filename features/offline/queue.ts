import type { OfflineRecord, PendingSelection, SavedSelection, Selection } from "./types";
export interface Ack extends SavedSelection { mutationId: string; serverNow?: number }
export class SyncFailure extends Error {
  constructor(message: string, public code: string, public serverNow?: number) { super(message); }
}
/** One in-flight request; durable write before delivery; acknowledge exact mutation IDs only. */
export class DurableQueue {
  private writing: Promise<void> = Promise.resolve();
  private flushing: Promise<boolean> | null = null;
  private stopped = false;
  error = "";
  code = "";
  constructor(public record: OfflineRecord,
    private persist: (r: OfflineRecord) => Promise<unknown>,
    private send: (id: string, p: PendingSelection) => Promise<Ack>,
    private changed: () => void = () => {}) {}
  private save() {
    const snapshot = structuredClone(this.record);
    this.writing = this.writing.then(async () => { await this.persist(snapshot); });
    return this.writing;
  }
  async ready() { await this.writing; }
  async select(id: string, selection: Selection) {
    if (this.stopped || this.record.final || !this.record.answers[id]) return;
    this.record.pending[id] = { ...selection, mutationId: crypto.randomUUID(), expectedRevision: this.record.answers[id].revision };
    this.record.answers[id] = { ...this.record.answers[id], ...selection };
    this.changed();
    try { await this.save(); } catch { this.error = "Device storage failed. This change is not safely saved. Keep this screen open."; this.code = "STORAGE"; this.changed(); throw new Error(this.error); }
    this.changed();
  }
  flush(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async drain() {
    if (this.stopped || this.record.final || this.code === "CONFLICT" || this.code === "STORAGE") return false;
    this.error = ""; this.code = "";
    try {
      await this.ready();
      while (!this.stopped && Object.keys(this.record.pending).length) {
        const id = Object.keys(this.record.pending)[0];
        const sent = { ...this.record.pending[id] };
        const ack = await this.send(id, sent);
        if (this.stopped) return false;
        if (ack.mutationId !== sent.mutationId) throw new SyncFailure("Unexpected save response. Retry syncing.", "RETRY");
        const newer = this.record.pending[id];
        if (newer?.mutationId === sent.mutationId) {
          delete this.record.pending[id];
          this.record.answers[id] = ack;
        } else if (newer) {
          // Carry the acknowledged revision forward without changing the newer selection.
          newer.expectedRevision = ack.revision;
          this.record.answers[id].revision = ack.revision;
        }
        await this.save(); this.changed();
      }
      return !this.stopped;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Sync failed. Please retry.";
      this.code = e instanceof SyncFailure ? e.code : "RETRY";
      this.changed(); return false;
    }
  }
  async retryStorage() {
    this.writing = Promise.resolve();
    try { await this.save(); this.error = ""; this.code = ""; this.changed(); }
    catch { this.code = "STORAGE"; this.error = "Device storage is still unavailable. Keep this screen open and free some space."; this.changed(); throw new Error(this.error); }
  }
  async checkpoint() { await this.save(); }
  async finish() { this.record.final = true; await this.save(); this.changed(); }
  stop() { this.stopped = true; }
}
