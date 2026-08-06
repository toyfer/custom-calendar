/** ui.mobile — reauth UX, delete sheet, theme-aware chrome */
export const $ = (id) => document.getElementById(id);

export function toast(msg, type = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

export function setStatusDot(online, fromCache, { staleCount = 0 } = {}) {
  const wrap = document.querySelector('.status-wrap');
  if (wrap) wrap.hidden = false;
  const d = $('statusDot');
  const l = $('statusLabel');
  let kind = 'ok';
  let label = 'オンライン';
  if (!online) {
    kind = 'off';
    label = 'オフライン';
  } else if (staleCount > 0) {
    kind = 'stale';
    label = '要再連携';
  } else if (fromCache) {
    kind = 'warn';
    label = 'キャッシュ';
  }
  if (d) {
    d.className = 'status-dot ' + kind;
    d.setAttribute('aria-label', label);
  }
  if (l) {
    l.textContent = label;
    l.setAttribute('aria-hidden', 'false');
  }
  const hint = $('offlineHint');
  if (hint) hint.hidden = online;
  const banner = $('sessionBanner');
  if (banner) {
    banner.hidden = !(online && staleCount > 0);
    const n = $('sessionBannerCount');
    if (n) n.textContent = String(staleCount);
  }
}

export function setChromeVisibility(state) {
  const chips = $('monthChips');
  if (chips) chips.hidden = false;
  const stack = $('avatarStack');
  if (stack) stack.hidden = false;
  const acctBtn = $('acctBtn');
  if (acctBtn) acctBtn.hidden = false;
  const wrap = document.querySelector('.status-wrap');
  if (wrap) wrap.hidden = false;
  setFabVisibility(state);
  syncDrawerChrome(state);
}

export function setFabVisibility(state) {
  const fab = $('fab');
  if (!fab) return;
  const hasAccounts = !!(state.accounts && state.accounts.length);
  const hasSelection = !!state.selectedDate;
  const drawer = $('dayDrawer');
  const detent = drawer ? drawer.getAttribute('data-detent') || 'peek' : 'peek';
  const drawerOpen = drawer && !drawer.hidden;
  const isVisible = hasSelection && hasAccounts && drawerOpen && detent !== 'collapsed';
  fab.hidden = !isVisible;
  if (isVisible) {
    try {
      const d = new Date(state.selectedDate + 'T12:00:00');
      fab.setAttribute('aria-label', `${d.getMonth() + 1}/${d.getDate()} に予定を追加`);
    } catch {
      fab.setAttribute('aria-label', '予定を作成');
    }
  }
}

function syncDrawerChrome(state) {
  const drawer = $('dayDrawer');
  const app = $('app');
  if (!drawer || !app) return;
  const open = !!state.selectedDate;
  drawer.hidden = !open;
  app.classList.toggle('has-drawer', open);
  if (!open) {
    drawer.classList.remove('peek', 'half', 'full', 'collapsed');
    drawer.style.height = '';
    return;
  }
  if (
    !drawer.classList.contains('peek') &&
    !drawer.classList.contains('half') &&
    !drawer.classList.contains('full') &&
    !drawer.classList.contains('collapsed')
  ) {
    drawer.classList.add('peek');
    drawer.setAttribute('data-detent', 'peek');
  }
}

export function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return new Date(y, m - 1, d);
}

function eventYmd(e) {
  try {
    if (e.allDay && e.start && String(e.start).length >= 10) return String(e.start).slice(0, 10);
    const d = new Date(e.start);
    if (Number.isNaN(d.getTime())) return '';
    return ymd(d.getFullYear(), d.getMonth(), d.getDate());
  } catch {
    return '';
  }
}

export function renderHeader(state, { onMonthJump, onAvatarClick, onSolo, onStatusClick }) {
  const label = $('monthLabel');
  if (label) label.textContent = `${state.viewYear}年 ${state.viewMonth + 1}月`;

  const chips = $('monthChips');
  if (chips) {
    chips.hidden = false;
    chips.innerHTML = '';
    for (let d = -2; d <= 3; d++) {
      let m = state.viewMonth + d;
      let y = state.viewYear;
      while (m < 0) {
        m += 12;
        y -= 1;
      }
      while (m >= 12) {
        m -= 12;
        y += 1;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-chip' + (d === 0 ? ' active' : '');
      const isYearBoundary = y !== state.viewYear;
      b.innerHTML =
        `${m + 1}月` +
        (isYearBoundary ? `<span class="m-chip-year">${String(y).slice(-2)}年</span>` : '');
      b.setAttribute('aria-label', `${y}年${m + 1}月`);
      b.onclick = () => onMonthJump(y, m);
      chips.appendChild(b);
    }
  }

  const stack = $('avatarStack');
  if (stack) {
    stack.hidden = false;
    stack.innerHTML = '';
    const all = state.accounts || [];
    const vis = all.filter((a) => a.visible !== false);
    const soloId = state.soloAccountId || null;
    const stale = all.filter((a) => a.stale);

    if (!all.length) {
      const empty = document.createElement('span');
      empty.className = 'av more';
      empty.textContent = '+';
      empty.title = 'アカウントを追加';
      stack.appendChild(empty);
    } else {
      vis.slice(0, 3).forEach((a) => {
        const el = document.createElement('span');
        el.className = 'av' + (soloId === a.id ? ' solo' : '') + (a.stale ? ' stale' : '');
        el.style.background = a.color || '#5B6CFF';
        el.textContent = (a.name || a.email || '?')[0].toUpperCase();
        el.title = a.email + (a.stale ? ' · 要再連携' : '') + (soloId === a.id ? ' · Solo' : '');
        stack.appendChild(el);
      });
      if (all.length > 3) {
        const more = document.createElement('span');
        more.className = 'av more';
        more.textContent = `+${all.length - 3}`;
        stack.appendChild(more);
      }
      if (all.some((a) => a.visible === false) || soloId || stale.length) {
        const dot = document.createElement('span');
        dot.className = 'av hidden-badge' + (stale.length ? ' stale' : '');
        dot.textContent = stale.length ? '!' : '·';
        dot.title = stale.length ? '要再連携' : soloId ? 'Solo表示中' : '非表示あり';
        stack.appendChild(dot);
      }
    }

    stack.onclick = onAvatarClick;
    stack.ondblclick = (e) => {
      e.preventDefault();
      if (onSolo) onSolo();
    };
    let pressTimer = null;
    stack.addEventListener(
      'touchstart',
      () => {
        pressTimer = setTimeout(() => {
          if (onSolo) onSolo();
          try {
            navigator.vibrate?.(10);
          } catch {}
        }, 600);
      },
      { passive: true },
    );
    stack.addEventListener('touchend', () => clearTimeout(pressTimer));
    stack.addEventListener('touchmove', () => clearTimeout(pressTimer));
    stack.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onAvatarClick();
      }
      if ((e.key === 's' || e.key === 'S') && onSolo) onSolo();
    };
  }

  const statusWrap = document.querySelector('.status-wrap');
  if (statusWrap && onStatusClick) {
    statusWrap.style.cursor = 'pointer';
    statusWrap.onclick = onStatusClick;
  }

  const acctBtn = $('acctBtn');
  if (acctBtn) acctBtn.hidden = false;
}

const swipeState = { bound: false, sx: 0, sy: 0 };
const dayTapState = { lastYmd: '', lastT: 0 };

export function renderMonthGrid(state, { onSelectDate, onDrop, onSwipeMonth, onMoreClick, onOpenEvent }) {
  const grid = $('monthGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const first = new Date(state.viewYear, state.viewMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(state.viewYear, state.viewMonth, 0).getDate();
  const today = new Date();
  const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id));
  const byDay = new Map();
  for (const e of state.events) {
    if (!visibleIds.has(e.accountId)) continue;
    const key = eventYmd(e);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }

  for (let i = 0; i < 42; i++) {
    let y = state.viewYear;
    let m = state.viewMonth;
    let d = i - startDay + 1;
    let muted = false;
    if (d < 1) {
      m -= 1;
      if (m < 0) {
        m = 11;
        y -= 1;
      }
      d = daysInPrev + d;
      muted = true;
    } else if (d > daysInMonth) {
      d = d - daysInMonth;
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      muted = true;
    }

    const curYmd = ymd(y, m, d);
    const evs = byDay.get(curYmd) || [];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day-cell';
    if (muted) cell.classList.add('muted');
    if (curYmd === todayYmd) cell.classList.add('today');
    if (curYmd === state.selectedDate) cell.classList.add('selected');

    const preview = evs.length
      ? ': ' + evs.slice(0, 2).map((x) => x.summary || '無題').join(', ')
      : '';
    cell.setAttribute('aria-label', `${curYmd} ${evs.length}件${preview}`);

    let dotsHtml = '';
    if (evs.length) {
      const groups = {};
      evs.forEach((e) => {
        groups[e.accountId] = (groups[e.accountId] || 0) + 1;
      });
      const distinct = [];
      const seen = new Set();
      for (const e of evs) {
        if (!seen.has(e.accountId) && distinct.length < 3) {
          seen.add(e.accountId);
          distinct.push(e);
        }
      }
      dotsHtml = distinct
        .map((e) => {
          const a = state.accounts.find((x) => x.id === e.accountId);
          const col = a ? a.color : '#5B6CFF';
          const title =
            groups[e.accountId] > 1
              ? `${a?.email || ''} ${groups[e.accountId]}件`
              : a?.email || '';
          return `<i class="dot ${e.allDay ? 'allday' : ''}" style="--c:${col}" title="${title.replace(/"/g, '')}"></i>`;
        })
        .join('');
      if (evs.length > 3) {
        dotsHtml += `<span class="more" role="button" tabindex="0" aria-label="他 ${evs.length - 3}件を表示" data-more="${curYmd}">+${evs.length - 3}</span>`;
      }
    }

    cell.innerHTML = `<span class="dnum">${d}</span><span class="dots">${dotsHtml}</span>`;

    cell.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) return;
      const now = Date.now();
      const isDouble = dayTapState.lastYmd === curYmd && now - dayTapState.lastT < 380;
      dayTapState.lastYmd = curYmd;
      dayTapState.lastT = now;
      if (isDouble && evs.length && typeof onOpenEvent === 'function') {
        onSelectDate(curYmd);
        onOpenEvent(evs[0]);
        return;
      }
      onSelectDate(curYmd);
    });

    let pressTimer;
    let moved = false;
    cell.addEventListener(
      'touchstart',
      () => {
        moved = false;
        pressTimer = setTimeout(() => {
          if (!moved) {
            onSelectDate(curYmd);
            setDrawerDetent('half');
            toast('長押し: FABから作成');
            try {
              navigator.vibrate?.(10);
            } catch {}
          }
        }, 700);
      },
      { passive: true },
    );
    cell.addEventListener('touchmove', () => {
      moved = true;
      clearTimeout(pressTimer);
    });
    cell.addEventListener('touchend', () => clearTimeout(pressTimer));
    cell.addEventListener('touchcancel', () => clearTimeout(pressTimer));

    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-target');
      const uid = e.dataTransfer.getData('text/plain');
      if (uid) onDrop(uid, curYmd);
    });

    const moreEl = cell.querySelector('[data-more]');
    if (moreEl) {
      moreEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectDate(curYmd);
        setDrawerDetent('half');
        if (onMoreClick) onMoreClick(curYmd);
      });
    }

    grid.appendChild(cell);
  }

  if (!swipeState.bound && typeof onSwipeMonth === 'function') {
    swipeState.bound = true;
    grid.addEventListener(
      'touchstart',
      (e) => {
        swipeState.sx = e.touches[0].clientX;
        swipeState.sy = e.touches[0].clientY;
      },
      { passive: true },
    );
    grid.addEventListener(
      'touchend',
      (e) => {
        const dx = e.changedTouches[0].clientX - swipeState.sx;
        const dy = e.changedTouches[0].clientY - swipeState.sy;
        if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          onSwipeMonth(dx < 0 ? 1 : -1);
          try {
            navigator.vibrate?.(8);
          } catch {}
        }
      },
      { passive: true },
    );
  }
}

function bindRowActivate(row, activate) {
  let sx = 0;
  let sy = 0;
  let dragging = false;
  row.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target.closest('button')) return;
      sx = e.clientX;
      sy = e.clientY;
      dragging = false;
    },
    { passive: true },
  );
  row.addEventListener(
    'pointermove',
    (e) => {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) dragging = true;
    },
    { passive: true },
  );
  row.addEventListener('pointerup', (e) => {
    if (e.target.closest('button')) return;
    if (dragging) return;
    e.preventDefault();
    activate();
  });
  row.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (!window.PointerEvent) activate();
  });
}

export function renderDayDrawer(state, { onEdit, onDelete, onCreate, onClose }) {
  syncDrawerChrome(state);

  const sel = state.selectedDate || null;
  const d = sel ? parseYmd(sel) : null;
  const dateEl = $('drawerDate');
  const cnt = $('drawerCount');
  const list = $('drawerList');
  const hint = $('drawerHint');

  if (!sel || !d || Number.isNaN(d.getTime())) {
    if (dateEl) dateEl.textContent = '日付を選択してください';
    if (cnt) cnt.textContent = '—';
    if (list) {
      list.innerHTML =
        '<div class="empty">月グリッドの日付をタップすると<br>予定がここに表示されます<br><small style="opacity:.8">同じ日をもう一度タップで閉じます</small></div>';
    }
    if (hint) hint.hidden = true;
    return;
  }

  if (hint) {
    hint.hidden = false;
    hint.textContent = '予定をタップで編集 · 同じ日をもう一度タップで閉じる';
  }
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  if (dateEl) dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${w}曜日`;

  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id));
  const evs = state.events
    .filter((e) => visibleIds.has(e.accountId) && eventYmd(e) === sel)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  if (cnt) cnt.textContent = `${evs.length}件`;
  if (!list) return;
  list.innerHTML = '';

  const closeBar = document.createElement('div');
  closeBar.className = 'drawer-close-bar';
  closeBar.innerHTML =
    '<button type="button" class="sm ghost" id="drawerCloseBtn" style="width:100%;min-height:40px">閉じる</button>';
  list.appendChild(closeBar);
  closeBar.querySelector('#drawerCloseBtn').onclick = () => {
    if (onClose) onClose();
  };

  if (!evs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML =
      '予定なし — <button type="button" class="link" id="emptyCreate">タップして追加</button>';
    list.appendChild(empty);
    empty.querySelector('#emptyCreate').onclick = () => onCreate(sel);
    return;
  }

  for (const e of evs) {
    const a = state.accounts.find((x) => x.id === e.accountId);
    const row = document.createElement('div');
    row.className = 'e-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `編集: ${e.summary || '無題'}`);
    row.style.setProperty('--ev', a ? a.color : '#5B6CFF');

    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (canHover) {
      row.draggable = true;
      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', e.uid);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
    }

    let timeLabel = '';
    if (e.allDay) timeLabel = '<span class="badge">終日</span>';
    else {
      try {
        const s = new Date(e.start);
        const en = new Date(e.end);
        timeLabel = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}<br>${String(en.getHours()).padStart(2, '0')}:${String(en.getMinutes()).padStart(2, '0')}`;
      } catch {
        timeLabel = '';
      }
    }

    const loc = e.location ? ` · ${e.location}` : '';
    const acctName = a ? a.name || a.email : '';
    row.innerHTML = `<div class="e-time">${timeLabel}</div><div class="e-main"><div class="e-title"></div><div class="e-meta"></div></div><div class="e-dot" style="background:${a ? a.color : '#5B6CFF'}" title="${acctName}"></div><div class="e-actions"><button type="button" class="sm ghost" data-edit>編集</button><button type="button" class="sm danger-soft" data-del>削除</button></div>`;
    row.querySelector('.e-title').textContent = e.summary || '(無題)';
    row.querySelector('.e-meta').textContent = acctName + loc;

    const doEdit = () => onEdit(e);
    row.querySelector('[data-edit]').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      doEdit();
    });
    row.querySelector('[data-del]').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onDelete(e);
    });
    bindRowActivate(row, doEdit);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        doEdit();
      }
    });

    list.appendChild(row);
  }
}

export function renderAcctSheet(state, { onToggle, onSolo, onReauth }) {
  const list = $('acctList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.accounts.length) {
    list.innerHTML =
      '<div class="empty">まだアカウントがありません。<br>下のボタンから追加してください。</div>';
    return;
  }

  const stale = state.accounts.filter((a) => a.stale);
  if (stale.length) {
    const ban = document.createElement('div');
    ban.className = 'session-card';
    ban.innerHTML = `<div class="session-card-body"><strong>セッション切れ</strong><p>${stale.length} 件のアカウントで再連携が必要です。トークンはタブを閉じると消えます。</p></div><button type="button" class="primary sm" id="reauthAllBtn">すべて再連携</button>`;
    list.appendChild(ban);
    ban.querySelector('#reauthAllBtn').onclick = () => {
      if (onReauth) onReauth(null); // all
    };
  }

  const solo = state.soloAccountId || null;
  for (const a of state.accounts) {
    const row = document.createElement('div');
    row.className = 'acct-row' + (solo === a.id ? ' solo' : '') + (a.stale ? ' stale' : '');
    row.innerHTML = `
      <span class="av" style="background:${a.color || '#5B6CFF'}">${(a.name || a.email || '?')[0].toUpperCase()}</span>
      <span class="acct-meta"><b></b><small></small></span>
      <label class="toggle-wrap" title="表示"><input type="checkbox" class="toggle" ${a.visible !== false ? 'checked' : ''} aria-label="表示"></label>
    `;
    row.querySelector('b').textContent =
      (a.name || a.email || 'account') +
      (a.stale ? ' · 要再連携' : '') +
      (solo === a.id ? ' · Solo' : '');
    row.querySelector('small').textContent = a.email;
    row.querySelector('input').onchange = (e) => onToggle(a.id, e.target.checked);

    if (a.stale) {
      const re = document.createElement('button');
      re.type = 'button';
      re.className = 'reauth-btn';
      re.textContent = '再連携';
      re.onclick = (e) => {
        e.stopPropagation();
        if (onReauth) onReauth(a.id);
      };
      row.appendChild(re);
    }

    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (onSolo) onSolo(a.id);
    });
    let lp = null;
    row.addEventListener(
      'touchstart',
      () => {
        lp = setTimeout(() => {
          if (onSolo) onSolo(a.id);
          try {
            navigator.vibrate?.(10);
          } catch {}
        }, 600);
      },
      { passive: true },
    );
    row.addEventListener('touchend', () => clearTimeout(lp));
    row.addEventListener('touchmove', () => clearTimeout(lp));
    list.appendChild(row);
  }

  if (solo) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost';
    btn.style.cssText =
      'width:100%;margin-top:8px;min-height:44px;border:1px dashed var(--border);border-radius:10px';
    btn.textContent = 'Solo解除 — 全て表示';
    btn.onclick = () => onSolo(null);
    list.appendChild(btn);
  }
}

export function openDeleteSheet(ev, { onConfirm, onCancel }) {
  const sheet = $('deleteSheet');
  if (!sheet) return;
  const title = $('deleteTitle');
  const meta = $('deleteMeta');
  const swatch = $('deleteSwatch');
  if (title) title.textContent = ev.summary || '(無題)';
  if (meta) {
    let time = '';
    try {
      if (ev.allDay) time = '終日';
      else {
        const s = new Date(ev.start);
        const e = new Date(ev.end);
        time = `${s.getHours()}:${String(s.getMinutes()).padStart(2, '0')} – ${e.getHours()}:${String(e.getMinutes()).padStart(2, '0')}`;
      }
    } catch {
      time = '';
    }
    meta.textContent = [ev.accountEmail || '', time, ev.calendarName || ''].filter(Boolean).join(' · ');
  }
  if (swatch) swatch.style.background = ev.color || 'var(--accent)';
  sheet.hidden = false;

  const ok = $('deleteOk');
  const cancel = $('deleteCancel');
  const backdrop = sheet.querySelector('.sheet-backdrop');

  const cleanup = () => {
    sheet.hidden = true;
    ok?.removeEventListener('click', onOk);
    cancel?.removeEventListener('click', onNo);
    backdrop?.removeEventListener('click', onNo);
  };
  const onOk = () => {
    cleanup();
    onConfirm?.();
  };
  const onNo = () => {
    cleanup();
    onCancel?.();
  };
  ok?.addEventListener('click', onOk);
  cancel?.addEventListener('click', onNo);
  backdrop?.addEventListener('click', onNo);
}

export function setDrawerDetent(detent) {
  const d = $('dayDrawer');
  if (!d) return;
  d.hidden = false;
  d.classList.remove('peek', 'half', 'full', 'collapsed');
  const next = detent || 'peek';
  d.classList.add(next);
  d.setAttribute('data-detent', next);
  d.style.height = '';
  const app = $('app');
  if (app) app.classList.add('has-drawer');
  window.dispatchEvent(new CustomEvent('drawerDetentChange', { detail: next }));
}

export function fillComposerAccountBtn(state, accountId) {
  const btnLabel = $('composerAccountLabel');
  const hidden = $('composerAccount');
  const a = state.accounts.find((x) => x.id === accountId) || state.accounts[0];
  if (btnLabel) {
    btnLabel.textContent = a
      ? `${a.name || a.email}${a.email && a.name ? ' · ' + a.email : ''}`.slice(0, 42)
      : '選択';
  }
  if (hidden) hidden.value = accountId || (a ? a.id : '');
  const calId = $('composerCalendar')?.value || 'primary';
  fillComposerCalendarBtn(state, calId);
}

export function fillComposerCalendarBtn(state, calendarId) {
  const btnLabel = $('composerCalendarLabel');
  const hidden = $('composerCalendar');
  const accId = $('composerAccount')?.value;
  const list = state.calendarsByAccount[accId] || [{ id: 'primary', summary: 'primary' }];
  const cur = list.find((c) => c.id === calendarId) || list[0];
  if (btnLabel) btnLabel.textContent = cur ? cur.summary : calendarId;
  if (hidden) hidden.value = cur ? cur.id : calendarId;
}

export function renderComposerAccountList(state, onPick) {
  const list = $('composerAccountList');
  if (!list) return;
  list.innerHTML = '';
  for (const a of state.accounts) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'acct-row';
    row.style.width = '100%';
    row.disabled = !!a.stale;
    row.innerHTML = `<span class="av" style="background:${a.color || '#5B6CFF'}">${(a.name || a.email || '?')[0].toUpperCase()}</span><span class="acct-meta" style="text-align:left"><b></b><small></small></span>`;
    row.querySelector('b').textContent = (a.name || a.email) + (a.stale ? ' · 要再連携' : '');
    row.querySelector('small').textContent = a.email;
    row.onclick = () => onPick(a.id);
    list.appendChild(row);
  }
}

export function renderComposerCalendarList(state, accountId, onPick) {
  const list = $('composerCalendarList');
  if (!list) return;
  list.innerHTML = '';
  const cals = state.calendarsByAccount[accountId] || [{ id: 'primary', summary: 'primary' }];
  for (const c of cals) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'acct-row';
    row.style.width = '100%';
    row.innerHTML = `<span class="acct-meta" style="text-align:left"><b></b><small></small></span>`;
    row.querySelector('b').textContent = c.summary;
    row.querySelector('small').textContent = c.id + (c.primary ? ' · メイン' : '');
    row.onclick = () => onPick(c.id);
    list.appendChild(row);
  }
}

export function setComposerMode(mode) {
  const t = $('composerTitle');
  if (t) t.textContent = mode === 'edit' ? '予定を編集' : '予定を追加';
  const del = $('composerDelete');
  if (del) del.hidden = mode !== 'edit';
}

export function syncThemeUI(mode) {
  document.querySelectorAll('[data-theme-option]').forEach((btn) => {
    const on = btn.getAttribute('data-theme-option') === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
