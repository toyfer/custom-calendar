/** Theme: light | dark | system — persisted, no OS dialogs */
const KEY = 'custom-calendar.theme.v1';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

export function setStoredTheme(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
}

export function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode) {
  const m = mode || getStoredTheme();
  const resolved = resolveTheme(m);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = m;
  // theme-color for browser chrome / PWA
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const color = resolved === 'dark' ? '#0C0E14' : '#FFFFFF';
  metas.forEach((el) => {
    // keep media-specific if present; also set a catch-all
    if (!el.media || el.media.includes(resolved)) el.setAttribute('content', color);
  });
  let catchAll = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!catchAll) {
    catchAll = document.createElement('meta');
    catchAll.name = 'theme-color';
    document.head.appendChild(catchAll);
  }
  catchAll.content = color;
  return resolved;
}

export function initTheme() {
  applyTheme(getStoredTheme());
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

export function setTheme(mode) {
  setStoredTheme(mode);
  return applyTheme(mode);
}
