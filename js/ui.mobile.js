/** ui.mobile — month-first one-thumb rendering (iPhone-safe) */
export const $ = (id) => document.getElementById(id);
export function toast(msg, type = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
export function setStatusDot(online, fromCache) {
  const d = $('statusDot');
  if (!d) return;
  d.className = 'status-dot ' + (online ? (fromCache ? 'warn' : 'ok') : 'off');
  d.setAttribute('aria-label', online ? (fromCache ? 'キャッシュ表示中' : 'オンライン') : 'オフライン');
  const hint = $('offlineHint');
  if (hint) hint.hidden = online;
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
  } catch { return ''; }
}
export function renderHeader(state, { onMonthJump, onAvatarClick }) {
  const label = $('monthLabel');
  if (label) label.textContent = `${state.viewYear}年 ${state.viewMonth + 1}月`;
  const chips = $('monthChips');
  if (chips) {
    chips.innerHTML = '';
    for (let d = -2; d <= 3; d++) {
      let m = state.viewMonth + d; let y = state.viewYear;
      while (m < 0) { m += 12; y -= 1; } while (m >= 12) { m += 12; y += 1; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'm-chip' + (d === 0 ? ' active' : ''); b.textContent = `${m + 1}月`;
      b.onclick = () => onMonthJump(y, m);
      chips.appendChild(b);
    }
  }
  const stack = $('avatarStack');
  if (stack) {
    stack.innerHTML = '';
    const vis = state.accounts.filter((a) => a.visible !== false);
    const all = state.accounts;
    vis.slice(0, 3).forEach((a) => {
      const el = document.createElement('span'); el.className = 'av'; el.style.background = a.color || '#5B6CFF'; el.textContent = (a.name || a.email || '?')[0].toUpperCase(); stack.appendChild(el);
    });
    if (all.length > 3) { const more = document.createElement('span'); more.className = 'av more'; more.textContent = `+${all.length - 3}`; stack.appendChild(more); }
    if (all.some((a) => a.visible === false)) { const dot = document.createElement('span'); dot.className = 'av hidden-badge'; dot.textContent = '·'; stack.appendChild(dot); }
    if (!all.length) { const empty = document.createElement('span'); empty.className = 'av more'; empty.textContent = '+'; stack.appendChild(empty); }
    stack.onclick = onAvatarClick;
    stack.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAvatarClick(); } };
  }
}
const swipeState = { bound: false, sx: 0, sy: 0 };
export function renderMonthGrid(state, { onSelectDate, onDrop, onSwipeMonth }) {
  const grid = $('monthGrid'); if (!grid) return; grid.innerHTML = '';
  const first = new Date(state.viewYear, state.viewMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(state.viewYear, state.viewMonth, 0).getDate();
  const today = new Date(); const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id));
  const byDay = new Map();
  for (const e of state.events) { if (!visibleIds.has(e.accountId)) continue; const key = eventYmd(e); if (!key) continue; if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(e); }
  for (let i = 0; i < 42; i++) {
    let y = state.viewYear, m = state.viewMonth, d = i - startDay + 1, muted = false;
    if (d < 1) { m -= 1; if (m < 0) { m = 11; y -= 1; } d = daysInPrev + d; muted = true; }
    else if (d > daysInMonth) { d = d - daysInMonth; m += 1; if (m > 11) { m = 0; y += 1; } muted = true; }
    const curYmd = ymd(y, m, d);
    const evs = byDay.get(curYmd) || [];
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'day-cell';
    if (muted) cell.classList.add('muted');
    if (curYmd === todayYmd) cell.classList.add('today');
    if (curYmd === state.selectedDate) cell.classList.add('selected');
    cell.setAttribute('aria-label', `${curYmd} ${evs.length}件`);
    const dotsHtml = evs.slice(0, 4).map((e) => { const a = state.accounts.find((x) => x.id === e.accountId); const col = a ? a.color : '#5B6CFF'; return `<i class="dot ${e.allDay ? 'allday' : ''}" style="--c:${col}"></i>`; }).join('') + (evs.length > 4 ? `<span class="more">+${evs.length - 4}</span>` : '');
    cell.innerHTML = `<span class="dnum">${d}</span><span class="dots">${dotsHtml}</span>`;
    cell.onclick = () => onSelectDate(curYmd, null);
    let pressTimer; cell.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { onSelectDate(curYmd, null); toast('長押し: この日に作成'); try { navigator.vibrate?.(10); } catch {} }, 450); }, { passive: true });
    cell.addEventListener('touchend', () => clearTimeout(pressTimer));
    cell.addEventListener('touchmove', () => clearTimeout(pressTimer));
    cell.addEventListener('touchcancel', () => clearTimeout(pressTimer));
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => { e.preventDefault(); cell.classList.remove('drop-target'); const uid = e.dataTransfer.getData('text/plain'); if (uid) onDrop(uid, curYmd); });
    grid.appendChild(cell);
  }
  if (!swipeState.bound && typeof onSwipeMonth === 'function') {
    swipeState.bound = true;
    grid.addEventListener('touchstart', (e) => { swipeState.sx = e.touches[0].clientX; swipeState.sy = e.touches[0].clientY; }, { passive: true });
    grid.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - swipeState.sx;
      const dy = e.changedTouches[0].clientY - swipeState.sy;
      if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4) { onSwipeMonth(dx < 0 ? 1 : -1); try { navigator.vibrate?.(8); } catch {} }
    }, { passive: true });
  }
}
export function renderDayDrawer(state, { onEdit, onDelete, onCreate }) {
  const sel = state.selectedDate || ymd(state.viewYear, state.viewMonth, 1);
  const d = parseYmd(sel); const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const dateEl = $('drawerDate'); if (dateEl) dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${w}曜日`;
  const visibleIds = new Set(state.accounts.filter((a) => a.visible !== false).map((a) => a.id));
  const evs = state.events.filter((e) => visibleIds.has(e.accountId) && eventYmd(e) === sel).sort((a, b) => new Date(a.start) - new Date(b.start));
  const cnt = $('drawerCount'); if (cnt) cnt.textContent = `${evs.length}件`;
  const list = $('drawerList'); if (!list) return; list.innerHTML = '';
  if (!evs.length) { list.innerHTML = '<div class="empty">予定なし — <button type="button" class="link" id="emptyCreate">タップして追加</button></div>'; const b = list.querySelector('#emptyCreate'); if (b) b.onclick = () => onCreate(sel); return; }
  for (const e of evs) {
    const a = state.accounts.find((x) => x.id === e.accountId);
    const row = document.createElement('div'); row.className = 'e-row'; row.style.setProperty('--ev', a ? a.color : '#5B6CFF'); row.draggable = true;
    row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', e.uid); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    let timeLabel = '';
    if (e.allDay) timeLabel = '<span class="badge">終日</span>';
    else { try { const s = new Date(e.start); const en = new Date(e.end); timeLabel = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}<br>${String(en.getHours()).padStart(2, '0')}:${String(en.getMinutes()).padStart(2, '0')}`; } catch { timeLabel = ''; } }
    const loc = e.location ? ` · ${e.location}` : '';
    row.innerHTML = `<div class="e-time">${timeLabel}</div><div class="e-main"><div class="e-title"></div><div class="e-meta"></div></div><div class="e-dot" style="background:${a ? a.color : '#5B6CFF'}"></div><div class="e-actions"><button type="button" class="sm ghost" data-edit>編集</button><button type="button" class="sm ghost" data-del>削除</button></div>`;
    row.querySelector('.e-title').textContent = e.summary || '(無題)'; row.querySelector('.e-meta').textContent = (a ? a.email : '') + loc;
    row.querySelector('[data-edit]').onclick = (ev) => { ev.stopPropagation(); onEdit(e); };
    row.querySelector('[data-del]').onclick = (ev) => { ev.stopPropagation(); onDelete(e); };
    row.onclick = (ev) => { if (ev.target.closest('button')) return; onEdit(e); };
    list.appendChild(row);
  }
}
export function renderAcctSheet(state, { onToggle }) {
  const list = $('acctList'); if (!list) return; list.innerHTML = '';
  if (!state.accounts.length) { list.innerHTML = '<div class="empty">まだアカウントがありません。<br>下のボタンから追加してください。</div>'; return; }
  for (const a of state.accounts) {
    const row = document.createElement('label'); row.className = 'acct-row';
    row.innerHTML = `<span class="av" style="background:${a.color || '#5B6CFF'}">${(a.name || a.email || '?')[0].toUpperCase()}</span><span class="acct-meta"><b></b><small></small></span><input type="checkbox" class="toggle" ${a.visible !== false ? 'checked' : ''}>`;
    row.querySelector('b').textContent = a.name || a.email || 'account'; row.querySelector('small').textContent = a.email + (a.stale ? ' · 要再連携' : '');
    row.querySelector('input').onchange = (e) => onToggle(a.id, e.target.checked);
    list.appendChild(row);
  }
}
export function setDrawerDetent(detent) {
  const d = $('dayDrawer'); if (!d) return; d.classList.remove('peek', 'half', 'full', 'collapsed'); d.classList.add(detent || 'peek'); d.style.height = '';
}
/* Composer helpers */
export function fillComposerCalendars(state, accountId){
  const accSel=$('composerAccount'); const calSel=$('composerCalendar'); if(!accSel||!calSel) return;
  accSel.innerHTML='';
  for(const a of state.accounts){
    const o=document.createElement('option'); o.value=a.id; o.textContent=a.email; if(a.id===accountId) o.selected=true; accSel.appendChild(o);
  }
  const cals=state.calendarsByAccount[accountId]|| [{id:'primary', summary:'primary'}];
  calSel.innerHTML='';
  for(const c of cals){
    const o=document.createElement('option'); o.value=c.id; o.textContent=c.summary + (c.primary?' (メイン)':''); if(c.id===(state.createCalendarId||'primary')) o.selected=true; calSel.appendChild(o);
  }
}
export function setComposerMode(mode){
  const t=$('composerTitle'); if(t) t.textContent= mode==='edit' ? '予定を編集' : '予定を追加';
  const del=$('composerDelete'); if(del) del.hidden = mode!=='edit';
}
