/** main.mobile v2 — view-first drawer; reliable edit; toggle day to close; account move on edit */
import { allAccountsFresh, cacheMonthEvents, loadMonthEvents, loadMonthMeta, monthKey } from './cache.js';
import { clampYmdToMonth, moveEventToDate, parseYmd as parseYmd2, toLocalInputValue, toYmd } from './dates.js';
import {
  buildEventResource,
  buildTimePatch,
  connectAccount,
  deleteEvent as apiDeleteEvent,
  fetchEventsForAccount,
  initGapiClient,
  initTokenClient,
  insertEvent,
  patchEvent,
  trySilentRefresh,
} from './google.js';
import {
  accountById,
  clearConfigLocal,
  createState,
  eventByUid,
  hasValidConfig,
  isPlaceholder,
  liveAccounts,
  loadConfig,
  persistAccounts,
  restoreAccounts,
  saveConfigToLocal,
} from './state.js';
import * as ui from './ui.mobile.js';

const state = createState();
state.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
state.fromCache = false;
state.soloAccountId = null;
state.selectedDate = null;

let fetchSeq = 0;
let fetchInFlight = null;
let composerMode = 'create';
let fpStart = null;
let fpEnd = null;

function $(id){ return document.getElementById(id); }
function tz(){ return Intl.DateTimeFormat().resolvedOptions().timeZone; }
function currentMonthKey(){ return monthKey(state.viewYear, state.viewMonth); }
function updateConnectivity(){ ui.setStatusDot(state.online, !!state.fromCache); document.body.classList.toggle('is-offline', !state.online); }

function clearDaySelection(){
  state.selectedDate = null;
  const drawer = $('dayDrawer');
  if (drawer){
    drawer.hidden = true;
    drawer.classList.remove('peek','half','full','collapsed');
    drawer.style.height = '';
    drawer.setAttribute('data-detent','peek');
  }
  $('app')?.classList.remove('has-drawer');
  persistAccounts(state);
  paint();
}

function jumpMonth(y,m,{selectDay=null}={}){
  state.viewYear=y; state.viewMonth=m;
  if(selectDay!=null) state.selectedDate=ui.ymd(y,m,selectDay);
  else if(state.selectedDate) state.selectedDate=clampYmdToMonth(state.selectedDate,y,m);
  persistAccounts(state); paint();
  if(liveAccounts(state).length) fetchAll();
}

function paint(){
  updateConnectivity();
  ui.renderHeader(state,{
    onMonthJump:(y,m)=> jumpMonth(y,m),
    onAvatarClick:()=> openAcctSheet(),
    onSolo:(id)=> toggleSolo(id),
  });
  ui.renderMonthGrid(state,{
    onSelectDate:(ymd)=>{
      if(state.selectedDate===ymd){ clearDaySelection(); return; }
      state.selectedDate=ymd;
      const d=parseYmd2(ymd);
      if(d.getFullYear()!==state.viewYear||d.getMonth()!==state.viewMonth){
        state.viewYear=d.getFullYear(); state.viewMonth=d.getMonth();
      }
      persistAccounts(state);
      ui.setDrawerDetent('peek');
      paint();
    },
    onOpenEvent:(ev)=> openComposer('edit',ev),
    onDrop:(uid,ymd)=> handleDrop(uid,ymd),
    onSwipeMonth:(dir)=> shift(dir),
    onMoreClick:()=> ui.setDrawerDetent('half'),
  });
  ui.renderDayDrawer(state,{
    onEdit:(e)=> openComposer('edit',e),
    onDelete:(e)=> askDelete(e),
    onCreate:(ymd)=> openComposer('create',null,ymd),
    onClose:()=> clearDaySelection(),
  });
  ui.renderAcctSheet(state,{
    onToggle:(id,visible)=>{
      const a=accountById(state,id); if(!a) return;
      if(state.soloAccountId){ state.soloAccountId=null; state.accounts.forEach(x=> x.visible=true); }
      a.visible=visible;
      if(!state.accounts.some(x=>x.visible!==false)){ a.visible=true; ui.toast('少なくとも1つは表示が必要'); }
      persistAccounts(state); paint();
    },
    onSolo:(id)=> toggleSolo(id),
  });
  ui.setChromeVisibility(state);
}

function toggleSolo(id){
  const target=id===null?null:id||(state.soloAccountId?null:state.accounts.find(a=>a.visible!==false)?.id||null);
  if(!target||state.soloAccountId===target){
    state.soloAccountId=null; state.accounts.forEach(a=> a.visible=true);
    ui.toast('全て表示に戻しました');
  }else{
    state.soloAccountId=target; state.accounts.forEach(a=> a.visible=a.id===target);
    const acc=accountById(state,target);
    ui.toast(`${acc?.email||'アカウント'} のみ表示`);
  }
  persistAccounts(state); paint();
}

function openAcctSheet(){ const s=$('acctSheet'); if(s) s.hidden=false; }
function closeAcctSheet(){ const s=$('acctSheet'); if(s) s.hidden=true; }
function openSettings(){ const m=$('settingsModal'); if(!m) return; const cid=$('cfgClientId'); const key=$('cfgApiKey'); if(cid) cid.value=state.clientId||''; if(key) key.value=state.apiKey||''; m.classList.add('open'); }
function closeSettings(){ $('settingsModal')?.classList.remove('open'); }

function ensureFlatpickr(){
  const startEl=$('composerStart'); const endEl=$('composerEnd');
  if(!startEl||!endEl||typeof flatpickr!=='function') return;
  const isAllDay= !!$('composerAllDay')?.checked;
  const common={ disableMobile:true, allowInput:false, locale: window.flatpickr?.l10ns?.ja?'ja':undefined, time_24hr:true, minuteIncrement:5 };
  if(fpStart) try{fpStart.destroy();}catch{}
  if(fpEnd) try{fpEnd.destroy();}catch{}
  if(isAllDay){
    fpStart=flatpickr(startEl,{...common,enableTime:false,dateFormat:'Y-m-d'});
    fpEnd=flatpickr(endEl,{...common,enableTime:false,dateFormat:'Y-m-d'});
  }else{
    fpStart=flatpickr(startEl,{...common,enableTime:true,dateFormat:'Y-m-d H:i'});
    fpEnd=flatpickr(endEl,{...common,enableTime:true,dateFormat:'Y-m-d H:i'});
  }
}
function syncComposerTypes(){ ensureFlatpickr(); }

function openComposer(mode,ev=null,ymd=null){
  composerMode=mode; ui.setComposerMode(mode);
  const sheet=$('composerSheet'); const form=$('composerForm'); if(!sheet||!form) return;
  const summary=$('composerSummary'); const allDay=$('composerAllDay'); const loc=$('composerLocation'); const desc=$('composerDesc'); const err=$('composerError');
  if(err){ err.hidden=true; err.textContent=''; } form.reset();
  let accountId=state.createAccountId||liveAccounts(state)[0]?.id||state.accounts[0]?.id||'';
  let calendarId=state.createCalendarId||'primary';
  if(mode==='edit'&&ev){
    state.editingEvent=ev; accountId=ev.accountId; calendarId=ev.calendarId||'primary';
    if(summary) summary.value=ev.summary||'';
    if(loc) loc.value=ev.location||'';
    if(desc) desc.value=ev.description||'';
    if(allDay) allDay.checked=!!ev.allDay;
    ui.fillComposerAccountBtn(state,accountId); ui.fillComposerCalendarBtn(state,calendarId);
    setTimeout(()=>{
      ensureFlatpickr();
      try{
        if(ev.allDay){ if(fpStart) fpStart.setDate(String(ev.start||'').slice(0,10),true); if(fpEnd) fpEnd.setDate(String(ev.end||'').slice(0,10),true); }
        else{ if(fpStart) fpStart.setDate(new Date(ev.start),true); if(fpEnd) fpEnd.setDate(new Date(ev.end),true); }
      }catch{}
    },30);
  }else{
    state.editingEvent=null;
    const targetYmd=ymd||state.selectedDate||toYmd(new Date());
    state.selectedDate=targetYmd; ui.setDrawerDetent('peek');
    const d=parseYmd2(targetYmd); const s=new Date(d); s.setHours(10,0,0,0); const e=new Date(s.getTime()+60*60*1000);
    if(summary) summary.value=''; if(loc) loc.value=''; if(desc) desc.value=''; if(allDay) allDay.checked=false;
    ui.fillComposerAccountBtn(state,accountId); ui.fillComposerCalendarBtn(state,calendarId);
    setTimeout(()=>{ ensureFlatpickr(); try{ if(fpStart) fpStart.setDate(s,true); if(fpEnd) fpEnd.setDate(e,true);}catch{} },30);
  }
  const accHidden=$('composerAccount'); if(accHidden) accHidden.value=accountId;
  const calHidden=$('composerCalendar'); if(calHidden) calHidden.value=calendarId;
  sheet.hidden=false; document.body.style.overflow='hidden';
  setTimeout(()=> summary?.focus(),120);
}

function closeComposer(){ const sheet=$('composerSheet'); if(!sheet) return; sheet.hidden=true; document.body.style.overflow=''; state.editingEvent=null; }

function validateComposer(){
  const summary=$('composerSummary'); const s=$('composerStart'); const e=$('composerEnd'); const err=$('composerError');
  let ok=true; let msg='';
  if(summary&&!summary.value.trim()){ ok=false; msg='タイトルを入力してください'; summary.setCustomValidity(msg); } else if(summary) summary.setCustomValidity('');
  if(s&&!s.value){ ok=false; msg=msg||'開始を入力してください'; s.setCustomValidity(msg); } else if(s) s.setCustomValidity('');
  if(e&&!e.value){ ok=false; msg=msg||'終了を入力してください'; e.setCustomValidity(msg); } else if(e) e.setCustomValidity('');
  if(ok&&s&&e&&s.value&&e.value){
    let sv,ev;
    try{ sv=s._flatpickr?s._flatpickr.selectedDates[0]:new Date(s.value); ev=e._flatpickr?e._flatpickr.selectedDates[0]:new Date(e.value);}catch{ sv=new Date(s.value); ev=new Date(e.value); }
    if(sv&&ev&&!(ev>sv)){ ok=false; msg='終了は開始より後にしてください'; e.setCustomValidity(msg); } else if(e) e.setCustomValidity('');
  }
  if(err){ err.textContent=msg; err.hidden=ok; }
  return ok;
}

async function onComposerSave(){
  if(!validateComposer()){ $('composerForm')?.reportValidity(); return; }
  const summary=$('composerSummary')?.value.trim()||'';
  const location=$('composerLocation')?.value.trim()||'';
  const description=$('composerDesc')?.value.trim()||'';
  const allDay=!!$('composerAllDay')?.checked;
  const accountId=$('composerAccount')?.value||state.createAccountId;
  const calendarId=$('composerCalendar')?.value||'primary';
  let startLocal,endLocal;
  const sEl=$('composerStart'); const eEl=$('composerEnd');
  if(allDay){ startLocal=sEl.value.slice(0,10); endLocal=eEl.value.slice(0,10); }
  else{ const sDate=sEl._flatpickr?.selectedDates[0]||new Date(sEl.value); const eDate=eEl._flatpickr?.selectedDates[0]||new Date(eEl.value); startLocal=toLocalInputValue(sDate); endLocal=toLocalInputValue(eDate); }
  if(!accountId){ ui.toast('アカウントを選んでください','error'); return; }
  const acct=accountById(state,accountId); if(!acct||acct.stale){ ui.toast('有効なアカウントを選んでください','error'); return; }
  state.createAccountId=accountId; state.createCalendarId=calendarId; persistAccounts(state);
  const saveBtn=$('composerSave'); if(saveBtn) saveBtn.disabled=true;
  try{
    if(composerMode==='edit'&&state.editingEvent){
      const cur=state.editingEvent;
      const origAccountId=cur.accountId;
      const origCalendarId=cur.calendarId||'primary';
      const isAccountMove=accountId!==origAccountId;
      const isCalendarMove=calendarId!==origCalendarId;
      const needsMove=isAccountMove||isCalendarMove;
      const resource=buildEventResource({summary,description,location,allDay,startLocal,endLocal,timeZone:tz(),includeTimes:true});
      if(needsMove){
        // Google Calendar has no cross-calendar patch: insert into target then delete original
        // Keep original summary/location if insert fails, do not delete
        await insertEvent(state,accountId,resource,calendarId);
        try{
          await apiDeleteEvent(state,origAccountId,cur.id,origCalendarId,{scope:'single',recurringEventId:cur.recurringEventId});
        }catch(delErr){
          console.warn('move: delete original failed after insert',delErr);
          ui.toast('別カレンダーに複製しました（元は手動削除が必要）','warn');
        }
        ui.toast(isAccountMove?'別アカウントに移動しました':'別カレンダーに移動しました','ok');
      }else{
        await patchEvent(state,cur.accountId,cur.id,resource,cur.calendarId||'primary',{scope:'single',recurringEventId:cur.recurringEventId});
        ui.toast('更新しました','ok');
      }
    }else{
      const resource=buildEventResource({summary,description,location,allDay,startLocal,endLocal,timeZone:tz()});
      await insertEvent(state,accountId,resource,calendarId);
      ui.toast('作成しました','ok');
    }
    closeComposer(); await fetchAll({force:true});
  }catch(err){
    console.error(err); const m=err?.data?.error?.message||err?.message||String(err);
    ui.toast('保存失敗: '+m,'error'); const er=$('composerError'); if(er){ er.textContent='保存失敗: '+m; er.hidden=false; }
  }finally{ if(saveBtn) saveBtn.disabled=false; }
}

function shift(delta){ let m=state.viewMonth+delta; let y=state.viewYear; if(m<0){m=11;y-=1;} else if(m>11){m=0;y+=1;} jumpMonth(y,m); }
function setViewYearMonth(y,m){ jumpMonth(y,m); }
function maybeEnableAuth(){ if(!state.gapiReady||!state.gisReady) return; if(!hasValidConfig(state)) return; initTokenClient(state); paint(); if(liveAccounts(state).length) fetchAll(); }
window.__gapiLoaded=()=>{ gapi.load('client',async()=>{ try{ if(hasValidConfig(state)) await initGapiClient(state); else state.gapiReady=true; maybeEnableAuth(); }catch(err){ console.error(err); state.gapiReady=true; ui.toast('gapi 初期化失敗','error'); }}); };
window.__gisLoaded=()=>{ state.gisReady=true; maybeEnableAuth(); };
async function addAccount(){ if(!hasValidConfig(state)){ ui.toast('設定で Client ID / API Key を保存してください','error'); openSettings(); return; } if(!state.tokenClient){ try{initTokenClient(state);}catch{ui.toast('認証の初期化に失敗','error'); return;}} try{ const account=await connectAccount(state,{mode:'add'}); ui.toast(`${account.email} を追加`,'ok'); closeAcctSheet(); paint(); await fetchAll({force:true}); }catch(err){ const msg=err?.error||err?.message||String(err); ui.toast('連携失敗: '+msg,'error'); }}
function fetchWindow(){ const start=new Date(state.viewYear,state.viewMonth,1,0,0,0,0); const end=new Date(state.viewYear,state.viewMonth+1,0,23,59,59,999); start.setDate(start.getDate()-1); end.setDate(end.getDate()+1); return {timeMin:start.toISOString(),timeMax:end.toISOString()}; }
async function applyCachedMonth(mk){ const cached=await loadMonthEvents(mk); if(!cached.length) return false; const other=state.events.filter(e=> e.monthKey&&e.monthKey!==mk); state.events=[...other,...cached]; state.fromCache=true; return true; }
async function fetchAll(opts={}){ const force=!!opts.force; const mySeq=++fetchSeq; if(fetchInFlight){ try{await fetchInFlight}catch{} if(mySeq!==fetchSeq) return; } const run=(async()=>{ const mk=currentMonthKey(); const targets=liveAccounts(state); const hadCache=await applyCachedMonth(mk); if(hadCache) paint(); if(!targets.length){ paint(); return; } const metaMap=await loadMonthMeta(targets.map(a=>a.id),mk); const fresh=!force&&allAccountsFresh(targets.map(a=>a.id),metaMap); if(!state.online){ state.fromCache=hadCache; paint(); ui.toast(hadCache?'オフライン · キャッシュ表示':'オフライン · キャッシュなし',hadCache?'ok':'error'); return; } if(fresh&&hadCache){ state.fromCache=true; paint(); return; } for(const a of state.accounts){ const tok=state.tokens[a.id]; if(tok?.accessToken&&tok.expiresAt&&tok.expiresAt<Date.now()+120000) await trySilentRefresh(state,a.id); } const live=liveAccounts(state); if(!live.length){ paint(); return; } try{ const win=fetchWindow(); const results=await Promise.allSettled(live.map(a=> fetchEventsForAccount(state,a,win))); if(mySeq!==fetchSeq) return; const merged=[]; let fail=0; for(let i=0;i<results.length;i++){ const r=results[i]; const acc=live[i]; if(r.status==='fulfilled'){ const payload=r.value; const events=Array.isArray(payload)?payload:payload.events||[]; merged.push(...events); await cacheMonthEvents(acc.id,mk,events);} else{ fail++; console.error(acc.email,r.reason); const msg=String(r.reason?.message||r.reason||''); if(msg.includes('401')||r.reason?.status===401) acc.stale=true; } } const other=state.events.filter(e=> e.monthKey&&e.monthKey!==mk); const stamped=merged.map(e=>({...e,monthKey:mk})); const liveIds=new Set(live.map(a=>a.id)); const keptOther=other.filter(e=> !liveIds.has(e.accountId)||e.monthKey); state.events=[...keptOther.filter(e=> e.monthKey!==mk),...stamped]; if(fail){ const cached=await loadMonthEvents(mk); const failedIds=new Set(); results.forEach((r,i)=>{ if(r.status!=='fulfilled') failedIds.add(live[i].id); }); const fromFailed=cached.filter(e=> failedIds.has(e.accountId)); const okIds=new Set(stamped.map(e=>e.uid)); for(const e of fromFailed) if(!okIds.has(e.uid)) state.events.push(e); } persistAccounts(state); state.fromCache=false; if(fail&&!merged.length) ui.toast(`${fail}アカウント取得失敗`,'error'); else if(!merged.length) ui.toast('0件','error'); else ui.toast(`更新 ${merged.length}件`,'ok'); paint(); }catch(err){ console.error(err); ui.toast('取得失敗','error'); }})(); fetchInFlight=run; try{await run} finally{ if(fetchInFlight===run) fetchInFlight=null; } }
function askDelete(ev){ state.pendingDelete={ev,scope:'single'}; const t=$('confirmText'); if(t) t.textContent=`「${ev.summary||'無題'}」を削除しますか？`; $('confirmModal')?.classList.add('open'); }
async function confirmDelete(){ const pending=state.pendingDelete; state.pendingDelete=null; $('confirmModal')?.classList.remove('open'); if(!pending?.ev) return; const {ev,scope}=pending; try{ await apiDeleteEvent(state,ev.accountId,ev.id,ev.calendarId||'primary',{scope:scope||'single',recurringEventId:ev.recurringEventId}); closeComposer(); ui.toast('削除しました','ok'); await fetchAll({force:true}); }catch{ ui.toast('削除失敗','error'); } }
async function handleDrop(uid,ymd){ const ev=eventByUid(state,uid); if(!ev) return; if(accountById(state,ev.accountId)?.stale){ ui.toast('再連携が必要','error'); return; } const times=moveEventToDate(ev,ymd); const resource=buildTimePatch(ev,times,tz()); try{ await patchEvent(state,ev.accountId,ev.id,resource,ev.calendarId||'primary',{scope:'single'}); ui.toast('移動しました','ok'); await fetchAll({force:true}); }catch{ ui.toast('移動失敗','error'); } }
function buildYmPicker(){ const g=$('ymGrid'); if(!g) return; g.innerHTML=''; const base=state.viewYear||new Date().getFullYear(); for(let y=base-2;y<=base+2;y++){ const h=document.createElement('div'); h.className='ym-year'; h.textContent=y+'年'; g.appendChild(h); for(let m=0;m<12;m++){ const b=document.createElement('button'); b.type='button'; b.textContent=m+1+'月'; if(y===state.viewYear&&m===state.viewMonth) b.classList.add('active'); b.onclick=()=>{ const s=$('ymSheet'); if(s) s.hidden=true; setViewYearMonth(y,m); }; g.appendChild(b); } } }
function wire(){
  $('prevBtn')?.addEventListener('click',()=> shift(-1));
  $('nextBtn')?.addEventListener('click',()=> shift(1));
  $('todayBtn')?.addEventListener('click',()=>{ const n=new Date(); jumpMonth(n.getFullYear(),n.getMonth(),{selectDay:n.getDate()}); ui.setDrawerDetent('peek'); });
  $('fab')?.addEventListener('click',()=> openComposer('create',null,state.selectedDate));
  $('drawerExpandBtn')?.addEventListener('click',()=>{ const d=$('dayDrawer'); const cur=d?.getAttribute('data-detent')||'peek'; if(cur==='peek') ui.setDrawerDetent('half'); else if(cur==='half') ui.setDrawerDetent('full'); else ui.setDrawerDetent('peek'); ui.setFabVisibility(state); });
  $('avatarStack')?.addEventListener('click',openAcctSheet);
  $('acctBtn')?.addEventListener('click',openAcctSheet);
  $('acctSheet')?.querySelector('[data-close-acct]')?.addEventListener('click',closeAcctSheet);
  $('addAccountBtn')?.addEventListener('click',addAccount);
  $('openSettingsBtn')?.addEventListener('click',()=>{ closeAcctSheet(); openSettings(); });
  $('monthLabelBtn')?.addEventListener('click',()=>{ buildYmPicker(); const s=$('ymSheet'); if(s) s.hidden=false; });
  document.querySelectorAll('[data-close-ym]').forEach(el=> el.addEventListener('click',()=>{ const s=$('ymSheet'); if(s) s.hidden=true; }));
  document.querySelector('#ymSheet .sheet-backdrop')?.addEventListener('click',()=>{ const s=$('ymSheet'); if(s) s.hidden=true; });
  $('composerSave')?.addEventListener('click',onComposerSave);
  $('composerAllDay')?.addEventListener('change',syncComposerTypes);
  document.querySelectorAll('[data-close-composer]').forEach(b=> b.addEventListener('click',closeComposer));
  $('composerSheet')?.querySelector('.composer-backdrop')?.addEventListener('click',closeComposer);
  $('composerDelete')?.addEventListener('click',()=>{ const ev=state.editingEvent; if(ev) askDelete(ev); });
  $('composerAccountBtn')?.addEventListener('click',()=>{
    const hidden=$('composerAccount');
    ui.renderComposerAccountList(state,(id)=>{
      if(hidden) hidden.value=id; ui.fillComposerAccountBtn(state,id);
      $('composerAccountSheet').hidden=true;
      const calList=state.calendarsByAccount[id]||[];
      const firstCal=calList[0]?.id||'primary';
      const calHidden=$('composerCalendar'); if(calHidden) calHidden.value=firstCal; ui.fillComposerCalendarBtn(state,firstCal);
    });
    $('composerAccountSheet').hidden=false;
  });
  document.querySelector('[data-close-ca-sheet]')?.addEventListener('click',()=>{ $('composerAccountSheet').hidden=true; });
  document.querySelector('#composerAccountSheet .sheet-backdrop')?.addEventListener('click',()=>{ $('composerAccountSheet').hidden=true; });
  $('composerCalendarBtn')?.addEventListener('click',()=>{
    const accId=$('composerAccount')?.value||state.createAccountId;
    ui.renderComposerCalendarList(state,accId,(calId)=>{
      const h=$('composerCalendar'); if(h) h.value=calId; ui.fillComposerCalendarBtn(state,calId);
      $('composerCalendarSheet').hidden=true;
    });
    $('composerCalendarSheet').hidden=false;
  });
  document.querySelector('[data-close-cc-sheet]')?.addEventListener('click',()=>{ $('composerCalendarSheet').hidden=true; });
  document.querySelector('#composerCalendarSheet .sheet-backdrop')?.addEventListener('click',()=>{ $('composerCalendarSheet').hidden=true; });
  $('settingsModal')?.addEventListener('click',(ev)=>{ if(ev.target===$('settingsModal')||ev.target.hasAttribute?.('data-close-settings')) closeSettings(); });
  $('settingsForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault(); const CLIENT_ID=($('cfgClientId')?.value||'').trim(); const API_KEY=($('cfgApiKey')?.value||'').trim();
    if(isPlaceholder(CLIENT_ID)||isPlaceholder(API_KEY)||!CLIENT_ID||!API_KEY){ ui.toast('有効な Client ID と API Key を入力してください','error'); return; }
    saveConfigToLocal({CLIENT_ID,API_KEY}); ui.toast('設定を保存しました。再読み込みします','ok'); setTimeout(()=> location.reload(),400);
  });
  $('clearCfgBtn')?.addEventListener('click',()=>{ clearConfigLocal(); ui.toast('ローカル設定を削除しました'); setTimeout(()=> location.reload(),400); });
  $('confirmCancel')?.addEventListener('click',()=>{ state.pendingDelete=null; $('confirmModal')?.classList.remove('open'); });
  $('confirmOk')?.addEventListener('click',confirmDelete);
  $('confirmModal')?.addEventListener('click',(ev)=>{ if(ev.target===$('confirmModal')){ state.pendingDelete=null; $('confirmModal')?.classList.remove('open'); }});
  const drawer=$('dayDrawer'); let startY=0, startH=0, dragging=false; const handle=drawer?.querySelector('.drawer-handle');
  if(handle){
    handle.addEventListener('click',()=>{ const cur=drawer.getAttribute('data-detent')||'peek'; if(cur==='peek') ui.setDrawerDetent('half'); else if(cur==='half') ui.setDrawerDetent('full'); else ui.setDrawerDetent('peek'); ui.setFabVisibility(state); });
    handle.addEventListener('touchstart',(e)=>{ dragging=true; startY=e.touches[0].clientY; startH=drawer.getBoundingClientRect().height; drawer.style.transition='none'; },{passive:true});
    window.addEventListener('touchmove',(e)=>{ if(!dragging) return; const dy=startY-e.touches[0].clientY; const maxH=window.innerHeight*0.85; const minH=100; const h=Math.min(maxH,Math.max(minH,startH+dy)); drawer.style.height=h+'px'; },{passive:true});
    window.addEventListener('touchend',()=>{ if(!dragging) return; dragging=false; drawer.style.transition=''; const h=drawer.getBoundingClientRect().height; const vh=window.innerHeight; drawer.style.height=''; if(h<vh*0.18) clearDaySelection(); else if(h<vh*0.4) ui.setDrawerDetent('peek'); else if(h<vh*0.65) ui.setDrawerDetent('half'); else ui.setDrawerDetent('full'); ui.setFabVisibility(state); },{passive:true});
  }
  window.addEventListener('drawerDetentChange',()=> ui.setFabVisibility(state));
  window.addEventListener('online',()=>{ state.online=true; updateConnectivity(); if(liveAccounts(state).length) fetchAll({force:true}); });
  window.addEventListener('offline',()=>{ state.online=false; updateConnectivity(); paint(); });
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){ closeAcctSheet(); closeSettings(); const cs=$('composerSheet'); if(cs&&!cs.hidden) closeComposer(); else if(state.selectedDate) clearDaySelection(); $('confirmModal')?.classList.remove('open'); const yms=$('ymSheet'); if(yms&&!yms.hidden) yms.hidden=true; const ca=$('composerAccountSheet'); if(ca&&!ca.hidden) ca.hidden=true; const cc=$('composerCalendarSheet'); if(cc&&!cc.hidden) cc.hidden=true; }
    if(e.key==='ArrowLeft'&&!e.target.closest('input,textarea,[contenteditable]')) shift(-1);
    if(e.key==='ArrowRight'&&!e.target.closest('input,textarea,[contenteditable]')) shift(1);
    if((e.key==='t'||e.key==='T')&&!e.target.closest('input,textarea,[contenteditable]')) $('todayBtn')?.click();
  });
}
async function boot(){
  wire(); restoreAccounts(state); state.selectedDate=null; const now=new Date(); if(!state.viewYear){ state.viewYear=now.getFullYear(); state.viewMonth=now.getMonth(); }
  const mk=currentMonthKey(); const cached=await loadMonthEvents(mk); if(cached.length){ state.events=cached; state.fromCache=true; }
  await loadConfig(state); paint();
  if(window.gapi&&hasValidConfig(state)){ try{ await new Promise(res=>{ if(gapi.client) res(); else gapi.load('client',res); }); await initGapiClient(state);}catch(err){ console.error(err); state.gapiReady=true; }} else state.gapiReady=true;
  if(window.google?.accounts?.oauth2) state.gisReady=true;
  maybeEnableAuth(); ui.setChromeVisibility(state);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
