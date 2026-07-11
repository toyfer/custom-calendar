/** localStorage / sessionStorage helpers */

export function loadJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function removeKey(storage, key) {
  storage.removeItem(key);
}

export const local = {
  get: (key, fallback) => loadJson(localStorage, key, fallback),
  set: (key, value) => saveJson(localStorage, key, value),
  remove: (key) => removeKey(localStorage, key),
};

export const session = {
  get: (key, fallback) => loadJson(sessionStorage, key, fallback),
  set: (key, value) => saveJson(sessionStorage, key, value),
  remove: (key) => removeKey(sessionStorage, key),
};
