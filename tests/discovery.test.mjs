import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_KEY,TOPICS,normalizeXURL,validPostId,safeURL,escapeHTML,sanitizeEdition,readDiscoveryState,importDiscoveryState,makeInboxItem,addInbox,allPicks,filterPicks,ageLabel,interleavePicks,videoTopics} from '../discovery-lib.mjs';
const url='https://x.com/dabit3/status/1875685131765039274';
const post=normalizeXURL(url);
// Fixtures are parser/ranking tests, never shipped editorial picks.
const a={...post,title:'Parser fixture',creator:'@dabit3',published:'2025-01-04',topics:['agents'],summary:'agent pattern',why:'why fixture',borrow:'borrow fixture',source:'X',media:'video'};
const b={...a,id:'x-2222222222222222222',postId:'2222222222222222222',url:'https://x.com/test/status/2222222222222222222',title:'Interface fixture',topics:['interfaces']};
const c={...a,id:'x-3333333333333333333',postId:'3333333333333333333',url:'https://x.com/test/status/3333333333333333333',title:'Agent fixture'};
const edition={edition:'2026-11-02',items:[a,b,c],sources:[],interests:TOPICS};
test('X URL normalization handles twitter, tracking, video/photo, and web status variants',()=>{
 for(const variant of [url+'?s=20',url+'/video/1',url+'/photo/2','https://mobile.twitter.com/dabit3/status/1875685131765039274/video/1'])assert.equal(normalizeXURL(variant).url,url);
 assert.equal(normalizeXURL('https://x.com/i/web/status/1875685131765039274').postId,post.postId);
});
test('X validation rejects lookalikes, credentials, unsupported schemes and paths, unsafe IDs',()=>{
 for(const bad of ['http://x.com/test/status/123','javascript:alert(1)','https://x.com.evil.test/test/status/123','https://evil.test/x.com/test/status/123','https://user@x.com/test/status/123','https://x.com:444/test/status/123','https://x.com/test/status/12e3','https://x.com/test/status/0','https://x.com/test/status/0123','https://x.com/test/status/123/evil','https://x.com/home','https://x.com/test/status/123%22'])assert.equal(normalizeXURL(bad),null,bad);
 assert.equal(validPostId(123),false);assert.equal(validPostId('123'),true);
});
test('safe external links and escaping never accept executable HTML',()=>{
 assert.equal(safeURL('javascript:alert(1)'),'');assert.equal(safeURL('data:text/html,test'),'');assert.equal(safeURL('https://user:pass@example.org/'),'');assert.equal(safeURL('https://example.org/repo'),'https://example.org/repo');
 assert.equal(escapeHTML('<img src=x onerror="evil()">'), '&lt;img src=x onerror=&quot;evil()&quot;&gt;');
});
test('edition validates ID/URL agreement, removes duplicates and unsafe resource links',()=>{
 const v=sanitizeEdition({...edition,items:[{...a,links:[{label:'Bad',url:'javascript:bad'},{label:'Repo',url:'https://example.org'}]},a,{...b,postId:'123'},{...c,url:'https://evil.org/test/status/3333333333333333333'}]});
 assert.equal(v.items.length,1);assert.equal(v.items[0].links.length,1);assert.deepEqual(v.items[0].topics,['agents']);assert.equal(v.items[0].source,'X');
 assert.equal(sanitizeEdition({interests:{find:'not callable'},items:[]}).interests.length,4);
});
test('separate local state tolerates malformed storage and enforces mutual exclusion',()=>{
 assert.notEqual(DISCOVERY_KEY,'hackertube.preferences.v1');assert.deepEqual(readDiscoveryState('{bad'),readDiscoveryState(null));assert.deepEqual(readDiscoveryState({version:12}),readDiscoveryState(null));
 const s=readDiscoveryState({...readDiscoveryState(null),saved:[a.id,a.id,'bad'],more:[a.id],dismissed:[a.id],interests:{agents:false}});
 assert.deepEqual(s.saved,[a.id]);assert.deepEqual(s.more,[]);assert.equal(s.interests.agents,false);assert.equal(s.interests.interfaces,true);
});
test('intake is manual and has no fabricated editorial summary; normalized duplicate intake rejected',()=>{
 const s=readDiscoveryState(null),next=addInbox(s,[],url+'/video/1','My title','My note','2026-11-02');
 assert.equal(next.inbox[0].manual,true);assert.equal(next.inbox[0].title,'My title');assert.equal(next.inbox[0].note,'My note');assert.equal('summary' in next.inbox[0],false);assert.equal('why' in next.inbox[0],false);
 assert.throws(()=>addInbox(next,[],url));assert.throws(()=>addInbox(s,[a],url));assert.equal(s.inbox.length,0);
});
test('merged library prefers curated item over same local link',()=>{
 const s={...readDiscoveryState(null),inbox:[makeInboxItem(url)]};assert.equal(allPicks(edition,s).length,3);assert.equal(allPicks(edition,s)[0].manual,undefined);
});
test('search, topic, saved, dismissed, inbox, and combined filters',()=>{
 const s={...readDiscoveryState(null),saved:[a.id,b.id],dismissed:[b.id]};
 assert.deepEqual(filterPicks(edition.items,{q:'agent pattern',topic:'agents',view:'saved-discoveries'},s),[a]);
 assert.deepEqual(filterPicks(edition.items,{dismissed:true},s),[b]);assert.deepEqual(filterPicks(edition.items,{q:'missing'},s),[]);
 const inbox=makeInboxItem('https://x.com/test/status/123','Uncurated fixture');assert.deepEqual(filterPicks([...edition.items,inbox],{view:'inbox'},s),[inbox]);
});
test('more-like-this boosts matching topics, stable order otherwise, does not mutate input',()=>{
 const items=[b,c,a],s={...readDiscoveryState(null),more:[a.id]};assert.equal(filterPicks(items,{},s)[0].id,c.id);assert.deepEqual(items,[b,c,a]);
 s.interests.agents=false;s.more=[];assert.equal(filterPicks([a,b],{},s)[0].id,b.id);
});
test('feedback export round-trips and rejects legacy or invalid imports',()=>{
 const s=addInbox(readDiscoveryState(null),[],url,'title','note');assert.deepEqual(importDiscoveryState(JSON.parse(JSON.stringify(s))),s);
 assert.throws(()=>importDiscoveryState({version:1,saved:[],liked:[],disliked:[],history:[]}));assert.throws(()=>importDiscoveryState({...s,saved:['bad']}));assert.throws(()=>importDiscoveryState({...s,inbox:[{id:a.id,url:'https://evil.org'}]}));
});
test('age is explicit: older finds labeled, recent date not misrepresented as a live feed',()=>{
 const now=Date.parse('2026-11-02T12:00:00Z');assert.match(ageLabel('2025-01-04',now),/^Older find · Jan 4, 2025$/);assert.equal(ageLabel('2026-11-01',now),'Nov 1, 2026');assert.equal(ageLabel('bad',now),'Publication date unverified');
});
test('mixed feed interleaves every three YouTube items, preserves input order and fills either source',()=>{
 const videos=Array.from({length:40},(_,i)=>({vid:String(i)})),picks=[a,b,c];const m=interleavePicks(videos,picks,12);
 assert.equal(m.length,12);assert.deepEqual(m.map(x=>x.kind),['x','youtube','youtube','youtube','x','youtube','youtube','youtube','x','youtube','youtube','youtube']);assert.equal(m[0].item,a);assert.equal(interleavePicks([],picks).length,3);assert.equal(interleavePicks(videos,[],36).length,36);
});
test('cross-source topic hypotheses use only public content, not private project names',()=>{
 assert.deepEqual(videoTopics({title:'Agent tools with local inference and interface design',tags:[],categories:[]}),['agents','interfaces','private-ai']);
 assert.deepEqual(videoTopics({title:'Cooking a potato'}),[]);
});
test('curated thumbnail metadata is restricted to the official X image CDN',()=>{
 const good=sanitizeEdition({items:[{...a,thumbnail:'https://pbs.twimg.com/media/example.jpg',duration_s:42}]}).items[0];
 assert.equal(good.thumbnail,'https://pbs.twimg.com/media/example.jpg');assert.equal(good.duration_s,42);
 const bad=sanitizeEdition({items:[{...a,thumbnail:'https://pbs.twimg.com.evil.test/image.jpg',duration_s:'42'}]}).items[0];
 assert.equal(bad.thumbnail,'');assert.equal(bad.duration_s,null);
});
