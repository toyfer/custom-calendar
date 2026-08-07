/** main.mobile — calendar-always, double-tap modal, GC/AC benchmark PWA */
import { allAccountsFresh, cacheMonthEvents, loadMonthEvents, loadMonthMeta, monthKey } from './cache.js';
import { clampYmdToMonth, moveEventToDate, parseYmd as parseYmd2, toLocalInputValue, toYmd } from './dates.js';
import { buildEventResource, buildTimePatch, connectAccount, deleteEvent as apiDeleteEvent, fetchEventsForAccount, initGapiClient, initTokenClient, insertEvent, patchEvent, trySilentRefresh } from './google.js';
import { accountById, clearConfigLocal, createState, eventByUid, hasValidConfig, isPlaceholder, liveAccounts, loadConfig, persistAccounts, restoreAccounts, saveConfigToLocal } from './state.js';
import { getStoredTheme, initTheme, setTheme } from './theme.js';
import * as ui from './ui.mobile.js';
const state=createState(); state.online=typeof navigator!=="undefined"?navigator.onLine!==false:true; state.fromCache=false; state.soloAccountId=null; state.selectedDate=null; let fetchSeq=0, fetchInFlight=null, composerMode='create'; let fpStart=null, fpEnd=null; let reauthBusy=false;
function $(id){return document.getElementById(id);}
function tz(){return Intl.DateTimeFormat().resolvedOptions().timeZone;}
function currentMonthKey(){return monthKey(state.viewYear,state.viewMonth);}
function staleCount(){return (state.accounts||[]).filter(a=>a.stale).length;}
function updateConnectivity(){ const sc=staleCount(); ui.setStatusDot(state.online, !!state.fromCache, {staleCount: sc}); document.body.classList.toggle('is-offline', !state.online); }
function clearDaySelection(){ state.selectedDate=null; ui.closeDaySheet(); persistAccounts(state); paint(); }
function openDay(ymd){
  state.selectedDate=ymd; const d=parseYmd2(ymd); if(d.getFullYear()!==state.viewYear||d.getMonth()!==state.viewMonth){ state.viewYear=d.getFullYear(); state.viewMonth=d.getMonth(); }
  persistAccounts(state); paint();
  ui.openDaySheet(ymd);
}
function jumpMonth(y,m){ state.viewYear=y; state.viewMonth=m; if(state.selectedDate) state.selectedDate=clampYmdToMonth(state.selectedDate,y,m); persistAccounts(state); paint(); if(liveAccounts(state).length) fetchAll(); }
function paint(){
  updateConnectivity();
  ui.renderHeader(state,{ onMonthJump:(y,m)=>jumpMonth(y,m), onAvatarClick:()=>openAcctSheet(), onSolo:(id)=>toggleSolo(id), onStatusClick:()=>{ if(staleCount()>0) openAcctSheet(); else openSettings(); } });
  ui.renderMonthGrid(state,{
    onSelectDate:(ymd)=>{ state.selectedDate=ymd; const d=parseYmd2(ymd); if(d.getFullYear()!==state.viewYear||d.getMonth()!==state.viewMonth){ state.viewYear=d.getFullYear(); state.viewMonth=d.getMonth(); } persistAccounts(state); paint(); },
    onOpenDay:(ymd)=> openDay(ymd),
    onDrop:(uid,ymd)=> handleDrop(uid,ymd),
    onSwipeMonth:(dir)=> shift(dir),
  });
  ui.renderDayDrawer(state,{ onEdit:(e)=>openComposer('edit',e), onDelete:(e)=>askDelete(e), onCreate:(ymd)=>openComposer('create',null,ymd), onClose:()=>clearDaySelection() });
  ui.renderAcctSheet(state,{ onToggle:(id,vis)=>{ const a=accountById(state,id); if(!a) return; a.visible=vis; if(!state.accounts.some(x=>x.visible!==false)){a.visible=true; ui.toast('少なくとも1つは表示が必要');} persistAccounts(state); paint(); }, onSolo:(id)=>toggleSolo(id), onReauth:(id)=>reauth(id) });
  ui.setChromeVisibility(state); ui.setFabVisibility(state); ui.syncThemeUI(getStoredTheme());
}
function toggleSolo(id){ const target=id===null?null:id||(state.soloAccountId?null:state.accounts.find(a=>a.visible!==false)?.id||null); if(!target||state.soloAccountId===target){ state.soloAccountId=null; state.accounts.forEach(a=>a.visible=true); ui.toast('全て表示'); } else { state.soloAccountId=target; state.accounts.forEach(a=>a.visible=a.id===target); ui.toast(`${accountById(state,target)?.email||''} のみ`); } persistAccounts(state); paint(); }
function openAcctSheet(){ const s=$('acctSheet'); if(s) s.hidden=false; paint(); }
function closeAcctSheet(){ const s=$('acctSheet'); if(s) s.hidden=true; }
function openSettings(){ const m=$('settingsModal'); if(!m) return; const cid=$('cfgClientId'); const key=$('cfgApiKey'); if(cid) cid.value=state.clientId||''; if(key) key.value=state.apiKey||''; ui.syncThemeUI(getStoredTheme()); m.classList.add('open'); }
function closeSettings(){ $('settingsModal')?.classList.remove('open'); }
async function reauth(accountId){
  if(reauthBusy) return; if(!hasValidConfig(state)){ ui.toast('設定で Client ID / API Key を保存してください','error'); openSettings(); return; }
  if(!state.tokenClient){ try{initTokenClient(state);}catch{ui.toast('認証の初期化に失敗','error'); return;}}
  const targets=accountId ? [accountById(state,accountId)].filter(Boolean) : state.accounts.filter(a=>a.stale);
  if(!targets.length && accountId===null) targets.push(...state.accounts);
  if(!targets.length){ ui.toast('再連携するアカウントがありません'); return; }
  reauthBusy=true; const b=$('sessionReauthBtn'); if(b) b.disabled=true;
  try{ let ok=0; for(const acc of targets){ try{ const silent=await trySilentRefresh(state,acc.id); if(silent){acc.stale=false; ok++; continue;} await connectAccount(state,{mode:'reauth',hintEmail:acc.email}); acc.stale=false; ok++; }catch(err){ console.error('reauth',acc.email,err); acc.stale=true; ui.toast(`${acc.email} の再連携に失敗`,'error'); } } persistAccounts(state); paint(); if(ok){ ui.toast(`${ok}件を再連携`,'ok'); await fetchAll({force:true}); } } finally{ reauthBusy=false; if(b) b.disabled=false; }
}
function ensureFlatpickr(){
  const se=$('composerStart'), ee=$('composerEnd'); if(!se||!ee||typeof flatpickr!=='function') return;
  const isAllDay=!!$('composerAllDay')?.checked;
  const common={disableMobile:true, allowInput:false, locale: window.flatpickr?.l10ns?.ja?'ja':undefined, time_24hr:true, minuteIncrement:5};
  if(fpStart) try{fpStart.destroy();}catch{}
  if(fpEnd) try{fpEnd.destroy();}catch{}
  if(isAllDay){ fpStart=flatpickr(se,{...common,enableTime:false,dateFormat:'Y-m-d'}); fpEnd=flatpickr(ee,{...common,enableTime:false,dateFormat:'Y-m-d'}); } else { fpStart=flatpickr(se,{...common,enableTime:true,dateFormat:'Y-m-d H:i'}); fpEnd=flatpickr(ee,{...common,enableTime:true,dateFormat:'Y-m-d H:i'}); }
}
function syncComposerTypes(){ ensureFlatpickr(); }
function openComposer(mode,ev=null,ymd=null){
  composerMode=mode; ui.setComposerMode(mode);
  const sheet=$('composerSheet'); const form=$('composerForm'); if(!sheet||!form) return;
  const summary=$('composerSummary'); const allDay=$('composerAllDay'); const loc=$('composerLocation'); const desc=$('composerDesc'); const err=$('composerError'); if(err){err.hidden=true; err.textContent='';} form.reset();
  let accountId=state.createAccountId||liveAccounts(state)[0]?.id||state.accounts[0]?.id||'';
  let calendarId=state.createCalendarId||'primary';
  if(mode==='edit'&&ev){ state.editingEvent=ev; accountId=ev.accountId; calendarId=ev.calendarId||'primary'; if(summary) summary.value=ev.summary||''; if(loc) loc.value=ev.location||''; if(desc) desc.value=ev.description||''; if(allDay) allDay.checked=!!ev.allDay; ui.fillComposerAccountBtn(state,accountId); ui.fillComposerCalendarBtn(state,calendarId); setTimeout(()=>{ ensureFlatpickr(); try{ if(ev.allDay){ if(fpStart) fpStart.setDate(String(ev.start||'').slice(0,10),true); if(fpEnd) fpEnd.setDate(String(ev.end||'').slice(0,10),true);} else { if(fpStart) fpStart.setDate(new Date(ev.start),true); if(fpEnd) fpEnd.setDate(new Date(ev.end),true);} }catch{} },30); } else { state.editingEvent=null; const targetYmd=ymd||state.selectedDate||toYmd(new Date()); state.selectedDate=targetYmd; const d=parseYmd2(targetYmd); const s=new Date(d); s.setHours(10,0,0,0); const e=new Date(s.getTime()+60*60*1000); if(summary) summary.value=''; if(loc) loc.value=''; if(desc) desc.value=''; if(allDay) allDay.checked=false; ui.fillComposerAccountBtn(state,accountId); ui.fillComposerCalendarBtn(state,calendarId); setTimeout(()=>{ ensureFlatpickr(); try{ if(fpStart) fpStart.setDate(s,true); if(fpEnd) fpEnd.setDate(e,true);}catch{} },30); }
  const ah=$('composerAccount'); if(ah) ah.value=accountId; const ch=$('composerCalendar'); if(ch) ch.value=calendarId; sheet.hidden=false; document.body.style.overflow='hidden'; setTimeout(()=> summary?.focus(),120);
}
function closeComposer(){ const s=$('composerSheet'); if(!s) return; s.hidden=true; document.body.style.overflow=''; state.editingEvent=null; }
function validateComposer(){
  const summary=$('composerSummary'); const s=$('composerStart'); const e=$('composerEnd'); const err=$('composerError'); let ok=true, msg='';
  if(summary && !summary.value.trim()){ ok=false; msg='タイトルを入力してください'; summary.setCustomValidity(msg);} else if(summary) summary.setCustomValidity('');
  if(s && !s.value){ ok=false; msg=msg||'開始を入力してください'; s.setCustomValidity(msg);} else if(s) s.setCustomValidity('');
  if(e && !e.value){ ok=false; msg=msg||'終了を入力してください'; e.setCustomValidity(msg);} else if(e) e.setCustomValidity('');
  if(ok && s && e && s.value && e.value){ let sv,ev; try{ sv=s._flatpickr?s._flatpickr.selectedDates[0]:new Date(s.value); ev=e._flatpickr?e._flatpickr.selectedDates[0]:new Date(e.value);}catch{ sv=new Date(s.value); ev=new Date(e.value);} if(sv&&ev&&!(ev>sv)){ ok=false; msg='終了は開始より後にしてください'; e.setCustomValidity(msg);} else if(e) e.setCustomValidity(''); }
  if(err){ err.textContent=msg; err.hidden=ok; } return ok;
}
async function onComposerSave(){
  if(!validateComposer()){ $('composerForm')?.reportValidity(); return; }
  const summary=$('composerSummary')?.value.trim()||''; const location=$('composerLocation')?.value.trim()||''; const description=$('composerDesc')?.value.trim()||''; const allDay=!!$('composerAllDay')?.checked; const accountId=$('composerAccount')?.value||state.createAccountId; const calendarId=$('composerCalendar')?.value||'primary'; let sLocal,eLocal; const sEl=$('composerStart'), eEl=$('composerEnd'); if(allDay){ sLocal=sEl.value.slice(0,10); eLocal=eEl.value.slice(0,10);} else { const sD=sEl._flatpickr?.selectedDates[0]||new Date(sEl.value); const eD=eEl._flatpickr?.selectedDates[0]||new Date(eEl.value); sLocal=toLocalInputValue(sD); eLocal=toLocalInputValue(eD); }
  if(!accountId){ ui.toast('アカウントを選んでください','error'); return; } const acct=accountById(state,accountId); if(!acct||acct.stale){ ui.toast('再連携が必要です','error'); openAcctSheet(); return; }
  state.createAccountId=accountId; state.createCalendarId=calendarId; persistAccounts(state); const btn=$('composerSave'); if(btn) btn.disabled=true;
  try{
    if(composerMode==='edit'&&state.editingEvent){ const cur=state.editingEvent; const resource=buildEventResource({summary,description,location,allDay,startLocal:sLocal,endLocal:eLocal,timeZone:tz(),includeTimes:true}); if(accountId!==cur.accountId||calendarId!==(cur.calendarId||'primary')){ await insertEvent(state,accountId,resource,calendarId); try{ await apiDeleteEvent(state,cur.accountId,cur.id,cur.calendarId||'primary',{scope:'single',recurringEventId:cur.recurringEventId}); }catch{ ui.toast('別カレンダーに複製しました（元は手動削除）','error');} ui.toast('移動しました','ok'); } else { await patchEvent(state,cur.accountId,cur.id,resource,cur.calendarId||'primary',{scope:'single',recurringEventId:cur.recurringEventId}); ui.toast('更新しました','ok'); } }
    else { const resource=buildEventResource({summary,description,location,allDay,startLocal:sLocal,endLocal:eLocal,timeZone:tz()}); await insertEvent(state,accountId,resource,calendarId); ui.toast('作成しました','ok'); }
    closeComposer(); await fetchAll({force:true});
  }catch(err){ const m=err?.data?.error?.message||err?.message||String(err); if(String(m).includes('401')||err?.status===401){ if(acct) acct.stale=true; persistAccounts(state); ui.toast('セッション切れ — 再連携してください','error'); paint(); openAcctSheet(); } else ui.toast('保存失敗: '+m,'error'); const er=$('composerError'); if(er){er.textContent='保存失敗: '+m; er.hidden=false;} } finally{ if(btn) btn.disabled=false; }
}
function shift(delta){ let m=state.viewMonth+delta, y=state.viewYear; if(m<0){m=11;y-=1;} else if(m>11){m=0;y+=1;} jumpMonth(y,m); }
function setViewYearMonth(y,m){ jumpMonth(y,m); }
function maybeEnableAuth(){ if(!state.gapiReady||!state.gisReady) return; if(!hasValidConfig(state)) return; initTokenClient(state); paint(); if(liveAccounts(state).length) fetchAll(); }
window.__gapiLoaded=()=>{ gapi.load('client', async()=>{ try{ if(hasValidConfig(state)) await initGapiClient(state); else state.gapiReady=true; maybeEnableAuth(); }catch(err){ console.error(err); state.gapiReady=true; ui.toast('gapi 初期化失敗','error'); }}); };
window.__gisLoaded=()=>{ state.gisReady=true; maybeEnableAuth(); };
async function addAccount(){ if(!hasValidConfig(state)){ ui.toast('設定で Client ID / API Key を保存してください','error'); openSettings(); return; } if(!state.tokenClient){ try{initTokenClient(state);}catch{ui.toast('認証の初期化に失敗','error'); return;}} try{ const a=await connectAccount(state,{mode:'add'}); ui.toast(`${a.email} を追加`,'ok'); closeAcctSheet(); paint(); await fetchAll({force:true}); }catch(err){ const m=err?.error||err?.message||String(err); ui.toast('連携失敗: '+m,'error'); }}
function fetchWindow(){ const s=new Date(state.viewYear,state.viewMonth,1,0,0,0,0); const e=new Date(state.viewYear,state.viewMonth+1,0,23,59,59,999); s.setDate(s.getDate()-1); e.setDate(e.getDate()+1); return {timeMin:s.toISOString(),timeMax:e.toISOString()}; }
async function applyCachedMonth(mk){ const c=await loadMonthEvents(mk); if(!c.length) return false; const o=state.events.filter(e=>e.monthKey&&e.monthKey!==mk); state.events=[...o,...c]; state.fromCache=true; return true; }
async function fetchAll(opts={}){ const force=!!opts.force; const mySeq=++fetchSeq; if(fetchInFlight){ try{await fetchInFlight}catch{} if(mySeq!==fetchSeq) return; } const run=(async()=>{ const mk=currentMonthKey(); const t=liveAccounts(state); const hc=await applyCachedMonth(mk); if(hc) paint(); if(!t.length){ paint(); if(state.accounts.length) ui.toast('再連携が必要です','error'); return; } const mm=await loadMonthMeta(t.map(a=>a.id),mk); const fresh=!force&&allAccountsFresh(t.map(a=>a.id),mm); if(!state.online){ state.fromCache=hc; paint(); ui.toast(hc?'オフライン · キャッシュ表示':'オフライン · キャッシュなし',hc?'ok':'error'); return; } if(fresh&&hc){ state.fromCache=true; paint(); return; } for(const a of state.accounts){ const tok=state.tokens[a.id]; if(tok?.accessToken&&tok.expiresAt&&tok.expiresAt<Date.now()+120000) await trySilentRefresh(state,a.id); } const live=liveAccounts(state); if(!live.length){ paint(); return; } try{ const win=fetchWindow(); const res=await Promise.allSettled(live.map(a=>fetchEventsForAccount(state,a,win))); if(mySeq!==fetchSeq) return; const merged=[]; let fail=0; for(let i=0;i<res.length;i++){ const r=res[i]; const acc=live[i]; if(r.status==='fulfilled'){ const p=r.value; const ev=Array.isArray(p)?p:p.events||[]; merged.push(...ev); await cacheMonthEvents(acc.id,mk,ev);} else { fail++; const msg=String(r.reason?.message||r.reason||''); if(msg.includes('401')||r.reason?.status===401||msg.includes('token')) acc.stale=true; }} const other=state.events.filter(e=>e.monthKey&&e.monthKey!==mk); const stamped=merged.map(e=>({...e,monthKey:mk})); const liveIds=new Set(live.map(a=>a.id)); const kept=other.filter(e=>!liveIds.has(e.accountId)||e.monthKey); state.events=[...kept.filter(e=>e.monthKey!==mk),...stamped]; if(fail){ const cached=await loadMonthEvents(mk); const fids=new Set(); res.forEach((r,i)=>{ if(r.status!=='fulfilled') fids.add(live[i].id); }); const fromF=cached.filter(e=>fids.has(e.accountId)); const ok=new Set(stamped.map(e=>e.uid)); for(const e of fromF) if(!ok.has(e.uid)) state.events.push(e); } persistAccounts(state); state.fromCache=false; if(fail&&!merged.length) ui.toast(`${fail}アカウント取得失敗 — 再連携してください`,'error'); else if(!merged.length) ui.toast('0件','error'); else ui.toast(`更新 ${merged.length}件`,'ok'); paint(); }catch(err){ console.error(err); ui.toast('取得失敗','error'); }})(); fetchInFlight=run; try{await run} finally{ if(fetchInFlight===run) fetchInFlight=null; } }
function askDelete(ev){ ui.openDeleteSheet(state,ev,{ onConfirm: async()=>{ try{ await apiDeleteEvent(state,ev.accountId,ev.id,ev.calendarId||'primary',{scope:'single',recurringEventId:ev.recurringEventId}); closeComposer(); ui.toast('削除しました','ok'); ui.closeDaySheet(); state.selectedDate=null; persistAccounts(state); await fetchAll({force:true}); }catch(err){ const m=err?.message||String(err); if(String(m).includes('401')||err?.status===401){ const a=accountById(state,ev.accountId); if(a) a.stale=true; persistAccounts(state); ui.toast('セッション切れ — 再連携してください','error'); paint(); openAcctSheet(); } else ui.toast('削除失敗','error'); } }}); }
async function handleDrop(uid,ymd){ const ev=eventByUid(state,uid); if(!ev) return; if(accountById(state,ev.accountId)?.stale){ ui.toast('再連携が必要','error'); openAcctSheet(); return; } const times=moveEventToDate(ev,ymd); const res=buildTimePatch(ev,times,tz()); try{ await patchEvent(state,ev.accountId,ev.id,res,ev.calendarId||'primary',{scope:'single'}); ui.toast('移動しました','ok'); await fetchAll({force:true}); }catch{ ui.toast('移動失敗','error'); } }
function buildYmPicker(){ const g=$('ymGrid'); if(!g) return; g.innerHTML=''; const base=state.viewYear||new Date().getFullYear(); for(let y=base-2;y<=base+2;y++){ const h=document.createElement('div'); h.className='ym-year'; h.textContent=y+'年'; g.appendChild(h); for(let m=0;m<12;m++){ const b=document.createElement('button'); b.type='button'; b.textContent=m+1+'月'; if(y===state.viewYear&&m===state.viewMonth) b.classList.add('active'); b.onclick=()=>{ const s=$('ymSheet'); if(s) s.hidden=true; setViewYearMonth(y,m); }; g.appendChild(b);} } }
function wire(){
  initTheme();
  $('prevBtn')?.addEventListener('click',()=>shift(-1));
  $('nextBtn')?.addEventListener('click',()=>shift(1));
  $('todayBtn')?.addEventListener('click',()=>{ const n=new Date(); jumpMonth(n.getFullYear(),n.getMonth()); });
  $('fab')?.addEventListener('click',()=>openComposer('create',null,state.selectedDate||toYmd(new Date())));
  // Day drawer close
  $('dayDrawer')?.querySelector('.drawer-backdrop')?.addEventListener('click',()=> clearDaySelection());
  $('drawerCloseBtn')?.addEventListener('click',()=> clearDaySelection());
  document.querySelector('.drawer-handle')?.addEventListener('click',()=> clearDaySelection());
  $('avatarStack')?.addEventListener('click',openAcctSheet);
  $('acctBtn')?.addEventListener('click',openAcctSheet);
  $('acctSheet')?.querySelector('[data-close-acct]')?.addEventListener('click',closeAcctSheet);
  $('addAccountBtn')?.addEventListener('click',addAccount);
  $('openSettingsBtn')?.addEventListener('click',()=>{ closeAcctSheet(); openSettings();});
  $('sessionReauthBtn')?.addEventListener('click',()=>reauth(null));
  $('sessionBanner')?.querySelector('[data-close-session]')?.addEventListener('click',()=>{ const b=$('sessionBanner'); if(b) b.hidden=true; });
  document.querySelectorAll('[data-theme-option]').forEach(btn=>{ btn.addEventListener('click',()=>{ const m=btn.getAttribute('data-theme-option'); setTheme(m); ui.syncThemeUI(m); ui.toast(m==='system'?'システム設定':m==='dark'?'ダーク':'ライト','ok'); }); });
  $('monthLabelBtn')?.addEventListener('click',()=>{ buildYmPicker(); const s=$('ymSheet'); if(s) s.hidden=false; });
  document.querySelectorAll('[data-close-ym]').forEach(el=> el.addEventListener('click',()=>{ const s=$('ymSheet'); if(s) s.hidden=true; }));
  document.querySelector('#ymSheet .sheet-backdrop')?.addEventListener('click',()=>{ const s=$('ymSheet'); if(s) s.hidden=true; });
  $('composerSave')?.addEventListener('click', onComposerSave);
  $('composerAllDay')?.addEventListener('change', syncComposerTypes);
  document.querySelectorAll('[data-close-composer]').forEach(b=> b.addEventListener('click', closeComposer));
  $('composerSheet')?.querySelector('.composer-backdrop')?.addEventListener('click', closeComposer);
  $('composerDelete')?.addEventListener('click',()=>{ const ev=state.editingEvent; if(ev) askDelete(ev); });
  $('composerAccountBtn')?.addEventListener('click',()=>{ const h=$('composerAccount'); ui.renderComposerAccountList(state,(id)=>{ if(h) h.value=id; ui.fillComposerAccountBtn(state,id); const sheet=$('composerAccountSheet'); if(sheet) sheet.hidden=true; const cl=state.calendarsByAccount[id]||[]; const fc=cl.find(c=>c.writable||c.id==='primary')?.id||cl[0]?.id||'primary'; const ch=$('composerCalendar'); if(ch) ch.value=fc; ui.fillComposerCalendarBtn(state,fc); }); const sheet=$('composerAccountSheet'); if(sheet) sheet.hidden=false; });
  document.querySelector('[data-close-ca-sheet]')?.addEventListener('click',()=>{ const s=$('composerAccountSheet'); if(s) s.hidden=true; });
  document.querySelector('#composerAccountSheet .sheet-backdrop')?.addEventListener('click',()=>{ const s=$('composerAccountSheet'); if(s) s.hidden=true; });
  $('composerCalendarBtn')?.addEventListener('click',()=>{ const accId=$('composerAccount')?.value||state.createAccountId; ui.renderComposerCalendarList(state,accId,(calId)=>{ const h=$('composerCalendar'); if(h) h.value=calId; ui.fillComposerCalendarBtn(state,calId); const s=$('composerCalendarSheet'); if(s) s.hidden=true; }); const s=$('composerCalendarSheet'); if(s) s.hidden=false; });
  document.querySelector('[data-close-cc-sheet]')?.addEventListener('click',()=>{ const s=$('composerCalendarSheet'); if(s) s.hidden=true; });
  document.querySelector('#composerCalendarSheet .sheet-backdrop')?.addEventListener('click',()=>{ const s=$('composerCalendarSheet'); if(s) s.hidden=true; });
  $('settingsModal')?.addEventListener('click',(ev)=>{ if(ev.target===$('settingsModal')||ev.target.hasAttribute?.('data-close-settings')) closeSettings(); });
  $('settingsForm')?.addEventListener('submit',(ev)=>{ ev.preventDefault(); const CLIENT_ID=($('cfgClientId')?.value||'').trim(); const API_KEY=($('cfgApiKey')?.value||'').trim(); if(isPlaceholder(CLIENT_ID)||isPlaceholder(API_KEY)||!CLIENT_ID||!API_KEY){ ui.toast('有効な Client ID と API Key を入力してください','error'); return; } saveConfigToLocal({CLIENT_ID,API_KEY}); ui.toast('設定を保存しました。再読み込みします','ok'); setTimeout(()=>location.reload(),400); });
  $('clearCfgBtn')?.addEventListener('click',()=>{ clearConfigLocal(); ui.toast('ローカル設定を削除しました'); setTimeout(()=>location.reload(),400); });
  window.addEventListener('online',()=>{ state.online=true; updateConnectivity(); if(liveAccounts(state).length) fetchAll({force:true}); });
  window.addEventListener('offline',()=>{ state.online=false; updateConnectivity(); paint(); });
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){
      closeAcctSheet(); closeSettings();
      const ca=$('composerAccountSheet'); if(ca&&!ca.hidden){ ca.hidden=true; return; }
      const cc=$('composerCalendarSheet'); if(cc&&!cc.hidden){ cc.hidden=true; return; }
      const ds=$('deleteSheet'); if(ds&&!ds.hidden){ ds.hidden=true; return; }
      const cs=$('composerSheet'); if(cs&&!cs.hidden){ closeComposer(); return; }
      const dd=$('dayDrawer'); if(dd&&!dd.hidden){ clearDaySelection(); return; }
      const yms=$('ymSheet'); if(yms&&!yms.hidden) yms.hidden=true;
      $('confirmModal')?.classList.remove('open');
    }
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
  maybeEnableAuth();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
