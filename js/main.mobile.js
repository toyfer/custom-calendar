/** main.mobile — month-first real data wiring */
import { VIEWS } from './constants.js';
import { allAccountsFresh, cacheMonthEvents, loadMonthEvents, loadMonthMeta, monthKey, purgeAccountCache } from './cache.js';
import { addDays, clampYmdToMonth, defaultRangeForDay, moveEventToDate, parseYmd as parseYmd2, toLocalInputValue, toYmd } from './dates.js';
import { buildEventResource, buildTimePatch, connectAccount, deleteEvent as apiDeleteEvent, fetchEventsForAccount, initGapiClient, initTokenClient, insertEvent, patchEvent, revokeAndRemove, trySilentRefresh } from './google.js';
import { accountById, createState, eventByUid, hasValidConfig, liveAccounts, loadConfig, persistAccounts, restoreAccounts, saveConfigToLocal, clearConfigLocal, isPlaceholder } from './state.js';
import * as ui from './ui.mobile.js';

const state=createState();
state.online= typeof navigator!=="undefined" ? navigator.onLine!==false : true;
state.fromCache=false;
let fetchSeq=0, fetchInFlight=null, pendingRecurAction=null;
function tz(){ return Intl.DateTimeFormat().resolvedOptions().timeZone(); }
function currentMonthKey(){ return monthKey(state.viewYear, state.viewMonth); }
function updateConnectivity(){ ui.setStatusDot(state.online, !!state.fromCache); document.body.classList.toggle('is-offline', !state.online); }

function paint(){
  updateConnectivity();
  ui.renderHeader(state, {
    onMonthJump:(y,m)=>{ state.viewYear=y; state.viewMonth=m; state.selectedDate=ui.ymd(y,m,1); persistAccounts(state); paint(); if(liveAccounts(state).length) fetchAll(); },
    onAvatarClick:()=>{ $('acctSheet').hidden=false; }
  });
  ui.renderMonthGrid(state, {
    onSelectDate:(ymd, ev)=>{
      state.selectedDate=ymd;
      const d=parseYmd2(ymd);
      if(d.getFullYear()!==state.viewYear || d.getMonth()!==state.viewMonth){ state.viewYear=d.getFullYear(); state.viewMonth=d.getMonth(); }
      persistAccounts(state);
      paint();
      if(ev) openEdit(ev);
      else ui.setDrawerDetent('peek');
    },
    onDrop:(uid, ymd)=> handleDrop(uid, ymd)
  });
  ui.renderDayDrawer(state, {
    onEdit:(e)=> openEdit(e),
    onDelete:(e)=> askDelete(e),
    onCreate:(ymd)=>{ openCreate(ymd); }
  });
  ui.renderAcctSheet(state, {
    onToggle:(id, visible)=>{
      const a=accountById(state,id); if(!a) return; a.visible=visible;
      if(!state.accounts.some(x=>x.visible!==false)){ a.visible=true; ui.toast('少なくとも1つは表示が必要'); }
      persistAccounts(state); paint();
    }
  });
}
function $(id){ return document.getElementById(id); }
function openCreate(ymd){
  state.selectedDate=ymd|| state.selectedDate;
  // open composer sheet - reuse existing composer if present, else use prompt
  const sheet=$('composerSheet');
  if(sheet){ sheet.classList.add('open'); }
  // fallback: if no sheet, use simple prompt create
  if(!sheet){
    const title=prompt('タイトルを入力'); if(!title) return;
    // create event with default 1h
    const start=new Date(parseYmd2(state.selectedDate)); start.setHours(10,0,0,0);
    const end=new Date(start.getTime()+60*60*1000);
    const acct=liveAccounts(state)[0]; if(!acct){ ui.toast('アカウントを連携してください','error'); return; }
    const res=buildEventResource({summary:title, description:'', location:'', allDay:false, startLocal: toLocalInputValue(start), endLocal: toLocalInputValue(end), timeZone: tz()});
    insertEvent(state, acct.id, res, 'primary').then(()=> fetchAll({force:true})).catch(e=> ui.toast('作成失敗: '+(e.message||e),'error'));
  }
}
function shift(delta){
  state.viewMonth+=delta;
  if(state.viewMonth<0){state.viewMonth=11; state.viewYear--}
  else if(state.viewMonth>11){state.viewMonth=0; state.viewYear++}
  state.selectedDate=clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);
  persistAccounts(state); paint(); if(liveAccounts(state).length) fetchAll();
}
function setViewYearMonth(y,m){ state.viewYear=y; state.viewMonth=m; state.selectedDate=ui.ymd(y,m,1); persistAccounts(state); paint(); if(liveAccounts(state).length) fetchAll(); }

// --- Google boot ---
function maybeEnableAuth(){
  if(!state.gapiReady || !state.gisReady) return;
  if(!hasValidConfig(state)){
    ui.toast('設定が必要','error'); return;
  }
  initTokenClient(state);
  paint();
  if(liveAccounts(state).length) fetchAll();
}
window.__gapiLoaded=()=>{ gapi.load('client', async ()=>{ try{ if(hasValidConfig(state)) await initGapiClient(state); else state.gapiReady=true; maybeEnableAuth(); }catch(err){ console.error(err); ui.toast('gapi初期化失敗','error'); }}); };
window.__gisLoaded=()=>{ state.gisReady=true; maybeEnableAuth(); };

async function addAccount(){
  if(!state.tokenClient){ ui.toast('設定でClient ID / API Keyを保存してください','error'); return; }
  try{
    const account=await connectAccount(state,{mode:'add'});
    ui.toast(`${account.email} を追加`,'ok'); paint(); await fetchAll({force:true});
  }catch(err){ const msg=err?.error||err?.message||String(err); ui.toast('連携失敗: '+msg,'error'); }
}
async function reauth(accountId){ const acc=accountById(state,accountId); if(!acc) return; try{ await connectAccount(state,{mode:'reauth', hintEmail:acc.email}); ui.toast(`${acc.email} を再連携`,'ok'); await fetchAll({force:true}); }catch(err){ ui.toast('再連携失敗','error'); }}

// --- fetch cache-first ---
function fetchWindow(){
  const start=new Date(state.viewYear, state.viewMonth,1,0,0,0,0); const end=new Date(state.viewYear, state.viewMonth+1,0,23,59,59,999);
  start.setDate(start.getDate()-1); end.setDate(end.getDate()+1);
  return {timeMin:start.toISOString(), timeMax:end.toISOString()};
}
async function applyCachedMonth(mk){
  const cached=await loadMonthEvents(mk); if(!cached.length) return false;
  const other=state.events.filter(e=> e.monthKey && e.monthKey!==mk);
  state.events=[...other, ...cached]; state.fromCache=true; return true;
}
async function fetchAll(opts={}){
  const force=!!opts.force; const mySeq=++fetchSeq;
  if(fetchInFlight){ try{await fetchInFlight}catch{} if(mySeq!==fetchSeq) return; }
  const run=(async()=>{
    const mk=currentMonthKey(); const targets=liveAccounts(state);
    const hadCache=await applyCachedMonth(mk); if(hadCache) paint();
    if(!targets.length){ paint(); return; }
    const metaMap=await loadMonthMeta(targets.map(a=>a.id), mk);
    const fresh=!force && allAccountsFresh(targets.map(a=>a.id), metaMap);
    if(!state.online){ state.fromCache=hadCache; paint(); ui.toast(hadCache?'オフライン · キャッシュ表示':'オフライン · キャッシュなし', hadCache?'ok':'error'); return; }
    if(fresh && hadCache){ state.fromCache=true; paint(); return; }
    for(const a of state.accounts){ const tok=state.tokens[a.id]; if(tok?.accessToken && tok.expiresAt && tok.expiresAt < Date.now()+120000) await trySilentRefresh(state,a.id); }
    const live=liveAccounts(state); if(!live.length){ paint(); return; }
    try{
      const win=fetchWindow();
      const results=await Promise.allSettled(live.map(a=> fetchEventsForAccount(state,a,win)));
      if(mySeq!==fetchSeq) return;
      const merged=[]; let fail=0;
      for(let i=0;i<results.length;i++){ const r=results[i]; const acc=live[i]; if(r.status==='fulfilled'){ const payload=r.value; const events=Array.isArray(payload)?payload:payload.events||[]; merged.push(...events); await cacheMonthEvents(acc.id, mk, events); } else { fail++; console.error(acc.email, r.reason); if(String(r.reason).includes('401')|| r.reason?.status===401) acc.stale=true; } }
      const other=state.events.filter(e=> e.monthKey && e.monthKey!==mk);
      const stamped=merged.map(e=>({...e, monthKey:mk}));
      const liveIds=new Set(live.map(a=>a.id));
      const keptOther=other.filter(e=> !liveIds.has(e.accountId) || e.monthKey);
      state.events=[...keptOther.filter(e=> e.monthKey!==mk), ...stamped];
      if(fail){ const cached=await loadMonthEvents(mk); const failedIds=new Set(); results.forEach((r,i)=>{ if(r.status!=='fulfilled') failedIds.add(live[i].id); }); const fromFailed=cached.filter(e=> failedIds.has(e.accountId)); const okIds=new Set(stamped.map(e=>e.uid)); for(const e of fromFailed) if(!okIds.has(e.uid)) state.events.push(e); }
      persistAccounts(state); state.fromCache=false;
      if(fail && !merged.length) ui.toast(`${fail}アカウント取得失敗`,'error');
      else if(!merged.length) ui.toast('0件','error');
      else ui.toast(`更新 ${merged.length}件`,'ok');
      paint();
    }catch(err){ console.error(err); ui.toast('取得失敗','error'); }
  })();
  fetchInFlight=run; try{await run} finally{ if(fetchInFlight===run) fetchInFlight=null; }
}

// --- edit/delete ---
function openEdit(ev){ state.editingEvent=ev; const modal=$('editModal'); if(modal){ // reuse existing edit modal from legacy if present
    const t=$('editTitle'); if(t) t.value=ev.summary||''; const s=$('editStart'); const e=$('editEnd');
    try{
      if(ev.allDay){ if(s) s.type='date'; if(e) e.type='date'; if(s) s.value=ev.start?.slice(0,10)||state.selectedDate; if(e) e.value=ev.end?.slice(0,10)||state.selectedDate; }
      else { if(s) s.type='datetime-local'; if(e) e.type='datetime-local'; if(s) s.value=toLocalInputValue(new Date(ev.start)); if(e) e.value=toLocalInputValue(new Date(ev.end)); }
    }catch{}
    modal.classList.add('open');
  } else {
    const title=prompt('タイトル', ev.summary); if(title===null) return; const summary=title.trim(); if(!summary) return;
    const res=buildEventResource({summary, description:ev.description||'', location:ev.location||'', allDay:!!ev.allDay, startLocal: ev.start, endLocal: ev.end, timeZone: tz(), includeTimes:true});
    patchEvent(state, ev.accountId, ev.id, res, ev.calendarId||'primary', {scope:'single'}).then(()=> fetchAll({force:true}));
  }
}
function askDelete(ev){ if(confirm(`「${ev.summary}」を削除しますか？`)){ apiDeleteEvent(state, ev.accountId, ev.id, ev.calendarId||'primary', {scope:'single'}).then(()=> fetchAll({force:true})); } }
async function handleDrop(uid, ymd){
  const ev=eventByUid(state, uid); if(!ev) return;
  if(accountById(state,ev.accountId)?.stale){ ui.toast('再連携が必要','error'); return; }
  const times=moveEventToDate(ev, ymd);
  const resource=buildTimePatch(ev, times, tz());
  try{ await patchEvent(state, ev.accountId, ev.id, resource, ev.calendarId||'primary', {scope:'single'}); ui.toast('移動しました','ok'); await fetchAll({force:true}); }catch(err){ ui.toast('移動失敗','error'); }
}

function wire(){
  $('prevBtn')?.addEventListener('click', ()=> shift(-1));
  $('nextBtn')?.addEventListener('click', ()=> shift(1));
  $('todayBtn')?.addEventListener('click', ()=>{ const n=new Date(); state.viewYear=n.getFullYear(); state.viewMonth=n.getMonth(); state.selectedDate=toYmd(n); persistAccounts(state); paint(); if(liveAccounts(state).length) fetchAll(); });
  $('fab')?.addEventListener('click', ()=> openCreate(state.selectedDate));
  $('drawerAddBtn')?.addEventListener('click', ()=> openCreate(state.selectedDate));
  $('avatarStack')?.addEventListener('click', ()=> $('acctSheet').hidden=false);
  $('acctBtn')?.addEventListener('click', ()=> $('acctSheet').hidden=false);
  $('acctSheet')?.querySelector('[data-close-acct]')?.addEventListener('click', ()=> $('acctSheet').hidden=true);
  $('monthLabelBtn')?.addEventListener('click', ()=> $('ymPicker')?.showModal());
  // YM picker build
  const g=$('ymGrid'); if(g){ g.innerHTML=''; for(let y=state.viewYear-2; y<=state.viewYear+2; y++){ const h=document.createElement('div'); h.className='ym-year'; h.textContent=y+'年'; g.appendChild(h); for(let m=0;m<12;m++){ const b=document.createElement('button'); b.textContent=(m+1)+'月'; b.onclick=()=>{ $('ymPicker').close(); setViewYearMonth(y,m); }; g.appendChild(b); } } }
  // add account button if exists
  const addBtn=$('addAccountBtn'); if(addBtn) addBtn.onclick=addAccount; else $('acctSheet')?.insertAdjacentHTML('beforeend', '<button id="addAccountBtn2" class="primary" style="margin-top:12px; width:100%">アカウントを追加</button>');
  $('addAccountBtn2')?.addEventListener('click', addAccount);
  // drawer drag
  const drawer=$('dayDrawer'); let startY=0, startH=0;
  drawer?.querySelector('.drawer-handle')?.addEventListener('touchstart', e=>{ startY=e.touches[0].clientY; startH=drawer.getBoundingClientRect().height; drawer.style.transition='none'; },{passive:true});
  window.addEventListener('touchmove', e=>{ if(!startY) return; const dy=startY - e.touches[0].clientY; const h=Math.min(window.innerHeight*0.88, Math.max(window.innerHeight*0.28, startH+dy)); drawer.style.height=h+'px'; },{passive:true});
  window.addEventListener('touchend', ()=>{ if(startY){ drawer.style.transition=''; drawer.style.height=''; startY=0; } },{passive:true});
  window.addEventListener('online', ()=>{ state.online=true; updateConnectivity(); if(liveAccounts(state).length) fetchAll({force:true}); });
  window.addEventListener('offline', ()=>{ state.online=false; updateConnectivity(); paint(); });
  // edit modal close
  $('editModal')?.addEventListener('click', e=>{ if(e.target.id==='editModal') e.target.classList.remove('open');});
}

async function boot(){
  wire();
  restoreAccounts(state);
  const now=new Date(); if(!state.viewYear){ state.viewYear=now.getFullYear(); state.viewMonth=now.getMonth(); }
  if(!state.selectedDate) state.selectedDate=toYmd(now);
  state.selectedDate=clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);
  const mk=currentMonthKey(); const cached=await loadMonthEvents(mk); if(cached.length){ state.events=cached; state.fromCache=true; }
  await loadConfig(state);
  paint();
  if(window.gapi && hasValidConfig(state)){
    try{ await new Promise(res=>{ if(gapi.client) res(); else gapi.load('client', res);}); await initGapiClient(state); }catch(e){ state.gapiReady=true; }
  } else state.gapiReady=true;
  if(window.google?.accounts?.oauth2) state.gisReady=true;
  maybeEnableAuth();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
