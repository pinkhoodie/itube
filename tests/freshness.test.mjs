import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../discovery-lib.mjs';
import * as profile from '../profile-lib.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {filterVideos,formatDuration} from '../lib.mjs';
const now=Date.parse('2026-11-02T12:00:00Z'), day=86400000;
const item=(id,age)=>({id,published:new Date(now-age*day).toISOString()});

async function appHarness({freshFail=false,archiveFail=false,watch=true}={}) {
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8');const {readState}=await import('../lib.mjs');
 const nodes=new Map(),requests=[];let hooks;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'',setAttribute(){},addEventListener(){},focus(){},classList:{add(){},remove(){}}});return nodes.get(s);};
 const fresh={vid:'abcdefghijk',title:'Fresh real title fixture',published:'2026-10-30T12:00:00Z',channel:'Channel',categories:[],tags:[],curation_why:'A useful pattern',borrow:'Borrow a boundary',provenance:'editorial'};
 const archive={vid:'archive0000',title:'Archive fixture',published:'2012-01-01',categories:[],tags:[]};
 const context={filterVideos,formatDuration,readState,mergeYouTube:lib.mergeYouTube,publicationTimestamp:lib.publicationTimestamp,URL,URLSearchParams,Date,Map,Set,Promise,Intl,location:{search:'',hash:watch?'#/watch/abcdefghijk':'',pathname:'/'},localStorage:{getItem:()=>JSON.stringify({version:1,saved:['abcdefghijk']}),setItem(){}},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){},scrollTo(){}},setTimeout,clearTimeout,fetch:async url=>{requests.push(url);const isFresh=url.includes('fresh-youtube');return {ok:!(isFresh?freshFail:archiveFail),status:404,json:async()=>[isFresh?fresh:archive]};},initDiscovery:h=>{hooks=h;return {feedLabel:()=>'For you',navItems:()=>[],savedCount:()=>0,inboxCount:()=>0,isRoute:()=>!watch,render(){},invalidate(){},ensureLoaded(){},relatedForVideo:()=>'',recommendedVideos:()=>[]};}};
 vm.createContext(context);vm.runInContext(source.replace(/^import .*;\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 return {hooks,node,requests};
}
test('fresh watch detail uses editorial notes, original source, full date, and no HN request',async()=>{
 const h=await appHarness();const html=h.node('#main').innerHTML;
 assert.match(html,/A useful pattern/);assert.match(html,/Borrow a boundary/);assert.match(html,/Original YouTube source/);assert.match(html,/<time datetime="2026-10-30T12:00:00Z">30 Oct 2026<\/time>/);
 assert.doesNotMatch(html,/Hacker News evidence|Loading the original discussions/);assert.ok(h.requests.every(url=>!url.includes('/comments/')));
 assert.ok(h.hooks.getYTState().saved.includes('abcdefghijk'));
 assert.match(h.hooks.videoCard(h.hooks.getVideos().find(v=>v.vid==='abcdefghijk')),/<time datetime=/);
});
test('independent source failures preserve the other source and fresh preference IDs',async()=>{
 const archiveOnly=await appHarness({freshFail:true,watch:false});assert.deepEqual(Array.from(archiveOnly.hooks.getVideos(),v=>v.vid),['archive0000']);assert.ok(archiveOnly.hooks.getYTState().saved.includes('abcdefghijk'));
 const freshOnly=await appHarness({archiveFail:true});assert.deepEqual(Array.from(freshOnly.hooks.getVideos(),v=>v.vid),['abcdefghijk']);assert.match(freshOnly.node('#main').innerHTML,/Editorial curation/);
});


test('freshness boosts recent supply, retains exceptional archive and sorts invalid dates last',()=>{
 const rows=[item('exceptional',5000),...Array.from({length:30},(_,i)=>item('old'+i,5000)),item('fresh',1),item('quarter',89),item('future',-1),{id:'null',published:null}];
 const result=lib.rankByFreshness(rows,{now});assert.equal(result[0].id,'fresh');
 assert.ok(result.findIndex(x=>x.id==='exceptional')<result.findIndex(x=>x.id==='quarter'));
 assert.equal(rows[0].id,'exceptional');assert.deepEqual(result.slice(-2).map(x=>x.id),['future','null']);
 assert.deepEqual(lib.rankByFreshness(rows,{now,sort:'for-you'}),rows);
 assert.deepEqual(lib.rankByFreshness([{id:'unknown'},item('known',20),item('future',-1)],{now,sort:'for-you'}).map(x=>x.id),['known','unknown','future']);
 assert.deepEqual(lib.rankByFreshness([item('a',2),item('b',2)],{now,sort:'newest'}).map(x=>x.id),['a','b']);
});
test('newest is global across sources, supports numeric timestamps and exact date boundaries',()=>{
 const entries=[{kind:'x',item:item('x',4)},{kind:'youtube',item:item('yt',1)},{kind:'x',item:{id:'numeric',published:now/1000}},{kind:'youtube',item:{id:'millis',published:now}},{kind:'x',item:{id:'bad',published:'bad'}}];
 assert.deepEqual(lib.rankByFreshness(entries,{sort:'newest',getItem:x=>x.item,now}).map(x=>x.item.id),['numeric','millis','yt','x','bad']);
 for(const window of ['90','365'])assert.deepEqual(lib.rankByFreshness([item('edge',Number(window)),item('too-old',Number(window)+.00001)],{window,now}).map(x=>x.id),['edge']);
});
test('settings tolerate old malformed state; supplement dedupes without changing archive',()=>{
 assert.deepEqual(lib.readFeedSettings('{bad'),{sort:'recent',window:'all'});
 assert.deepEqual(lib.readFeedSettings({sort:'newest',window:90}),{sort:'newest',window:'90'});
 const archive=[{vid:'abcdefghijk',title:'archive'}],supplement=[{vid:'abcdefghijk',title:'curated'},null,{vid:'bad'}];
 assert.deepEqual(lib.mergeYouTube(archive,null),archive);assert.equal(lib.mergeYouTube(archive,supplement)[0].title,'curated');assert.equal(archive[0].title,'archive');
});
export async function feedHarness({search='',settings=null,profileValue=null,blockedStorage=false,editionItems=[]}={}){
 const source=await readFile(new URL('../discovery.js',import.meta.url),'utf8');
 const nodes=new Map(),handlers={},storage=new Map(settings?[[lib.FEED_SETTINGS_KEY,JSON.stringify(settings)]]:[]);
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'',listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},focus(){},dataset:{}});return nodes.get(s);};
 if(profileValue)storage.set(profile.PROFILE_KEY,JSON.stringify(profileValue));
 const location={search,hash:'',pathname:'/'},state={saved:['abcdefghijk'],liked:[],disliked:['dislike0000'],history:[]};
 const published=new Date(Date.now()-2*day).toISOString();
 const videos=[{vid:'abcdefghijk',title:'Agent tools',published,tags:['AI agents'],categories:[],score:0,provenance:'editorial'},{vid:'older000000',title:'Agent archive',published:'2010-01-01',tags:['AI agents'],categories:[],score:100},{vid:'dislike0000',title:'Agent disliked',published,tags:['AI agents'],categories:[],score:100}];
 const sandbox={confirm:()=>true,...lib,...profile,esc:lib.escapeHTML,filterVideos,formatDuration,URL,URLSearchParams,Date,Map,Set,Promise,location,history:{replaceState(_a,_b,url){const u=new URL(url,'https://example.com');location.search=u.search;location.hash=u.hash;}},localStorage:{getItem:k=>{if(blockedStorage)throw Error('blocked');return storage.get(k);},setItem:(k,v)=>{if(blockedStorage)throw Error('blocked');storage.set(k,v);}},document:{querySelector:node,activeElement:null,addEventListener:(type,fn)=>handlers[type]=fn},window:{addEventListener(){},twttr:{widgets:{createTweet:async()=>true}}},setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({items:editionItems})})};
 vm.createContext(sandbox);vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export function initDiscovery','function initDiscovery')+';globalThis.init=initDiscovery;',sandbox);
 const api=sandbox.init({getVideos:()=>videos,getYTState:()=>state,getVideoStatus:()=> 'ready',videoCard:v=>`<article data-video="${v.vid}">${v.title}</article>`,updateNav(){},notify(){},cancelSearch(){},navigate:patch=>{const q=new URLSearchParams(location.search);for(const [k,v]of Object.entries(patch))v?q.set(k,v):q.delete(k);location.search='?'+q;api.render();}});
 await api.ensureLoaded();api.render();return {api,node,location,storage,handlers,videos,state};
}
test('mixed controls use URL over stored defaults and combine saved/source/topic/search/date',async()=>{
 const h=await feedHarness({search:'?view=nir-saved&sort=newest&window=30&source=youtube&topic=agents&q=tools',settings:{sort:'for-you',window:'365'}});
 const html=h.node('#main').innerHTML;assert.match(html,/id="feed-sort" aria-label="Sort discoveries"/);assert.match(html,/value="newest" selected/);assert.match(html,/value="30" selected/);
 assert.match(html,/data-video="abcdefghijk"/);assert.doesNotMatch(html,/data-video="older000000"|data-video="dislike0000"/);
 h.handlers.change({target:{id:'feed-sort',value:'for-you',matches:()=>false}});
 assert.equal(JSON.parse(h.storage.get(lib.FEED_SETTINGS_KEY)).sort,'for-you');assert.match(h.location.search,/sort=for-you/);
});

test('back to the initial feed restores its settings rather than newly saved defaults',async()=>{
 const h=await feedHarness({settings:{sort:'for-you',window:'90'}});const initial=h.location.search;
 h.handlers.change({target:{id:'feed-sort',value:'newest',matches:()=>false}});
 h.location.search=initial;h.api.render();assert.match(h.node('#main').innerHTML,/value="for-you" selected/);assert.match(h.node('#main').innerHTML,/value="90" selected/);
});

test('up-next obeys active URL date and excludes selected or disliked videos',async()=>{
 const h=await feedHarness({search:'?sort=newest&window=30'});const html=h.api.relatedForVideo(h.videos[0]);
 h.videos[1].published=h.videos[0].published;h.state.history=['older000000'];
 assert.doesNotMatch(h.api.relatedForVideo(h.videos[0]),/data-video="older000000"/);
 assert.doesNotMatch(html,/data-video="abcdefghijk"|data-video="older000000"|data-video="dislike0000"/);
});

test('freshness uses publication only; bounded windows include exact boundary, exclude unknown and future',()=>{
 const rows=[item('today',0),item('edge',30),item('old',30.00001),item('future',-1),{id:'unknown',verifiedAt:new Date(now).toISOString(),addedAt:new Date(now).toISOString()}];
 assert.equal(typeof lib.rankByFreshness,'function');
 assert.deepEqual(lib.rankByFreshness(rows,{window:'30',now}).map(x=>x.id),['today','edge']);
});
