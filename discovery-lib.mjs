// Pure discovery helpers. This storage schema deliberately does not touch HN preferences.
export const DISCOVERY_KEY = 'hackertube.discovery.v1';
export const TOPICS = [
 {id:'agents',label:'Agents',reason:'Working agent systems, useful tools, and concrete implementation patterns.'},
 {id:'interfaces',label:'Interfaces',reason:'Interaction ideas and thoughtful product details worth adapting.'},
 {id:'private-ai',label:'Private AI',reason:'Local inference, privacy boundaries, and practical private AI architecture.'},
 {id:'creative-tools',label:'Creative tools',reason:'Tools that make building, designing, and experimenting more expressive.'}
];
const text = (v, max=10000) => typeof v==='string' ? v.slice(0,max) : '';
export const validPostId = id => typeof id==='string' && /^[1-9]\d{0,24}$/.test(id);
export const validPickId = id => typeof id==='string' && id.startsWith('x-') && validPostId(id.slice(2));
export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value) {
 try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port ? u.href : '';}catch{return '';}
}
export function normalizeXURL(value) {
 if(typeof value!=='string')return null;
 try {
  const u=new URL(value.trim());
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['x.com','www.x.com','mobile.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(u.hostname))return null;
  const m=u.pathname.match(/^\/(?:([a-zA-Z0-9_]{1,15})\/status|i\/web\/status)\/([1-9]\d{0,24})(?:\/(?:video|photo)\/\d+)?\/?$/);
  if(!m)return null;
  const postId=m[2];return {id:`x-${postId}`,postId,url:`https://x.com/${m[1]||'i/web'}/status/${postId}`};
 }catch{return null;}
}
const iso = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
export function sanitizeEdition(raw) {
 const seen=new Set();
 const items=(Array.isArray(raw?.items)?raw.items:[]).flatMap(v=>{
  const post=normalizeXURL(v?.url);
  if(!post||v.id!==post.id||v.postId!==post.postId||seen.has(post.id))return [];
  seen.add(post.id);
  return [{...post,title:text(v.title,500)||'Untitled pick',creator:text(v.creator,100),published:iso(v.published),topics:[...new Set((Array.isArray(v.topics)?v.topics:[]).filter(t=>TOPICS.some(x=>x.id===t)))],summary:text(v.summary),why:text(v.why),borrow:text(v.borrow),links:(Array.isArray(v.links)?v.links:[]).flatMap(l=>safeURL(l?.url)?[{label:text(l.label,200)||'Related link',url:safeURL(l.url)}]:[]),verifiedAt:iso(v.verifiedAt),thumbnail:(()=>{const image=safeURL(v.thumbnail);try{return new URL(image).hostname==='pbs.twimg.com'?image:'';}catch{return '';}})(),duration_s:typeof v.duration_s==='number'&&Number.isFinite(v.duration_s)&&v.duration_s>0?v.duration_s:null,media:v.media==='video'?'video':'post',source:'X'}];
 });
 const sources=(Array.isArray(raw?.sources)?raw.sources:[]).flatMap(s=>{
  const url=safeURL(s?.url);let u;try{u=new URL(url);}catch{return [];}
  return ['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname)&&/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(u.pathname)?[{handle:text(s.handle,100),url,reason:text(s.reason)}]:[];
 });
 const interests=TOPICS.map(t=>{const i=(Array.isArray(raw?.interests)?raw.interests:[]).find(x=>x?.id===t.id);return {...t,reason:text(i?.reason)||t.reason,label:text(i?.label,100)||t.label};});
 return {edition:iso(raw?.edition),items,sources,interests};
}
export function makeInboxItem(url, title='', note='', now=new Date().toISOString()) {
 const p=normalizeXURL(url);if(!p)throw Error('Use a public HTTPS X or Twitter status link. Video links are welcome too.');
 return {...p,title:text(title,500).trim()||'Shared X post',note:text(note,4000).trim(),addedAt:iso(now),manual:true,topics:[],source:'X',media:'post'};
}
export function readDiscoveryState(raw) {
 try {if(typeof raw==='string')raw=JSON.parse(raw);}catch{raw=null;}
 if(!raw||raw.version!==1||raw.kind!=='hackertube-discovery-feedback')raw={};
 const ids=k=>[...new Set((Array.isArray(raw[k])?raw[k]:[]).filter(validPickId))].slice(0,10000);
 const dismissed=ids('dismissed'),more=ids('more').filter(id=>!dismissed.includes(id));
 const interests=Object.fromEntries(TOPICS.map(t=>[t.id,typeof raw.interests?.[t.id]==='boolean'?raw.interests[t.id]:true]));
 const seen=new Set();
 const inbox=(Array.isArray(raw.inbox)?raw.inbox:[]).slice(0,1000).flatMap(v=>{try{const p=makeInboxItem(v.url,v.title,v.note,v.addedAt);if(seen.has(p.id)||v.id!==p.id)return [];seen.add(p.id);return [p];}catch{return [];}});
 return {version:1,kind:'hackertube-discovery-feedback',saved:ids('saved'),more,dismissed,interests,inbox};
}
export function importDiscoveryState(raw) {
 if(!raw||raw.version!==1||raw.kind!=='hackertube-discovery-feedback'||!['saved','more','dismissed','inbox'].every(k=>Array.isArray(raw[k])))throw Error('This is not a discovery feedback export. HN preferences use a separate file.');
 if(['saved','more','dismissed'].some(k=>raw[k].some(id=>!validPickId(id))))throw Error('The feedback contains invalid pick IDs.');
 if(raw.inbox.some(v=>!normalizeXURL(v?.url)||normalizeXURL(v.url).id!==v.id))throw Error('The feedback contains invalid X links.');
 return readDiscoveryState(raw);
}
export function addInbox(state, curated, url, title, note, now) {
 const item=makeInboxItem(url,title,note,now);
 if(curated.some(p=>p.id===item.id)||state.inbox.some(p=>p.id===item.id))throw Error('This post is already in your edition or link inbox.');
 if(state.inbox.length>=1000)throw Error('Your link inbox is full. Export or remove some links first.');
 return {...state,inbox:[item,...state.inbox]};
}
export function allPicks(edition,state) {
 const curated=new Set(edition.items.map(p=>p.id));
 return [...edition.items,...state.inbox.filter(p=>!curated.has(p.id))];
}
export function filterPicks(items,{q='',topic='',view='for-you',dismissed=false}={},state=readDiscoveryState(null)) {
 const terms=q.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const affinity=new Map();
 for(const p of items)if(state.more.includes(p.id))for(const t of p.topics)affinity.set(t,(affinity.get(t)||0)+3);
 return items.map((p,i)=>({p,i,score:p.topics.reduce((n,t)=>n+(state.interests[t]===false?-2:1)+(affinity.get(t)||0),0)}))
 .filter(({p})=>(dismissed?state.dismissed.includes(p.id):!state.dismissed.includes(p.id))&&(view!=='saved-discoveries'||state.saved.includes(p.id))&&(view!=='inbox'||p.manual)&&(!topic||p.topics.includes(topic))&&terms.every(term=>[p.title,p.creator,p.summary,p.why,p.borrow,p.note,...p.topics].join(' ').toLowerCase().includes(term)))
 .sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.p);
}
export const FEED_SETTINGS_KEY = 'itube.feed-settings.v1';
export function readFeedSettings(raw) {
 try { if(typeof raw==='string')raw=JSON.parse(raw); } catch { raw=null; }
 return {sort:['recent','for-you','newest'].includes(raw?.sort)?raw.sort:'recent',window:['all','30','90','365'].includes(String(raw?.window))?String(raw.window):'all'};
}
export function publicationTimestamp(published, now=Date.now()) {
 if(published==null||published==='')return null;
 const stamp=typeof published==='number'?published*(published<1e12?1000:1):typeof published==='string'?Date.parse(published):NaN;
 return Number.isFinite(stamp)&&stamp<=Number(now)?stamp:null;
}
// Input order encodes affinity. Freshness is a bounded boost, not a replacement for taste.
export function rankByFreshness(items,{sort='recent',window='all',now=Date.now(),getItem=x=>x}={}) {
 const settings=readFeedSettings({sort,window}), clock=Number(now), day=86400000;
 return items.map((entry,i)=>{const stamp=publicationTimestamp(getItem(entry).published,clock);return {entry,i,stamp,score:1/(1+i/8)+(stamp==null?0:1.5*Math.exp(-(clock-stamp)/(90*day)))};})
 .filter(x=>settings.window==='all'||x.stamp!=null&&clock-x.stamp<=Number(settings.window)*day)
 .sort((a,b)=>(a.stamp==null)-(b.stamp==null)||(settings.sort==='for-you'?a.i-b.i:settings.sort==='newest'?(b.stamp??0)-(a.stamp??0):b.score-a.score)||a.i-b.i).map(x=>x.entry);
}
export function mergeYouTube(archive,supplement) {
 const rows=new Map();
 for(const v of [...(Array.isArray(archive)?archive:[]),...(Array.isArray(supplement)?supplement:[])])if(v&&typeof v.vid==='string'&&/^[a-zA-Z0-9_-]{11}$/.test(v.vid))rows.set(v.vid,v);
 return [...rows.values()];
}
export function ageLabel(published, now=Date.now()) {
 if(!iso(published))return 'Publication date unverified';
 const date=new Date(published),days=Math.floor((now-date.getTime())/86400000);
 const label=date.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
 return `${days>30?'Older find · ':''}${label}`;
}
// Topic matching is an editable ranking hypothesis, never a claim about source metadata.
export function videoTopics(v) {
 const words=[v.title,v.primary_topic,...(v.tags||[]),...(v.categories||[]).map(c=>c.name)].join(' ').toLowerCase();
 const patterns={agents:/\b(?:ai|llm|coding|computer.use|autonomous|language.model) agents?\b|\bagent tools?\b|\btool use\b|\bmcp\b|function call|agentic/,interfaces:/user interface|human.computer|human.machine|interaction design|interface design|\bux\b|\bui\b|frontend|spatial|\bgui\b|\bhci\b|bret victor|inventing on principle|future of programming/, 'private-ai':/private (?:ai|llm)|local (?:ai|llm|inference)|ollama|on.device|confidential (?:ai|computing)|llama\.cpp|large language models?|\bllms?\b/, 'creative-tools':/creative coding|generative art|animation|drawing|shader|computer graphics|design system|design tool/};
 return TOPICS.filter(t=>patterns[t.id].test(words)).map(t=>t.id);
}
export function interleavePicks(videos,picks,limit=36) {
 const out=[];let y=0,x=0;
 while(out.length<limit&&(y<videos.length||x<picks.length)) {
  if(x<picks.length&&out.length<limit)out.push({kind:'x',item:picks[x++]});
  for(let n=0;n<3&&y<videos.length&&out.length<limit;n++)out.push({kind:'youtube',item:videos[y++]});
 }
 return out;
}
