import {DISCOVERY_KEY,FEED_SETTINGS_KEY,readFeedSettings,rankByFreshness,TOPICS,escapeHTML as esc,sanitizeEdition,readDiscoveryState,importDiscoveryState,allPicks,addInbox,filterPicks,ageLabel,videoTopics,interleavePicks,validPickId} from '/discovery-lib.mjs';
import {filterVideos,formatDuration} from '/lib.mjs';
import {PROFILE_KEY,readProfile,validateProfile,profileLabel,canonicalView,customTopicBoost,importedProfile} from '/profile-lib.mjs';
const $=s=>document.querySelector(s);
let widgetsPromise;
function loadWidgets() {
 if(window.twttr?.widgets?.createTweet)return Promise.resolve(window.twttr);
 if(widgetsPromise)return widgetsPromise;
 widgetsPromise=new Promise((resolve,reject)=>{
  let script=document.getElementById('x-widgets');
  const timer=setTimeout(()=>{script?.remove();reject(Error('X did not respond.'));},12000);
  const ready=()=>{if(window.twttr?.widgets?.createTweet){clearTimeout(timer);resolve(window.twttr);}else{clearTimeout(timer);script?.remove();reject(Error('X embeds are unavailable.'));}};
  if(!script){script=document.createElement('script');script.id='x-widgets';script.src='https://platform.twitter.com/widgets.js';script.async=true;script.onload=ready;script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('X embeds are blocked.'));};document.head.append(script);}else script.addEventListener('load',ready,{once:true});
 }).catch(error=>{widgetsPromise=null;throw error;});
 return widgetsPromise;
}
export function initDiscovery(hooks) {
 let profile;try{profile=readProfile(localStorage.getItem(PROFILE_KEY));}catch{profile=readProfile(null);}
 // One compatibility adapter: only rename the three personal routes, keeping hashes and filters.
 const legacyQuery=new URLSearchParams(location.search),legacyView=legacyQuery.get('view');
 if(canonicalView(legacyView)!==legacyView){legacyQuery.set('view',canonicalView(legacyView));history.replaceState(null,'',`${location.pathname}?${legacyQuery}${location.hash}`);}
 let state,storageOK=true;
 try {state=readDiscoveryState(localStorage.getItem(DISCOVERY_KEY));}catch{state=readDiscoveryState(null);storageOK=false;}
 let edition=sanitizeEdition(null),status='loading',error='',loadPromise,token=0,limit=36,lastURL='',returnScroll=0;
 const route=()=>{const v=new URLSearchParams(location.search).get('view');return location.hash.startsWith('#/pick/')||(!location.hash.startsWith('#/watch/')&&(!v||['for-you','saved-discoveries','inbox'].includes(v)));};
 let feedSettings;try{feedSettings=readFeedSettings(localStorage.getItem(FEED_SETTINGS_KEY));}catch{feedSettings=readFeedSettings(null);}
 const params=()=>{const p=new URLSearchParams(location.search);return {...readFeedSettings({sort:p.has('sort')?p.get('sort'):feedSettings.sort,window:p.has('window')?p.get('window'):feedSettings.window}),view:p.get('view')||'for-you',q:p.get('q')||'',topic:p.get('topic')||'',source:p.get('source')||'',dismissed:p.get('dismissed')==='1'};};
 function mixedResults(f,contextTopics=[],exclude='') {
  const y=f.source==='x'?[]:rankedVideos(f,contextTopics).filter(v=>v.vid!==exclude&&!hooks.getYTState().disliked.includes(v.vid)||f.dismissed&&v.vid!==exclude);
  const x=f.source==='youtube'?[]:rankedX(f,contextTopics).filter(p=>p.id!==exclude);
  return rankByFreshness(interleavePicks(y,x,y.length+x.length),{...f,getItem:entry=>entry.item});
 }
 function nextMarkup(contextTopics,exclude,count=6){const f={...params(),view:'for-you',dismissed:false};const watched=new Set(hooks.getYTState().history);return mixedResults(f,contextTopics,exclude).filter(({kind,item})=>kind!=='youtube'||!watched.has(item.vid)).slice(0,count).map(({kind,item})=>kind==='x'?xCard(item,true):videoMarkup(item)).join('');}
 const picks=()=>allPicks(edition,state);
 const current=()=>picks().find(p=>p.id===location.hash.slice('#/pick/'.length));
 function persist(){try{localStorage.setItem(DISCOVERY_KEY,JSON.stringify(state));}catch{storageOK=false;hooks.notify('Storage is blocked. Your feedback and links are session-only.');}}
 function xActions(p){return `<div class="pick-actions">${[['saved','+ Save','✓ Saved'],['more','More like this','✓ More like this'],['dismissed','Not for me','Undo dismissal']].map(([key,off,on])=>`<button class="button" data-pick-action="${key}" data-pick-id="${esc(p.id)}" aria-pressed="${state[key].includes(p.id)}">${state[key].includes(p.id)?on:off}</button>`).join('')}${p.manual?`<button class="text-button" data-delete-pick="${esc(p.id)}">Delete link</button>`:''}</div>`;}
 const sourceLink=p=>`<a class="source-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open on X ↗</a>`;
 function xCard(p,compact=false) {
  const source=`<div class="pick-topline"><span>X · ${p.manual?'SHARED LINK · NOT YET CURATED':'VIDEO PICK'}</span>${state.saved.includes(p.id)?'<span>✓ SAVED</span>':''}</div>`;
  return `<article class="pick-card ${compact?'pick-compact':''}" data-pick-card="${esc(p.id)}">${source}${p.thumbnail?`<a class="thumbnail pick-thumbnail" href="#/pick/${esc(p.id)}" aria-label="Watch ${esc(p.title)}"><img src="${esc(p.thumbnail)}" alt="" loading="lazy" decoding="async" width="480" height="270"><span class="pick-play" aria-hidden="true">▶</span>${p.duration_s?`<span class="duration">${formatDuration(p.duration_s)}</span>`:''}</a>`:''}<p class="pick-byline">${esc(p.creator||'Added by you')} · ${p.manual?'Manually added · '+esc(ageLabel(p.addedAt)):`<time datetime="${esc(p.published)}">${esc(ageLabel(p.published))}</time>`}</p><h3><a href="#/pick/${esc(p.id)}">${esc(p.title)}</a></h3>${p.manual?`<p>${esc(p.note||'A link you added. No editorial review or summary yet.')}</p>`:`<p class="pick-summary">${esc(p.summary)}</p><div class="pick-reason"><span>WHY FOR YOU</span><p>${esc(p.why)}</p></div><div class="pick-borrow"><span>BORROW THIS</span><p>${esc(p.borrow)}</p></div>`}<div class="tags">${p.topics.map(t=>`<span>${esc(edition.interests.find(i=>i.id===t)?.label||t)}</span>`).join('')}</div><div class="pick-links"><a class="pick-open" href="#/pick/${esc(p.id)}">${p.manual?'Open shared post':'Watch / read pick'} ↗</a>${sourceLink(p)}</div>${compact?'':xActions(p)}</article>`;
 }
 function videoMarkup(v){return `<div class="mixed-video" data-mixed-video="${esc(v.vid)}"><div class="pick-topline">YOUTUBE · ${v.provenance==='editorial'?'CURATED':'HN ARCHIVE'}</div>${hooks.videoCard(v)}<div class="mixed-feedback"><button class="text-button" data-action="liked" data-id="${esc(v.vid)}" aria-pressed="${hooks.getYTState().liked.includes(v.vid)}">${hooks.getYTState().liked.includes(v.vid)?'♥ Liked':'More like this'}</button><button class="text-button" data-action="disliked" data-id="${esc(v.vid)}">${hooks.getYTState().disliked.includes(v.vid)?'Undo not interested':'Not for me'}</button></div></div>`;}
 function rankedVideos(f={},contextTopics=[]) {
  const yt=hooks.getYTState(),all=hooks.getVideos();
  let result=filterVideos(all,{q:f.q,view:f.view==='saved-discoveries'?'saved':'discover'},yt);
  if(f.view==='inbox')return [];
  if(f.dismissed)result=all.filter(v=>yt.disliked.includes(v.vid)).filter(v=>!f.q||filterVideos([v],{q:f.q,view:'saved'},{...yt,saved:[v.vid]}).length);
  if(f.topic)result=result.filter(v=>videoTopics(v).includes(f.topic));
  const weights=new Map(TOPICS.map(t=>[t.id,state.interests[t.id]===false?-1:1]));
  for(const p of edition.items)if(state.more.includes(p.id))for(const t of p.topics)weights.set(t,(weights.get(t)||0)+3);
  for(const t of contextTopics)weights.set(t,(weights.get(t)||0)+5);
  return result.map((v,i)=>({v,i,score:customTopicBoost(v,profile)+videoTopics(v).reduce((n,t)=>n+(weights.get(t)||0),0)})).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.v);
 }
 function rankedX(f={},contextTopics=[]) {
  const interests={...state.interests};
  let result=filterPicks(picks(),f,{...state,interests});
  const likedTopics=new Set(hooks.getVideos().filter(v=>hooks.getYTState().liked.includes(v.vid)).flatMap(videoTopics));
  const topics=new Set([...likedTopics,...contextTopics]);
  return result.map((p,i)=>({p,i,score:customTopicBoost(p,profile)+p.topics.filter(t=>topics.has(t)).length})).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.p);
 }
 function taste(){return `<details class="source-taste" id="source-taste"><summary>Sources & taste <span>How this feed is made</span></summary><div class="taste-content"><h2>A starting point, not a profile.</h2><p>Suggested interests are editable in Settings. Checked interests boost matching videos and picks; they don’t hide everything else. “More like this” also boosts matching topics across sources, on this device.</p><button class="button" data-preferences>Edit your interests in Settings</button><h2>Hand-curated, not live-monitored.</h2><p>X picks belong to a hand-curated edition${edition.edition?' dated '+esc(edition.edition):''}. Dates are original publication dates, not a claim of freshness. Older discoveries are labeled. YouTube mixes a hand-curated fresh YouTube edition with the historical Hacker News archive from Karpathy’s HackerTube dataset. This is not live ingestion. Recent + relevant balances original publication dates with your interests; Newest orders all sources chronologically. Publication date windows exclude unknown or future dates; verification and inbox-added dates never count as publication.</p><div class="source-list">${edition.sources.map(s=>`<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.handle)} ↗</a> — ${esc(s.reason)}</p>`).join('')||'<p>Source notes will appear with the curated edition.</p>'}</div><p>Feedback, taste changes, and dropped links are local-only. Your curator does not receive them until you export and share the feedback file. No background monitoring, scheduled jobs, X API keys, or downloaded/rehosted X videos.</p><button class="button" data-discovery-data>Export / import feedback</button></div></details>`;}
 async function load(force=false){if(loadPromise&&!force)return loadPromise;status='loading';loadPromise=(async()=>{try{const r=await fetch('/data/discoveries.json');if(!r.ok)throw Error(`Edition request failed (${r.status})`);const data=await r.json();if(!data||!Array.isArray(data.items))throw Error('Invalid edition format');edition=sanitizeEdition(data);status='ready';error='';}catch(e){status='error';error=e.message;}if(route())render();else hooks.updateNav();})();return loadPromise;}
 function renderFeed(){
  const f=params(),query=new URLSearchParams(location.search);
  // Snapshot defaults into this history entry so Back cannot inherit a later preference.
  if(!query.has('sort')||!query.has('window')){if(!query.has('sort'))query.set('sort',f.sort);if(!query.has('window'))query.set('window',f.window);history.replaceState(null,'',`${location.pathname}?${query}${location.hash}`);}
  const url=location.search;if(url!==lastURL){limit=36;lastURL=url;}
  const results=mixedResults(f),mixed=results.slice(0,limit),total=results.length;
  $('#main').innerHTML=`<h1 class="feed-page-title">${f.view==='saved-discoveries'?'Saved discoveries':f.view==='inbox'?'Link inbox':esc(profileLabel(profile))}</h1>${f.view==='inbox'?'<button class="button" data-drop-link>+ Drop a link</button>':''}<div class="area-strip" role="group" aria-label="Filter mixed feed by topic"><button class="chip ${!f.topic?'active':''}" data-pick-topic="" aria-pressed="${!f.topic}">All interests</button>${edition.interests.map(t=>`<button class="chip ${f.topic===t.id?'active':''}" data-pick-topic="${esc(t.id)}" aria-pressed="${f.topic===t.id}">${esc(t.label)}</button>`).join('')}</div><section aria-label="Mixed discoveries"><div class="toolbar"><div class="results-title">${f.q?'Search results':f.dismissed?'Dismissed discoveries':f.view==='saved-discoveries'?'Saved picks & videos':'The good stuff'} <small>${total.toLocaleString()} finds</small></div><div class="filter-controls"><select id="feed-sort" aria-label="Sort discoveries">${[['recent','Recent + relevant'],['for-you','For you'],['newest','Newest']].map(([value,label])=>`<option value="${value}" ${f.sort===value?'selected':''}>${label}</option>`).join('')}</select><select id="feed-window" aria-label="Publication date">${[['all','All time'],['30','Past month'],['90','Past 3 months'],['365','Past year']].map(([value,label])=>`<option value="${value}" ${f.window===value?'selected':''}>${label}</option>`).join('')}</select><select aria-label="Source" id="pick-source">${[['','All sources'],['youtube','YouTube'],['x','X']].map(([value,label])=>`<option value="${value}" ${f.source===value?'selected':''}>${label}</option>`).join('')}</select><button class="text-button" data-show-dismissed>${f.dismissed?'Hide dismissed':'Show dismissed'}</button>${f.q||f.topic||f.source||f.window!=='all'?'<button class="text-button" data-clear-picks>Clear filters</button>':''}</div></div>${f.dismissed?'<p class="fine-print">Dismissed items are hidden from recommendations. Use Undo to bring one back.</p>':''}${hooks.getVideoStatus()==='loading'?'<p class="fine-print" role="status">YouTube archive is loading independently. X picks and your links are ready to use.</p>':hooks.getVideoStatus()==='error'?'<p class="feed-warning">The YouTube archive could not load. Your X picks still work. <button class="text-button" data-retry-youtube>Retry archive</button></p>':''}${status==='loading'?'<p class="fine-print" role="status">Opening the curated edition…</p>':status==='error'?`<p class="feed-warning">The X edition could not load. Your local links and YouTube archive are still available. <button class="text-button" data-retry-edition>Retry edition</button> <span>${esc(error)}</span></p>`:''}<div class="grid mixed-grid" id="mixed-grid">${mixed.map(({kind,item})=>kind==='x'?xCard(item):videoMarkup(item)).join('')}</div>${!total?'<div class="empty"><h2>No finds here yet.</h2><p>Try another topic or search, drop a link, or undo a dismissal.</p></div>':''}${total>limit?'<div class="load-more-wrap"><button class="button" data-more-picks>More discoveries</button></div>':''}</section>${taste()}`;
  document.title=`iTube — ${f.view==='saved-discoveries'?'Saved discoveries':f.view==='inbox'?'Link inbox':profileLabel(profile)}`;
 }
 async function mountEmbed(p,t){
  const target=$('#x-embed'),notice=$('#x-embed-status');if(!target)return;
  notice.textContent='Loading the official X embed…';
  try{const twttr=await loadWidgets();if(t!==token||!target.isConnected)return;const result=await Promise.race([twttr.widgets.createTweet(p.postId,target,{dnt:true,theme:'light',align:'center',conversation:'none'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('The embed timed out.')),15000))]);if(t!==token||!target.isConnected)return;notice.textContent=result?'Official X embed. Playback and availability are controlled by X.':'X could not display this post. It may be unavailable or blocked. Open the original source below.';}catch{if(t===token&&notice.isConnected)notice.textContent='X embeds are unavailable or blocked in this browser. You can always open the original post below.';}
 }
 function renderDetail(t){
  const id=location.hash.slice('#/pick/'.length),p=validPickId(id)?current():null;
  if(!p){$('#main').innerHTML=`<div class="empty"><h1>${status==='loading'?'Opening this pick…':'That pick is not in this edition.'}</h1><a class="button" href="${backURL()}">Back to ${esc(profileLabel(profile))}</a>${status==='error'?'<button class="button" data-retry-edition>Retry edition</button>':''}</div>`;return;}
  const next=nextMarkup(p.topics,p.id,5);
  $('#main').innerHTML=`<a class="back-link" href="${backURL()}" data-pick-back>← Back to ${esc(profileLabel(profile))}</a><div class="watch-layout pick-detail"><section><div class="eyebrow">X · ${p.manual?'MANUALLY ADDED · NOT YET CURATED':p.media==='video'?'VIDEO PICK':'CURATED POST'}</div><h1 class="watch-title">${esc(p.title)}</h1><p class="pick-byline">${esc(p.creator||'Added by you')} · ${esc(p.manual?'Added '+ageLabel(p.addedAt):ageLabel(p.published))}${p.verifiedAt?' · Source checked '+esc(ageLabel(p.verifiedAt)):''}</p><div id="pick-detail-actions">${xActions(p)}</div><div class="x-embed-shell"><div id="x-embed" data-post-id="${esc(p.postId)}"></div><p class="fine-print" id="x-embed-status" role="status">Official X embed loads on this page only.</p><button class="text-button" data-retry-embed>Load / retry X embed</button><p>${sourceLink(p)}</p></div>${p.manual?`<h2 class="section-label">Your note</h2><p class="watch-summary">${esc(p.note||'No note added. This link has not had an editorial review.')}</p>`:`<p class="watch-summary">${esc(p.summary)}</p><h2 class="section-label">Why for you</h2><p class="watch-summary">${esc(p.why)}</p><h2 class="section-label">Borrow this</h2><p class="watch-summary">${esc(p.borrow)}</p>`}<div class="pick-resource-links">${(p.links||[]).map(l=>`<a class="button" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div><p class="fine-print">${p.manual?'Shared locally, not curated.':`Hand-curated edition ${esc(edition.edition||'undated')}. Source checked, not a guarantee of every claim.`} Feedback stays on this device until exported and shared.</p></section><aside class="related"><h2 class="related-heading">Up next · across sources</h2>${next}${!next&&hooks.getVideoStatus()==='loading'?'<p class="fine-print">YouTube recommendations are loading…</p>':''}</aside></div>`;
  document.title=`${p.title} — iTube`;mountEmbed(p,t);
 }
 function backURL(){const p=new URLSearchParams(location.search);if(!['for-you','saved-discoveries','inbox'].includes(p.get('view')))p.set('view','for-you');return '?'+p.toString();}
 function render(){if(location.hash.startsWith('#/pick/')&&current()&&current().postId===$('#x-embed')?.dataset.postId){const p=current();$('#pick-detail-actions').innerHTML=xActions(p);const next=$('.pick-detail .related');if(next){next.innerHTML='<h2 class="related-heading">Up next · across sources</h2>'+nextMarkup(p.topics,p.id,5);}hooks.updateNav();return;}const tasteOpen=$('#source-taste')?.open;++token;hooks.updateNav();$('#search').setAttribute('aria-label','Search videos and X picks');$('#search').placeholder='Search videos, picks, ideas…';if(location.hash.startsWith('#/pick/'))renderDetail(token);else{renderFeed();if(tasteOpen&&$('#source-taste'))$('#source-taste').open=true;}if(!loadPromise)load();}
 function refresh(){if(route())render();else hooks.updateNav();}
 function persistProfile(){try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));return true;}catch{storageOK=false;return false;}}
 function prepareSettings(){
  $('#profile-name').value=profile.name;$('#profile-handle').value=profile.handle;$('#profile-topics').value=profile.topics.join('\n');
  $('#profile-error').textContent='';
  for(const field of ['name','handle','topics'])$('#profile-'+field).setAttribute('aria-invalid','false');
  $('#profile-interests').innerHTML=TOPICS.map(t=>`<label class="interest-option"><input type="checkbox" data-profile-interest="${esc(t.id)}" ${state.interests[t.id]?'checked':''}><span><strong>${esc(t.label)}</strong><small>${esc(t.reason)}</small></span></label>`).join('');
 }
 $('#profile-form').addEventListener('submit',e=>{
  e.preventDefault();const result=validateProfile({name:$('#profile-name').value,handle:$('#profile-handle').value,topics:$('#profile-topics').value});
  for(const field of ['name','handle','topics'])$('#profile-'+field).setAttribute('aria-invalid',String(!!result.errors[field]));
  $('#profile-error').textContent=Object.values(result.errors).join(' ');
  if(!result.ok){const field=Object.keys(result.errors)[0];$('#profile-'+field)?.focus();return;}
  profile=result.profile;const stored=persistProfile();
  for(const t of TOPICS){const input=document.querySelector(`[data-profile-interest="${t.id}"]`);if(input)state.interests[t.id]=input.checked;}
  persist();prepareSettings();refresh();
  hooks.notify(stored&&storageOK?'Settings saved in this browser. Nothing was sent.':'Storage is blocked. Settings last for this session only. Export to keep them.');
 });
 $('#profile-reset').addEventListener('click',()=>{
  if(!confirm('Reset only your name, X username and custom topics? Saved items, history, suggested interests and feedback will not change.'))return;
  profile=readProfile(null);const stored=persistProfile();prepareSettings();refresh();hooks.notify(stored?'Profile reset. Saved items, history and feedback kept.':'Profile reset for this session only; storage is blocked.');
 });
 $('#preferences').addEventListener('close',prepareSettings);
 function dataDialog(){const el=$('#discovery-data');$('#discovery-storage').textContent=storageOK?'Saved in this browser. Export and share with your curator to pass on feedback and links.':'Storage is blocked. Changes last for this session only. Export to keep them.';if(!el.open)el.showModal();}
 document.addEventListener('click',e=>{
  const target=e.target.closest('button,a');if(!target)return;
  if(target.matches('a[href^="#/pick/"]')){returnScroll=window.scrollY;hooks.cancelSearch();}
  if(target.matches('[data-pick-back]')){e.preventDefault();hooks.navigate({});requestAnimationFrame(()=>window.scrollTo(0,returnScroll));}
  if(target.matches('[data-pick-action]')){const id=target.dataset.pickId,key=target.dataset.pickAction;if(!['saved','more','dismissed'].includes(key)||!picks().some(p=>p.id===id))return;const active=state[key].includes(id);state[key]=active?state[key].filter(x=>x!==id):[id,...state[key]];if(!active&&key==='more')state.dismissed=state.dismissed.filter(x=>x!==id);if(!active&&key==='dismissed')state.more=state.more.filter(x=>x!==id);persist();hooks.notify(key==='dismissed'?active?'Dismissal undone.':'Hidden from recommendations. Use Show dismissed to undo.':key==='more'?active?'Topic boost removed.':'Matching topics boosted across X and YouTube, on this device.':active?'Removed from Saved.':'Saved on this device.');if(location.hash.startsWith('#/pick/')){render();}else refresh();}
  if(target.matches('[data-delete-pick]')){const id=target.dataset.deletePick;if(!confirm('Delete this local link?'))return;state.inbox=state.inbox.filter(p=>p.id!==id);for(const k of ['saved','more','dismissed'])state[k]=state[k].filter(x=>x!==id);persist();if(location.hash.startsWith('#/pick/'))hooks.navigate({view:'inbox'});else refresh();}
  if(target.matches('[data-pick-topic]'))hooks.navigate({topic:target.dataset.pickTopic});
  if(target.matches('[data-show-dismissed]'))hooks.navigate({dismissed:params().dismissed?'':'1'});
  if(target.matches('[data-clear-picks]'))hooks.navigate({q:'',topic:'',source:'',dismissed:'',window:'all'});
  if(target.matches('[data-more-picks]')){const old=limit;limit+=36;render();$('#mixed-grid')?.children[old]?.querySelector('a')?.focus({preventScroll:true});}
  if(target.matches('[data-drop-link]')){$('#drop-error').textContent='';$('#drop-link').showModal();}
  if(target.matches('[data-discovery-data]'))dataDialog();
  if(target.matches('[data-retry-edition]'))load(true);
  if(target.matches('[data-retry-youtube]'))hooks.retryVideos();
  if(target.matches('[data-retry-embed]')){const p=current();if(p){$('#x-embed').replaceChildren();mountEmbed(p,token);}}
 });
 document.addEventListener('change',e=>{if(e.target.id==='pick-source')hooks.navigate({source:e.target.value});if(['feed-sort','feed-window'].includes(e.target.id)){const key=e.target.id==='feed-sort'?'sort':'window';feedSettings=readFeedSettings({...params(),[key]:e.target.value});try{localStorage.setItem(FEED_SETTINGS_KEY,JSON.stringify(feedSettings));}catch{}hooks.navigate({sort:feedSettings.sort,window:feedSettings.window});}});
 $('#drop-form').addEventListener('submit',e=>{e.preventDefault();try{state=addInbox(state,edition.items,$('#drop-url').value,$('#drop-title').value,$('#drop-note').value);persist();$('#drop-link').close();$('#drop-form').reset();hooks.navigate({view:'inbox',q:'',topic:'',source:'',dismissed:''});hooks.notify('Link added locally. Export and share it with your curator for curation.');}catch(err){$('#drop-error').textContent=err.message;}});
 $('#discovery-export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,profile,feedSettings,edition:edition.edition,exportedAt:new Date().toISOString(),youtube:hooks.getYTState()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='itube-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);hooks.notify('Feedback exported. Share the file with your curator; nothing was sent automatically.');});
 $('#discovery-import-open').addEventListener('click',()=>$('#discovery-import').click());
 $('#discovery-import').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2e6)throw Error('Maximum feedback file size is 2 MB.');const raw=JSON.parse(await file.text()),next=importDiscoveryState(raw),nextProfile=importedProfile(raw,profile);if(raw.youtube&&!['saved','liked','disliked','history'].every(k=>Array.isArray(raw.youtube[k])&&raw.youtube[k].every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{11}$/.test(id))))throw Error('Invalid YouTube feedback in this file.');if(!confirm('Replace discovery feedback, interests, and local links with this file? Included profile, feed settings and YouTube preferences will also replace their local values.'))return;state=next;persist();if(Object.hasOwn(raw,'profile')){profile=nextProfile;persistProfile();}if(raw.feedSettings){feedSettings=readFeedSettings(raw.feedSettings);try{localStorage.setItem(FEED_SETTINGS_KEY,JSON.stringify(feedSettings));}catch{}}if(raw.youtube)hooks.importYT(raw.youtube);refresh();hooks.notify('Feedback imported on this device. Nothing was sent.');}catch(err){hooks.notify(err.message||'Could not import this file.');}finally{e.target.value='';}});
 window.addEventListener('storage',e=>{if(e.key===DISCOVERY_KEY){state=readDiscoveryState(e.newValue);refresh();}if(e.key===PROFILE_KEY){profile=readProfile(e.newValue);refresh();}});
 let previousHash=location.hash;
 window.addEventListener('hashchange',()=>{const previous=previousHash;previousHash=location.hash;if(previous.startsWith('#/pick/')&&!location.hash.startsWith('#/pick/')&&!location.hash.startsWith('#/watch/')){const id=previous.slice('#/pick/'.length);requestAnimationFrame(()=>{window.scrollTo(0,returnScroll);if(validPickId(id))document.querySelector(`a[href="#/pick/${id}"]`)?.focus({preventScroll:true});});}});
 return {prepareSettings,feedLabel:()=>profileLabel(profile),isRoute:route,render,refresh,navItems:()=>[['for-you','✦',profileLabel(profile)],['saved-discoveries','▱',`Saved discoveries`],['inbox','↗','Link inbox']],savedCount:()=>state.saved.length+hooks.getYTState().saved.length,recommendedVideos:v=>rankByFreshness(rankedVideos({...params(),view:'for-you',dismissed:false},videoTopics(v)),params()),inboxCount:()=>state.inbox.length,relatedForVideo:v=>'<h2 class="related-heading">Up next · across sources</h2>'+nextMarkup(videoTopics(v),v.vid),ensureLoaded:()=>load(),invalidate:()=>{++token;}};
}
