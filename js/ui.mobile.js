/** ui.mobile — calendar-always, double-tap modal, no drawer peek on single tap */
export const $ = (id) => document.getElementById(id);
export function toast(msg, type = '') { const t = $('toast'); if (!t) return; t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400); }
export function setStatusDot(online, fromCache, { staleCount = 0 } = {}) {
  const d = $('statusDot'); const l = $('statusLabel');
  let kind = 'ok', label = 'オンライン';
  if (!online) { kind = 'off'; label = 'オフライン'; } else if (staleCount > 0) { kind = 'stale'; label = '要再連携'; } else if (fromCache) { kind = 'warn'; label = 'キャッシュ'; }
  if (d) { d.className = 'status-dot ' + kind; d.setAttribute('aria-label', label); }
  if (l) { l.textContent = label; }
  const hint = $('offlineHint'); if (hint) hint.hidden = online;
  const banner = $('sessionBanner'); if (banner) { banner.hidden = !(online && staleCount > 0); const n = $('sessionBannerCount'); if (n) n.textContent = String(staleCount); }
}
export function setChromeVisibility(state){ const chips=$('monthChips'); if(chips) chips.hidden=false; }
export function setFabVisibility(state){
  const fab=$('fab'); if(!fab) return;
  // FAB always for selected day if accounts exist — calendar-always so no drawer dependency
  const hasAccounts=!!(state.accounts&&state.accounts.length);
  const hasSelection=!!state.selectedDate;
  fab.hidden = !(hasAccounts && hasSelection);
  if(!fab.hidden){
    try{ const d=new Date(state.selectedDate+'T12:00:00'); fab.setAttribute('aria-label', `${d.getMonth()+1}/${d.getDate()} に追加`);}catch{ fab.setAttribute('aria-label','予定を作成');}
  }
}
export function ymd(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function parseYmd(s){ const [y,m,d]=String(s||'').split('-').map(Number); return new Date(y,m-1,d); }
function eventYmd(e){ try{ if(e.allDay&&e.start&&String(e.start).length>=10) return String(e.start).slice(0,10); const d=new Date(e.start); if(Number.isNaN(d.getTime())) return ''; return ymd(d.getFullYear(),d.getMonth(),d.getDate()); }catch{return '';} }
export function renderHeader(state,{onMonthJump,onAvatarClick,onSolo,onStatusClick}){
  const label=$('monthLabel'); if(label) label.textContent=`${state.viewYear}年 ${state.viewMonth+1}月`;
  const chips=$('monthChips'); if(chips){ chips.hidden=false; chips.innerHTML=''; for(let d=-2;d<=3;d++){ let m=state.viewMonth+d; let y=state.viewYear; while(m<0){m+=12;y-=1;} while(m>=12){m+=12;y+=1;} const b=document.createElement('button'); b.type='button'; b.className='m-chip'+(d===0?' active':''); b.innerHTML=`${m+1}月`+(y!==state.viewYear?`<span class="m-chip-year">${String(y).slice(-2)}年</span>`:''); b.setAttribute('aria-label',`${y}年${m+1}月`); b.onclick=()=>onMonthJump(y,m); chips.appendChild(b);} }
  const stack=$('avatarStack'); if(stack){ stack.innerHTML=''; const all=state.accounts||[]; const vis=all.filter(a=>a.visible!==false); const soloId=state.soloAccountId||null; if(!all.length){ const empty=document.createElement('span'); empty.className='av more'; empty.textContent='+'; stack.appendChild(empty);} else{ vis.slice(0,3).forEach(a=>{ const el=document.createElement('span'); el.className='av'+(soloId===a.id?' solo':'')+(a.stale?' stale':''); el.style.background=a.color||'#5B6CFF'; el.textContent=(a.name||a.email||'?')[0].toUpperCase(); stack.appendChild(el);}); if(all.length>3){ const more=document.createElement('span'); more.className='av more'; more.textContent=`+${all.length-3}`; stack.appendChild(more);} if(all.some(a=>a.visible===false)||soloId||all.some(a=>a.stale)){ const dot=document.createElement('span'); dot.className='av hidden-badge'+(all.some(a=>a.stale)?' stale':''); dot.textContent=all.some(a=>a.stale)?'!':'·'; stack.appendChild(dot);} } stack.onclick=onAvatarClick; stack.ondblclick=(e)=>{e.preventDefault(); if(onSolo) onSolo();}; let t=null; stack.addEventListener('touchstart',()=>{t=setTimeout(()=>{if(onSolo) onSolo(); try{navigator.vibrate?.(10)}catch{}},600);},{passive:true}); stack.addEventListener('touchend',()=>clearTimeout(t)); stack.addEventListener('touchmove',()=>clearTimeout(t)); stack.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault(); onAvatarClick();} };
  }
  const statusWrap=document.querySelector('.status-wrap'); if(statusWrap&&onStatusClick){ statusWrap.style.cursor='pointer'; statusWrap.onclick=onStatusClick; }
}
// Single tap selects, double tap opens — calendar stays
const swipeState={bound:false,sx:0,sy:0};
const dayTapState={lastYmd:'',lastT:0};
export function renderMonthGrid(state,{onSelectDate,onOpenDay,onDrop,onSwipeMonth}){
  const grid=$('monthGrid'); if(!grid) return; grid.innerHTML='';
  const first=new Date(state.viewYear,state.viewMonth,1); const startDay=first.getDay(); const daysInMonth=new Date(state.viewYear,state.viewMonth+1,0).getDate(); const daysInPrev=new Date(state.viewYear,state.viewMonth,0).getDate(); const today=new Date(); const todayYmd=ymd(today.getFullYear(),today.getMonth(),today.getDate());
  const visibleIds=new Set(state.accounts.filter(a=>a.visible!==false).map(a=>a.id)); const byDay=new Map(); for(const e of state.events){ if(!visibleIds.has(e.accountId)) continue; const key=eventYmd(e); if(!key) continue; if(!byDay.has(key)) byDay.set(key,[]); byDay.get(key).push(e); }
  for(let i=0;i<42;i++){
    let y=state.viewYear,m=state.viewMonth,d=i-startDay+1,muted=false;
    if(d<1){m-=1; if(m<0){m=11;y-=1;} d=daysInPrev+d; muted=true;} else if(d>daysInMonth){d=d-daysInMonth; m+=1; if(m>11){m=0;y+=1;} muted=true;}
    const curYmd=ymd(y,m,d); const evs=byDay.get(curYmd)||[];
    const cell=document.createElement('button'); cell.type='button'; cell.className='day-cell'; if(muted) cell.classList.add('muted'); if(curYmd===todayYmd) cell.classList.add('today'); if(curYmd===state.selectedDate) cell.classList.add('selected');
    cell.setAttribute('aria-label',`${curYmd} ${evs.length}件`);
    let dotsHtml=''; if(evs.length){ const groups={}; evs.forEach(e=>{groups[e.accountId]=(groups[e.accountId]||0)+1;}); const distinct=[]; const seen=new Set(); for(const e of evs){ if(!seen.has(e.accountId)&&distinct.length<3){ seen.add(e.accountId); distinct.push(e);} } dotsHtml=distinct.map(e=>{ const a=state.accounts.find(x=>x.id===e.accountId); const col=a?a.color:'#5B6CFF'; return `<i class="dot ${e.allDay?'allday':''}" style="--c:${col}"></i>`; }).join(''); if(evs.length>3) dotsHtml+=`<span class="more" data-more="${curYmd}">+${evs.length-3}</span>`; }
    cell.innerHTML=`<span class="dnum">${d}</span><span class="dots">${dotsHtml}</span>`;
    cell.addEventListener('click',(e)=>{
      if(e.target.closest('[data-more]')){ onOpenDay(curYmd); return; }
      const now=Date.now(); const isDouble=dayTapState.lastYmd===curYmd && now-dayTapState.lastT<320;
      dayTapState.lastYmd=curYmd; dayTapState.lastT=now;
      if(isDouble){ onOpenDay(curYmd); return; }
      onSelectDate(curYmd);
    });
    // long press still selects (no modal)
    let pressTimer; cell.addEventListener('touchstart',()=>{ pressTimer=setTimeout(()=>{ onSelectDate(curYmd); }, 520); },{passive:true});
    cell.addEventListener('touchend',()=>clearTimeout(pressTimer));
    cell.addEventListener('touchmove',()=>clearTimeout(pressTimer));
    cell.addEventListener('dragover',(e)=>{e.preventDefault(); cell.classList.add('drop-target');});
    cell.addEventListener('dragleave',()=>cell.classList.remove('drop-target'));
    cell.addEventListener('drop',(e)=>{e.preventDefault(); cell.classList.remove('drop-target'); const uid=e.dataTransfer.getData('text/plain'); if(uid) onDrop(uid,curYmd);});
    const moreEl=cell.querySelector('[data-more]'); if(moreEl) moreEl.addEventListener('click',(e)=>{e.stopPropagation(); onOpenDay(curYmd);});
    grid.appendChild(cell);
  }
  if(!swipeState.bound && typeof onSwipeMonth==='function'){ swipeState.bound=true; grid.addEventListener('touchstart',(e)=>{swipeState.sx=e.touches[0].clientX; swipeState.sy=e.touches[0].clientY;},{passive:true}); grid.addEventListener('touchend',(e)=>{ const dx=e.changedTouches[0].clientX-swipeState.sx; const dy=e.changedTouches[0].clientY-swipeState.sy; if(Math.abs(dx)>72 && Math.abs(dx)>Math.abs(dy)*1.4){ onSwipeMonth(dx<0?1:-1); try{navigator.vibrate?.(8)}catch{} }},{passive:true}); }
}
export function renderDayDrawer(state,{onEdit,onDelete,onCreate,onClose}){
  const sel=state.selectedDate||null; const d=sel?parseYmd(sel):null; const dateEl=$('drawerDate'); const cnt=$('drawerCount'); const list=$('drawerList');
  if(!sel||!d||Number.isNaN(d.getTime())){ if(dateEl) dateEl.textContent='日付を選択'; if(cnt) cnt.textContent='—'; if(list) list.innerHTML='<div class="empty">ダブルタップで予定を表示</div>'; return; }
  const w=['日','月','火','水','木','金','土'][d.getDay()]; if(dateEl) dateEl.textContent=`${d.getMonth()+1}月${d.getDate()}日 ${w}`; const visibleIds=new Set(state.accounts.filter(a=>a.visible!==false).map(a=>a.id)); const evs=state.events.filter(e=>visibleIds.has(e.accountId)&&eventYmd(e)===sel).sort((a,b)=>new Date(a.start)-new Date(b.start)); if(cnt) cnt.textContent=`${evs.length}件`; if(!list) return; list.innerHTML=''; if(!evs.length){ const empty=document.createElement('div'); empty.className='empty'; empty.innerHTML='予定なし — <button type="button" class="link" id="emptyCreate">追加</button>'; list.appendChild(empty); empty.querySelector('#emptyCreate').onclick=()=>onCreate(sel); return; } for(const e of evs){ const a=state.accounts.find(x=>x.id===e.accountId); const row=document.createElement('div'); row.className='e-row'; row.style.setProperty('--ev',a?a.color:'#5B6CFF'); let timeLabel=''; if(e.allDay) timeLabel='<span class="badge">終日</span>'; else { try{ const s=new Date(e.start); const en=new Date(e.end); timeLabel=`${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')} — ${String(en.getHours()).padStart(2,'0')}:${String(en.getMinutes()).padStart(2,'0')}`;}catch{ timeLabel=''; } } const loc=e.location?` · ${e.location}`:''; const acctName=a?a.name||a.email:''; row.innerHTML=`<div class="e-time">${timeLabel}</div><div class="e-main"><div class="e-title"></div><div class="e-meta"></div></div><div class="e-dot" style="background:${a?a.color:'#5B6CFF'}"></div><div class="e-actions"><button type="button" class="sm ghost" data-edit>編集</button><button type="button" class="sm danger-soft" data-del>削除</button></div>`; row.querySelector('.e-title').textContent=e.summary||'(無題)'; row.querySelector('.e-meta').textContent=acctName+loc; row.querySelector('[data-edit]').onclick=(ev)=>{ev.stopPropagation(); onEdit(e);}; row.querySelector('[data-del]').onclick=(ev)=>{ev.stopPropagation(); onDelete(e);}; row.onclick=(ev)=>{ if(ev.target.closest('button')) return; onEdit(e);}; list.appendChild(row); }
}
export function renderAcctSheet(state,{onToggle,onSolo,onReauth}){
  const list=$('acctList'); if(!list) return; list.innerHTML='';
  if(!state.accounts.length){ list.innerHTML='<div class="empty">まだアカウントがありません。</div>'; return; }
  const stale=state.accounts.filter(a=>a.stale);
  if(stale.length){ const ban=document.createElement('div'); ban.className='session-card'; ban.innerHTML=`<div class="session-card-body"><strong>セッション切れ</strong><p>${stale.length}件で再連携が必要</p></div><button type="button" class="primary sm" id="reauthAllBtn">再連携</button>`; list.appendChild(ban); ban.querySelector('#reauthAllBtn').onclick=()=>{ if(onReauth) onReauth(null); }; }
  for(const a of state.accounts){ const row=document.createElement('div'); row.className='acct-row'+(a.stale?' stale':''); row.innerHTML=`<span class="av" style="background:${a.color||'#5B6CFF'}">${(a.name||a.email||'?')[0].toUpperCase()}</span><span class="acct-meta"><b>${a.name||a.email}</b><small>${a.email}${a.stale?' · 要再連携':''}</small></span><label class="toggle-wrap"><input type="checkbox" class="toggle" ${a.visible!==false?'checked':''}></label>`; if(a.stale){ const re=document.createElement('button'); re.type='button'; re.className='reauth-btn'; re.textContent='再連携'; re.onclick=()=>{ if(onReauth) onReauth(a.id); }; row.appendChild(re);} row.querySelector('input').onchange=(e)=>onToggle(a.id,e.target.checked); list.appendChild(row); }
}
export function openDaySheet(ymd){ const sheet=$('dayDrawer'); if(!sheet) return; sheet.hidden=false; sheet.classList.add('open'); document.body.style.overflow='hidden'; }
export function closeDaySheet(){ const sheet=$('dayDrawer'); if(!sheet) return; sheet.classList.remove('open'); setTimeout(()=>{ sheet.hidden=true; document.body.style.overflow=''; }, 260); }
