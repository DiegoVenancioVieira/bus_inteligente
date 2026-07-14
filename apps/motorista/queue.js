// Fila persistente de posições em IndexedDB (RF-M5): tudo passa pela fila;
// um flusher periódico envia em lote e remove só após confirmação do servidor.
// Sobrevive a fechamento do app e quedas de rede.
const DB_NAME = 'bi_driver';
const STORE = 'positions';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb());

export async function enqueue(position) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(position);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function peekBatch(limit = 100) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly');
    const out = [];
    const cursorReq = tx.objectStore(STORE).openCursor();
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (c && out.length < limit) { out.push({ key: c.key, ...c.value }); c.continue(); }
      else resolve(out);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function removeKeys(keys) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    for (const k of keys) tx.objectStore(STORE).delete(k);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function count() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
