/** IndexedDB event cache — month-keyed, multi-account safe */

import { CACHE_TTL_MS, DB } from './constants.js';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB.name, DB.version);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // v4: recreate events store with monthKey index
      if (db.objectStoreNames.contains(DB.store)) {
        db.deleteObjectStore(DB.store);
      }
      const store = db.createObjectStore(DB.store, { keyPath: 'uid' });
      store.createIndex('monthKey', 'monthKey', { unique: false });
      store.createIndex('accountId', 'accountId', { unique: false });

      if (!db.objectStoreNames.contains(DB.meta)) {
        db.createObjectStore(DB.meta, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** YYYY-MM from view year/month (0-based month) */
export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function metaKey(accountId, mk) {
  return `fetch:${accountId}:${mk}`;
}

/** Stamp events with monthKey for the viewed month window */
export function stampMonthKey(events, mk) {
  return (events || []).map((e) => ({ ...e, monthKey: mk }));
}

/**
 * Replace cached events for one account + month, keep other months/accounts.
 */
export async function cacheMonthEvents(accountId, mk, events) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([DB.store, DB.meta], 'readwrite');
      const store = tx.objectStore(DB.store);
      const meta = tx.objectStore(DB.meta);
      const idx = store.index('monthKey');

      // Delete previous entries for this account in this month
      const range = IDBKeyRange.only(mk);
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value.accountId === accountId) cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      // After deletes in same tx — put new (cursor is async within tx)
      // Use separate put after cursor finishes via oncomplete of a nested approach:
    });

    // Second tx: put events + meta (cursor delete completed)
    await new Promise((resolve, reject) => {
      const tx = db.transaction([DB.store, DB.meta], 'readwrite');
      const store = tx.objectStore(DB.store);
      const meta = tx.objectStore(DB.meta);
      for (const e of stampMonthKey(events, mk)) {
        store.put({ ...e, monthKey: mk });
      }
      meta.put({
        key: metaKey(accountId, mk),
        accountId,
        monthKey: mk,
        fetchedAt: Date.now(),
        count: events.length,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (err) {
    console.warn('[cache] cacheMonthEvents failed', err);
  }
}

/** Load all cached events for a month (all accounts). */
export async function loadMonthEvents(mk) {
  try {
    const db = await openDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, 'readonly');
      const idx = tx.objectStore(DB.store).index('monthKey');
      const req = idx.getAll(IDBKeyRange.only(mk));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items;
  } catch {
    return [];
  }
}

/** When each account was last fetched for this month */
export async function loadMonthMeta(accountIds, mk) {
  const out = {};
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.meta, 'readonly');
      const store = tx.objectStore(DB.meta);
      let pending = accountIds.length;
      if (!pending) {
        resolve();
        return;
      }
      for (const id of accountIds) {
        const req = store.get(metaKey(id, mk));
        req.onsuccess = () => {
          out[id] = req.result || null;
          pending -= 1;
          if (!pending) resolve();
        };
        req.onerror = () => {
          pending -= 1;
          if (!pending) resolve();
        };
      }
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
  return out;
}

export function isFresh(metaEntry, ttl = CACHE_TTL_MS) {
  if (!metaEntry?.fetchedAt) return false;
  return Date.now() - metaEntry.fetchedAt < ttl;
}

/** True if every live account has a fresh cache for this month */
export function allAccountsFresh(accountIds, metaMap, ttl = CACHE_TTL_MS) {
  if (!accountIds.length) return false;
  return accountIds.every((id) => isFresh(metaMap[id], ttl));
}

/** Legacy: full dump (boot fallback) */
export async function cacheEvents(events) {
  // no-op clear-all deprecated — keep for removeAccount path: rewrite via month keys if present
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, 'readwrite');
      const store = tx.objectStore(DB.store);
      // Remove events for accounts not in the list? Just put all with unknown month
      store.clear();
      for (const e of events) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* cache is optional */
  }
}

export async function loadCachedEvents() {
  try {
    const db = await openDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, 'readonly');
      const req = tx.objectStore(DB.store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items;
  } catch {
    return [];
  }
}

/** Drop one account from cache entirely */
export async function purgeAccountCache(accountId) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([DB.store, DB.meta], 'readwrite');
      const store = tx.objectStore(DB.store);
      const meta = tx.objectStore(DB.meta);
      const idx = store.index('accountId');
      const req = idx.openCursor(IDBKeyRange.only(accountId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      // meta keys are fetch:accountId:YYYY-MM — scan all meta
      const mreq = meta.openCursor();
      mreq.onsuccess = () => {
        const c = mreq.result;
        if (c) {
          if (c.value.accountId === accountId) c.delete();
          c.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}
