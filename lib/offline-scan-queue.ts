import { openDB, type IDBPDatabase } from 'idb';

// A scan gets queued here only when the network request itself fails
// (no response reached the server) — not when the server responds
// with a real rejection (wrong section, inactive student, etc.),
// since retrying those wouldn't help.
export type QueuedScan = {
  id: string; // local uuid, not a server ID
  session_id: string;
  qr_token: string;
  queued_at: string;
};

const DB_NAME = 'kaan-kiosk';
const STORE_NAME = 'pending_scans';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function queueScan(scan: QueuedScan) {
  const db = await getDb();
  await db.put(STORE_NAME, scan);
}

export async function getQueuedScans(): Promise<QueuedScan[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function removeQueuedScan(id: string) {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

export async function queuedScanCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}
