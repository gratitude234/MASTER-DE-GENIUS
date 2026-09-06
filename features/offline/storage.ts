import type { OfflineRecord } from "./types";
export const DB_NAME = "mdg-offline-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("sessions", { keyPath: "key" }); req.result.createObjectStore("meta"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other app tabs and retry."));
  });
}
async function transaction<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    // A request succeeding does not mean the transaction committed.
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Device storage failed.")); };
  });
}
export const readRecord = (key: string) => transaction<OfflineRecord | undefined>("sessions", "readonly", s => s.get(key));
export async function writeRecord(record: OfflineRecord) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["sessions", "meta"], "readwrite");
    const owner = tx.objectStore("meta").get("owner");
    owner.onsuccess = () => {
      if (owner.result !== record.userId) { tx.abort(); return; }
      tx.objectStore("sessions").put(record);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Device storage changed or you signed out. Reconnect and reopen this session.")); };
  });
}
export const deleteRecord = (key: string) => transaction("sessions", "readwrite", s => s.delete(key));
export const listRecords = () => transaction<OfflineRecord[]>("sessions", "readonly", s => s.getAll());
export const readOwner = () => transaction<string | undefined>("meta", "readonly", s => s.get("owner"));
export async function claimOwner(userId: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["meta", "sessions"], "readwrite");
    let changedOwner = false;
    const meta = tx.objectStore("meta");
    const req = meta.get("owner");
    req.onsuccess = () => {
      if (req.result && req.result !== userId) { changedOwner = true; tx.objectStore("sessions").clear(); }
      meta.put(userId, "owner");
    };
    tx.oncomplete = () => { db.close(); if (changedOwner && typeof caches !== "undefined") void caches.delete("mdg-question-media-v1"); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function clearDevice() {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["meta", "sessions"], "readwrite");
    tx.objectStore("meta").clear(); tx.objectStore("sessions").clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
