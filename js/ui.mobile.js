/** ui.mobile — month-first one-thumb rendering */
export const $ = (id)=> document.getElementById(id);
export function toast(msg, type=''){
  const t=$('toast'); if(!t) return; t.textContent=msg; t.className='toast show'+(type? ' '+type:'');
  clearTimeout(toast._t); toast._t=setTimeout(()=> t.classList.remove('show'), 2200);
}
export function setStatusDot(online, fromCache){
  const d=$('statusDot'); if(!d) return;
  d.className='status-dot '+(online? (fromCache?'warn':'ok'):'off');
  d.setAttribute('aria-label', online? (fromCache?'キャッシュ表示中':'オンライン'):'オフライン');
  const hint=$('offlineHint'); if(hint) hint.hidden= online;
}
export function ymd(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function parseYmd(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d);}
export function renderHeader(state, {onMonthJump, onAvatarClick}){
  const label=$('monthLabel'); if(label) label.textContent=`${state.viewYear}年 ${state.viewMonth+1}月`;
  const chips=$('monthChips'); if(chips){
    chips.innerHTML='';
    for(let d=-2; d<=3; d++){
      let m=state.viewMonth+d, y=state.viewYear; while(m<0){m+=12; y--} while(m>=12){m-=12; y++}
      const b=document.createElement('button'); b.className='m-chip'+(d===0?' active':''); b.textContent=`${m+1}月`;
      b.onclick=()=> onMonthJump(y,m);
      chips.appendChild(b);
    }
  }
  const stack=$('avatarStack'); if(stack){
    stack.innerHTML='';
    const vis=state.accounts.filter(a=>a.visible!==false);
    const all=state.accounts;
    vis.slice(0,3).forEach(a=>{
      const el=document.createElement('span'); el.className='av'; el.style.background=a.color||'#5B6CFF'; el.textContent=(a.name||a.email||'?')[0].toUpperCase(); stack.appendChild(el);
    });
    if(all.length>3){ const more=document.createElement('span'); more.className='av more'; more.textContent=`+${all.length-3}`; stack.appendChild(more); }
    if(all.some(a=>a.visible===false)){ const dot=document.createElement('span'); dot.className='av hidden-badge'; dot.textContent='·'; stack.appendChild(dot); }
    stack.onclick=onAvatarClick;
    stack.onkeydown=(e)=>{ if(e.key==='Enter'|| e.key===' ') onAvatarClick(); };
  }
}
export function renderMonthGrid(state, {onSelectDate, onDrop}){
  const grid=$('monthGrid'); if(!grid) return;
  grid.innerHTML='';
  const first=new Date(state.viewYear, state.viewMonth,1);
  const startDay=first.getDay();
  const daysInMonth=new Date(state.viewYear, state.viewMonth+1,0).getDate();
  const daysInPrev=new Date(state.viewYear, state.viewMonth,0).getDate();
  const today=new Date(); const todayYmd=ymd(today.getFullYear(), today.getMonth(), today.getDate());
  // visible account filter for dots
  const visibleIds=new Set(state.accounts.filter(a=>a.visible!==false).map(a=>a.id));
  const byDay=new Map();
  for(const e of state.events){
    if(!visibleIds.has(e.accountId)) continue;
    // e.start is ISO string, get ymd
    let ymdKey='';
    try{
      const d=new Date(e.start); ymdKey=ymd(d.getFullYear(), d.getMonth(), d.getDate());
      if(e.allDay && e.start){
        // allDay events store date string YYYY-MM-DD
        if(e.start.length===10) ymdKey=e.start;
      }
    }catch{}
    if(!ymdKey) continue;
    if(!byDay.has(ymdKey)) byDay.set(ymdKey, []);
    byDay.get(ymdKey).push(e);
  }
  for(let i=0;i<42;i++){
    let y=state.viewYear, m=state.viewMonth, d=i-startDay+1, muted=false;
    if(d<1){ m--; if(m<0){m=11; y--} d=daysInPrev+d; muted=true; }
    else if(d>daysInMonth){ d=d-daysInMonth; m++; if(m>11){m=0; y++} muted=true; }
    const curYmd=ymd(y,m,d);
    const evs=byDay.get(curYmd)||[];
    const cell=document.createElement('button');
    cell.className='day-cell';
    if(muted) cell.classList.add('muted');
    if(curYmd===todayYmd) cell.classList.add('today');
    if(curYmd===state.selectedDate) cell.classList.add('selected');
    cell.setAttribute('aria-label', `${curYmd} ${evs.length}件`);
    // dots
    const dotsHtml=evs.slice(0,4).map(e=>{
      const a=state.accounts.find(x=>x.id===e.accountId); const col=a?a.color:'#5B6CFF';
      const isAllDay=!!e.allDay;
      return `<i class="dot ${isAllDay?'allday':''}" style="--c:${col}"></i>`;
    }).join('') + (evs.length>4? `<span class="more">+${evs.length-4}</span>`:'');
    cell.innerHTML=`<span class="dnum">${d}</span><span class="dots">${dotsHtml}</span>`;
    cell.onclick=()=> onSelectDate(curYmd, null);
    // long-press for create
    let timer; cell.addEventListener('touchstart',()=>{ timer=setTimeout(()=>{ onSelectDate(curYmd, null); toast('長押し: この日に作成'); if(navigator.vibrate) navigator.vibrate(10); }, 420); },{passive:true});
    cell.addEventListener('touchend',()=> clearTimeout(timer));
    cell.addEventListener('touchmove',()=> clearTimeout(timer));
    // drag drop target
    cell.addEventListener('dragover', e=>{ e.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', ()=> cell.classList.remove('drop-target'));
    cell.addEventListener('drop', e=>{ e.preventDefault(); cell.classList.remove('drop-target'); const uid=e.dataTransfer.getData('text/plain'); if(uid) onDrop(uid, curYmd); });
    // make events draggable via dots? handled in drawer, but also allow drag from cell via long press not needed
    grid.appendChild(cell);
  }
  // swipe
  let sx=0;
  grid.addEventListener('touchstart', e=> sx=e.touches[0].clientX, {passive:true});
  grid.addEventListener('touchend', e=>{
    const dx=e.changedTouches[0].clientX - sx;
    if(Math.abs(dx)>64){ if(dx<0) $('nextBtn')?.click(); else $('prevBtn')?.click(); if(navigator.vibrate) navigator.vibrate(8); }
  }, {passive:true});
}
export function renderDayDrawer(state, {onEdit, onDelete, onCreate}){
  const d=parseYmd(state.selectedDate|| ymd(state.viewYear, state.viewMonth,1));
  const w=['日','月','火','水','木','金','土'][d.getDay()];
  const dateEl=$('drawerDate'); if(dateEl) dateEl.textContent=`${d.getMonth()+1}月${d.getDate()}日 ${w}曜日`;
  const visibleIds=new Set(state.accounts.filter(a=>a.visible!==false).map(a=>a.id));
  const evs=state.events.filter(e=>{
    if(!visibleIds.has(e.accountId)) return false;
    try{
      const s=new Date(e.start); const key=ymd(s.getFullYear(), s.getMonth(), s.getDate());
      if(e.allDay && e.start && e.start.length===10) return e.start===state.selectedDate;
      return key===state.selectedDate;
    }catch{ return false; }
  }).sort((a,b)=> new Date(a.start)-new Date(b.start));
  const cnt=$('drawerCount'); if(cnt) cnt.textContent=`${evs.length}件`;
  const list=$('drawerList'); if(!list) return;
  list.innerHTML='';
  if(!evs.length){
    list.innerHTML=`<div class="empty">予定なし — <button class="link" id="emptyCreate">タップして追加</button></div>`;
    const b=list.querySelector('#emptyCreate'); if(b) b.onclick=()=> onCreate(state.selectedDate);
    return;
  }
  for(const e of evs){
    const a=state.accounts.find(x=>x.id===e.accountId);
    const row=document.createElement('div'); row.className='e-row'; row.style.setProperty('--ev', a?a.color:'#5B6CFF');
    row.draggable=true;
    row.addEventListener('dragstart', ev=>{ ev.dataTransfer.setData('text/plain', e.uid); row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=> row.classList.remove('dragging'));
    let timeLabel='';
    if(e.allDay) timeLabel='<span class="badge">終日</span>';
    else {
      try{ const s=new Date(e.start); const en=new Date(e.end); timeLabel=`${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')} — ${String(en.getHours()).padStart(2,'0')}:${String(en.getMinutes()).padStart(2,'0')}`; }catch{ timeLabel=''; }
    }
    const loc=e.location? ` · ${e.location}`:'';
    row.innerHTML=`<div class="e-time">${timeLabel}</div><div class="e-main"><div class="e-title">${e.summary||'(無題)'}</div><div class="e-meta">${a?a.email:''}${loc}</div></div><div class="e-dot" style="background:${a?a.color:'#5B6CFF'}"></div><div class="e-actions"><button class="sm ghost" data-edit>編集</button><button class="sm ghost" data-del>削除</button></div>`;
    row.querySelector('[data-edit]').onclick=()=> onEdit(e);
    row.querySelector('[data-del]').onclick=()=> onDelete(e);
    row.onclick=(ev)=>{ if(ev.target.closest('button')) return; onEdit(e); };
    list.appendChild(row);
  }
}
export function renderAcctSheet(state, {onToggle}){
  const list=$('acctList'); if(!list) return;
  list.innerHTML='';
  for(const a of state.accounts){
    const row=document.createElement('label'); row.className='acct-row';
    row.innerHTML=`<span class="av" style="background:${a.color}">${(a.name||a.email||'?')[0].toUpperCase()}</span><span class="acct-meta"><b>${a.name||a.email}</b><small>${a.email}${a.stale?' · 要再連携':''}</small></span><input type="checkbox" ${a.visible!==false?'checked':''} class="toggle">`;
    const inp=row.querySelector('input'); inp.onchange=(e)=> onToggle(a.id, e.target.checked);
    list.appendChild(row);
  }
}
export function setDrawerDetent(detent){
  const d=$('dayDrawer'); if(!d) return;
  d.classList.remove('peek','half','full','collapsed');
  d.classList.add(detent);
  if(detent==='peek') d.style.height='36vh';
  else if(detent==='half') d.style.height='52vh';
  else if(detent==='full') d.style.height='88vh';
  else d.style.height='';
}
