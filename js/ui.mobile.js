/** ui.mobile v2 — view-first, progressive disclosure, year-aware chips, solo, accessible dots */
export const $ = (id) => document.getElementById(id);
export function toast(msg, type = '') { const t = $('toast'); if (!t) return; t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }
export function setStatusDot(online, fromCache) {
  const d = $('statusDot'); const l = $('statusLabel');
  if (d) { d.className = 'status-dot ' + (online ? (fromCache ? 'warn' : 'ok') : 'off'); d.setAttribute('aria-label', online ? (fromCache ? 'キャッシュ表示中' : 'オンライン') : 'オフライン'); }
  if (l) { l.textContent = online ? (fromCache ? 'キャッシュ' : 'オンライン') : 'オフライン'; }
  const hint = $('offlineHint'); if (hint) hint.hidden = online;
}
export function setFabVisibility(state) {
  const fab = $('fab'); if (!fab) return;
  const hasAccounts = state.accounts && state.accounts.length > 0;
  const hasSelection = !!state.selectedDate;
  const drawer = $('dayDrawer');
  const detent = drawer ? drawer.getAttribute('data-detent') : 'peek';
  const isVisible = hasSelection && hasAccounts && detent !== 'collapsed';
  fab.hidden = !isVisible;
  if (isVisible) {
    const d = state.selectedDate ? new Date(state.selectedDate) : null;
    const label = d ? `${d.getMonth()+1}/${d.getDate()} に追加` : '予定を作成';
    fab.setAttribute('aria-label', label);
  }
}
export function ymd(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function parseYmd(s) { const [y, m, d] = String(s || '').split('-').map(Number); return new Date(y, m - 1, d); }
function eventYmd(e) { try { if (e.allDay && e.start && String(e.start).length >= 10) return String(e.start).slice(0, 10); const d = new Date(e.start); if (Number.isNaN(d.getTime())) return ''; return ymd(d.getFullYear(), d.getMonth(), d.getDate()); } catch { return ''; } }
export function renderHeader(state, { onMonthJump, onAvatarClick, onSolo }) {
  const label = $('monthLabel'); if (label) label.textContent = `${state.viewYear}年 ${state.viewMonth + 1}月`;
  const chips = $('monthChips'); if (chips) {
    chips.innerHTML = '';
    for (let d = -2; d <= 3; d++) {
      let m = state.viewMonth + d; let y = state.viewYear;
      while (m < 0) { m += 12; y -= 1; } while (m >= 12) { m += 12; y += 1; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-chip' + (d === 0 ? ' active' : '');
      const isYearBoundary = y !== state.viewYear;
      b.innerHTML = `${m + 1}月${isYearBoundary ? `<span class=m-chip-year>${String(y).slice(-2)}年</span>` : ''}`;
      b.setAttribute('aria-label', `${y}年${m+1}月`);
      b.onclick = () => onMonthJump(y, m);
      chips.appendChild(b);
    }
  }
  const stack = $('avatarStack'); if (stack) {
    stack.innerHTML = '';
    const vis = state.accounts.filter((a) => a.visible !== false);
    const all = state.accounts;
    const soloId = state.soloAccountId || null;
    vis.slice(0, 3).forEach((a) => {
      const el = document.createElement('span');
      el.className = 'av' + (soloId===a.id ? ' solo' : '');
      el.style.background = a.color || '#5B6CFF';
      el.textContent = (a.name || a.email || '?')[0].toUpperCase();
      el.title = a.email;
      stack.appendChild(el);
    });
    if (all.length > 3) { const more = document.createElement('span'); more.className = 'av more'; more.textContent = `+${all.length - 3}`; stack.appendChild(more); }
    if (all.some((a) => a.visible === false) || soloId) { const dot = document.createElement('span'); dot.className = 'av hidden-badge'; dot.textContent = '·'; dot.title = soloId ? 'Solo表示中' : '非表示あり'; stack.appendChild(dot); }
    if (!all.length) { const empty = document.createElement('span'); empty.className = 'av more'; empty.textContent = '+'; stack.appendChild(empty); }
    stack.onclick = onAvatarClick;
    stack.ondblclick = (e)=>{ e.preventDefault(); if (onSolo) onSolo(); };
    let pressTimer=null;
    stack.addEventListener('touchstart', (e)=>{ pressTimer=setTimeout(()=>{ if(onSolo) onSolo(); try{navigator.vibrate?.(10)}catch{} }, 600); }, {passive:true});
    stack.addEventListener('touchend', ()=> clearTimeout(pressTimer));
    stack.addEventListener('touchmove', ()=> clearTimeout(pressTimer));
    stack.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAvatarClick(); } if (e.key==='s' && onSolo) onSolo(); };
  }
}
const swipeState = { bound: false, sx: 0, sy: 0 };
export function renderMonthGrid(state, { onSelectDate, onDrop, onSwipeMonth, onMoreClick }) {
  const grid = $('monthGrid'); if (!grid) return; grid.innerHTML = '';
  const first = new Date(state.viewYear, state.viewMonth, 1); const startDay = first.getDay(); const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate(); const daysInPrev = new Date(state.viewYear, state.viewMonth, 0).getDate(); const today = new Date(); const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id)); const byDay = new Map(); for (const e of state.events) { if (!visibleIds.has(e.accountId)) continue; const key = eventYmd(e); if (!key) continue; if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(e); }
  for (let i = 0; i < 42; i++) { let y = state.viewYear, m = state.viewMonth, d = i - startDay + 1, muted = false; if (d < 1) { m -= 1; if (m < 0) { m = 11; y -= 1; } d = daysInPrev + d; muted = true; } else if (d > daysInMonth) { d = d - daysInMonth; m += 1; if (m > 11) { m = 0; y += 1; } muted = true; } const curYmd = ymd(y, m, d); const evs = byDay.get(curYmd) || []; const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'day-cell'; if (muted) cell.classList.add('muted'); if (curYmd === todayYmd) cell.classList.add('today'); if (curYmd === state.selectedDate) cell.classList.add('selected'); cell.setAttribute('aria-label', `${curYmd} ${evs.length}件${evs.length? ': '+evs.slice(0,2).map(x=>x.summary).join(', '): ''}`);
    let dotsHtml = '';
    if (evs.length) {
      const groups = {};
      evs.forEach(e=>{ const k=e.accountId; groups[k]=(groups[k]||0)+1; });
      const distinct = [];
      const seen=new Set();
      for(const e of evs){ if(!seen.has(e.accountId) && distinct.length<3){ seen.add(e.accountId); distinct.push(e); } }
      dotsHtml = distinct.map((e) => { const a = state.accounts.find((x) => x.id === e.accountId); const col = a ? a.color : '#5B6CFF'; const cnt = groups[e.accountId]>1 ? ` title="${a?.email||''} ${groups[e.accountId]}件"` : ` title="${a?.email||''}"`; return `<i class="dot ${e.allDay ? 'allday' : ''}" style="--c:${col}"${cnt}></i>`; }).join('');
      if (evs.length > 3) dotsHtml += `<span class="more" role="button" tabindex="0" aria-label="他 ${evs.length-3}件を表示" data-more="${curYmd}">+${evs.length - 3}</span>`;
    }
    cell.innerHTML = `<span class="dnum">${d}</span><span class="dots">${dotsHtml}</span>`;
    cell.onclick = () => onSelectDate(curYmd, null);
    let pressTimer; let moved=false;
    cell.addEventListener('touchstart', () => { moved=false; pressTimer = setTimeout(() => { if(!moved){ onSelectDate(curYmd, null); setDrawerDetent('half'); toast('長押し: この日に作成 — FABまたは「この日に追加」から'); try { navigator.vibrate?.(10); } catch {} } }, 700); }, { passive: true });
    cell.addEventListener('touchmove', ()=>{ moved=true; clearTimeout(pressTimer); });
    cell.addEventListener('touchend', () => clearTimeout(pressTimer));
    cell.addEventListener('touchcancel', () => clearTimeout(pressTimer));
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => { e.preventDefault(); cell.classList.remove('drop-target'); const uid = e.dataTransfer.getData('text/plain'); if (uid) onDrop(uid, curYmd); });
    const moreEl = cell.querySelector('[data-more]');
    if (moreEl) {
      moreEl.addEventListener('click', (e)=>{ e.stopPropagation(); onSelectDate(curYmd, null); setDrawerDetent('half'); if(onMoreClick) onMoreClick(curYmd); });
      moreEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); e.stopPropagation(); onSelectDate(curYmd, null); setDrawerDetent('half'); }});
    }
    grid.appendChild(cell);
  }
  if (!swipeState.bound && typeof onSwipeMonth === 'function') { swipeState.bound = true; grid.addEventListener('touchstart', (e) => { swipeState.sx = e.touches[0].clientX; swipeState.sy = e.touches[0].clientY; }, { passive: true }); grid.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - swipeState.sx; const dy = e.changedTouches[0].clientY - swipeState.sy; if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4) { const dir = dx < 0 ? 1 : -1; onSwipeMonth(dir); try { navigator.vibrate?.(8); } catch {} } }, { passive: true }); }
}
export function renderDayDrawer(state, { onEdit, onDelete, onCreate }) {
  const sel = state.selectedDate || null;
  const d = sel ? parseYmd(sel) : null;
  const dateEl = $('drawerDate');
  const cnt = $('drawerCount');
  const list = $('drawerList');
  if (!sel || !d || Number.isNaN(d.getTime())) {
    if (dateEl) dateEl.textContent = '日付を選択してください';
    if (cnt) cnt.textContent = '—';
    if (list) list.innerHTML = '<div class="empty">月グリッドの日付をタップすると<br>予定がここに表示されます</div>';
    return;
  }
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  if (dateEl) dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${w}曜日`;
  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id));
  const evs = state.events.filter((e) => visibleIds.has(e.accountId) && eventYmd(e) === sel).sort((a, b) => new Date(a.start) - new Date(b.start));
  if (cnt) cnt.textContent = `${evs.length}件`;
  if (!list) return; list.innerHTML = '';
  if (!evs.length) { list.innerHTML = '<div class="empty">予定なし — <button type="button" class="link" id="emptyCreate">タップして追加</button></div>'; const b = list.querySelector('#emptyCreate'); if (b) b.onclick = () => onCreate(sel); return; }
  for (const e of evs) { const a = state.accounts.find((x) => x.id === e.accountId); const row = document.createElement('div'); row.className = 'e-row'; row.setAttribute('role','listitem'); row.style.setProperty('--ev', a ? a.color : '#5B6CFF'); row.draggable = true; row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', e.uid); row.classList.add('dragging'); }); row.addEventListener('dragend', () => row.classList.remove('dragging'));
    let timeLabel = ''; if (e.allDay) timeLabel = '<span class="badge">終日</span>'; else { try { const s = new Date(e.start); const en = new Date(e.end); timeLabel = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}<br>${String(en.getHours()).padStart(2, '0')}:${String(en.getMinutes()).padStart(2, '0')}`; } catch { timeLabel = ''; } }
    const loc = e.location ? ` · ${e.location}` : '';
    const acctName = a ? (a.name || a.email) : '';
    row.innerHTML = `<div class="e-time">${timeLabel}</div><div class="e-main"><div class="e-title"></div><div class="e-meta"></div></div><div class="e-dot" style="background:${a ? a.color : '#5B6CFF'}" title="${acctName}"></div><div class="e-actions"><button type="button" class="sm ghost" data-edit>編集</button><button type="button" class="sm ghost" data-del>削除</button></div>`;
    row.querySelector('.e-title').textContent = e.summary || '(無題)';
    row.querySelector('.e-meta').textContent = acctName + loc;
    row.querySelector('[data-edit]').onclick = (ev) => { ev.stopPropagation(); onEdit(e); };
    row.querySelector('[data-del]').onclick = (ev) => { ev.stopPropagation(); onDelete(e); };
    row.onclick = (ev) => { if (ev.target.closest('button')) return; onEdit(e); };
    list.appendChild(row); }
}
export function renderAcctSheet(state, { onToggle, onSolo }) {
  const list = $('acctList'); if (!list) return; list.innerHTML = '';
  if (!state.accounts.length) { list.innerHTML = '<div class="empty">まだアカウントがありません。<br>下のボタンから追加してください。</div>'; return; }
  const solo = state.soloAccountId || null;
  for (const a of state.accounts) {
    const row = document.createElement('label');
    row.className = 'acct-row' + (solo===a.id ? ' solo' : '');
    row.innerHTML = `<span class="av" style="background:${a.color || '#5B6CFF'}">${(a.name || a.email || '?')[0].toUpperCase()}</span><span class="acct-meta"><b></b><small></small></span><input type="checkbox" class="toggle" ${a.visible !== false ? 'checked' : ''}>`;
    row.querySelector('b').textContent = (a.name || a.email || 'account') + (solo===a.id ? ' · Solo' : '');
    row.querySelector('small').textContent = a.email + (a.stale ? ' · 要再連携' : '') + (solo===a.id ? ' · 表示中' : '');
    const cb = row.querySelector('input');
    cb.onchange = (e) => onToggle(a.id, e.target.checked);
    row.addEventListener('dblclick', (e)=>{ e.preventDefault(); if(onSolo) onSolo(a.id); });
    let lp=null;
    row.addEventListener('touchstart', ()=>{ lp=setTimeout(()=>{ if(onSolo) onSolo(a.id); try{navigator.vibrate?.(10)}catch{} }, 600); }, {passive:true});
    row.addEventListener('touchend', ()=> clearTimeout(lp));
    row.addEventListener('touchmove', ()=> clearTimeout(lp));
    list.appendChild(row);
  }
  if (solo) {
    const btn = document.createElement('button'); btn.type='button'; btn.className='ghost'; btn.style.cssText='width:100%;margin-top:8px;min-height:44px;border:1px dashed var(--border);border-radius:10px';
    btn.textContent='Solo解除 — 全て表示';
    btn.onclick=()=> onSolo(null);
    list.appendChild(btn);
  }
}
export function setDrawerDetent(detent) { const d = $('dayDrawer'); if (!d) return; d.classList.remove('peek','half','full','collapsed'); d.classList.add(detent || 'peek'); d.setAttribute('data-detent', detent||'peek'); d.style.height=''; const fab=$('fab'); if(fab) { window.dispatchEvent(new CustomEvent('drawerDetentChange', {detail:detent})); } }
export function fillComposerAccountBtn(state, accountId) {
  const btnLabel = $('composerAccountLabel'); const hidden = $('composerAccount');
  const a = state.accounts.find((x) => x.id === accountId) || state.accounts[0];
  if (btnLabel) btnLabel.textContent = a ? `${a.name || a.email} · ${a.email}`.slice(0,40) : '選択';
  if (hidden) hidden.value = accountId || (a ? a.id : '');
  const calId = hidden ? ($('composerCalendar')?.value || 'primary') : 'primary';
  fillComposerCalendarBtn(state, calId);
}
export function fillComposerCalendarBtn(state, calendarId) {
  const btnLabel = $('composerCalendarLabel'); const hidden = $('composerCalendar');
  const accId = $('composerAccount')?.value;
  const list = state.calendarsByAccount[accId] || [{ id: 'primary', summary: 'primary' }];
  const cur = list.find((c) => c.id === calendarId) || list[0];
  if (btnLabel) btnLabel.textContent = cur ? cur.summary : calendarId;
  if (hidden) hidden.value = cur ? cur.id : calendarId;
}
export function renderComposerAccountList(state, onPick) {
  const list = $('composerAccountList'); if (!list) return; list.innerHTML = '';
  for (const a of state.accounts) { const row = document.createElement('button'); row.type = 'button'; row.className = 'acct-row'; row.style.width = '100%'; row.innerHTML = `<span class="av" style="background:${a.color}">${(a.name || a.email)[0].toUpperCase()}</span><span class="acct-meta" style="text-align:left"><b>${a.name || a.email}</b><small>${a.email}</small></span>`; row.onclick = () => onPick(a.id); list.appendChild(row); }
}
export function renderComposerCalendarList(state, accountId, onPick) {
  const list = $('composerCalendarList'); if (!list) return; list.innerHTML = '';
  const cals = state.calendarsByAccount[accountId] || [{ id: 'primary', summary: 'primary' }];
  for (const c of cals) { const row = document.createElement('button'); row.type = 'button'; row.className = 'acct-row'; row.style.width = '100%'; row.innerHTML = `<span class="acct-meta" style="text-align:left"><b>${c.summary}</b><small>${c.id}${c.primary?' · メイン':''}</small></span>`; row.onclick = () => onPick(c.id); list.appendChild(row); }
}
export function setComposerMode(mode) { const t = $('composerTitle'); if (t) t.textContent = mode === 'edit' ? '予定を編集' : '予定を追加'; const del = $('composerDelete'); if (del) del.hidden = mode !== 'edit'; }
