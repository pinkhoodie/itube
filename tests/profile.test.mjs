import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_KEY,validateProfile,readProfile,profileLabel,customTopicBoost,importedProfile,canonicalView} from '../profile-lib.mjs';
import {DISCOVERY_KEY,readDiscoveryState,rankByFreshness} from '../discovery-lib.mjs';
import {feedHarness} from './freshness.test.mjs';

test('profile normalizes identity and stable case-insensitive topics and roundtrips',()=>{
 const result=validateProfile({name:'  Ada   Lovelace  ',handle:' @Ada_1 ',topics:'Robotics, robotics\nMusic tools,  urban   design'});
 assert.equal(result.ok,true);assert.deepEqual(result.profile,{version:1,name:'Ada Lovelace',handle:'ada_1',topics:['Robotics','Music tools','urban design']});
 assert.deepEqual(readProfile(JSON.stringify(result.profile)),result.profile);assert.equal(profileLabel(result.profile),'For Ada Lovelace');assert.equal(profileLabel(readProfile(null)),'For you');
 assert.equal(validateProfile({name:'a'.repeat(60),handle:'a'.repeat(15)}).ok,true);
});
test('malformed profile and invalid boundary inputs fail safely',()=>{
 for(const raw of ['{bad','null','[]','42',JSON.stringify({name:'a'.repeat(61)})])assert.deepEqual(readProfile(raw),readProfile(null));
 for(const input of [{name:'a'.repeat(61)},{name:'line\nbreak'},{name:'hidden\u202e'},{handle:'https://x.com/a'},{handle:'two words'},{handle:'a'.repeat(16)},{handle:'@@a'},{handle:'@'},{topics:['x'.repeat(61)]},{topics:Array.from({length:13},(_,i)=>'t'+i)},{topics:[42]},{topics:{}}])assert.equal(validateProfile(input).ok,false,JSON.stringify(input));
});
test('topic boost uses bounded title, summary, tags matching, never identity',()=>{
 const p=readProfile({name:'Robotics',handle:'robotics',topics:['robotics','music tools','urban design','drawing']});
 assert.equal(customTopicBoost({title:'Robotics and music tools',summary:'Urban design drawing'},p),3);
 assert.equal(customTopicBoost({title:'Robotics',tags:['urban design']},p),2);
 assert.equal(customTopicBoost({title:'microrobotics'},p),0);
 assert.equal(customTopicBoost({creator:'Robotics',why:'Robotics'},p),0);
 assert.equal(customTopicBoost({title:'Robotics'},{name:'Robotics',handle:'robotics'}),0);
 const entries=[{title:'Robotics',published:'2020-01-01'},{title:'Other',published:'2026-01-01'}].sort((a,b)=>customTopicBoost(b,p)-customTopicBoost(a,p));
 assert.equal(rankByFreshness(entries,{sort:'newest',now:Date.parse('2026-02-01')})[0].title,'Other');
});
test('legacy imports preserve profile; optional profile validates before replacing',()=>{
 const current=readProfile({name:'Ada',topics:['Robotics']});const legacy=readDiscoveryState(null);
 assert.deepEqual(importedProfile(legacy,current),current);
 assert.deepEqual(importedProfile({...legacy,profile:current},null),current);
 assert.throws(()=>importedProfile({...legacy,profile:{handle:'https://x.com/a'}},current),/Invalid profile/);
 for(const [old,next]of [['nir','for-you'],['nir-saved','saved-discoveries'],['nir-inbox','inbox'],['history','history']])assert.equal(canonicalView(old),next);
});
test('settings save is explicit, escapes labels, close discards edits, reset preserves saved and feedback',async()=>{
 const h=await feedHarness({profileValue:{name:'Ada',topics:['Agent tools']}});
 h.api.prepareSettings();assert.equal(h.node('#profile-name').value,'Ada');
 h.node('#profile-name').value='Unsaved';h.node('#preferences').listeners.close();assert.equal(h.node('#profile-name').value,'Ada');
 h.node('#profile-name').value='<img src=x>';h.node('#profile-handle').value='@ada';h.node('#profile-topics').value='Agent tools';
 h.node('#profile-form').listeners.submit({preventDefault(){}});
 assert.equal(JSON.parse(h.storage.get(PROFILE_KEY)).name,'<img src=x>');assert.match(h.node('#main').innerHTML,/For &lt;img src=x&gt;/);
 const before=h.storage.get(DISCOVERY_KEY),saved=[...h.state.saved];h.node('#profile-reset').listeners.click();
 assert.deepEqual(JSON.parse(h.storage.get(PROFILE_KEY)),readProfile(null));assert.equal(h.storage.get(DISCOVERY_KEY),before);assert.deepEqual(h.state.saved,saved);
 assert.match(h.node('#main').innerHTML,/For you/);
});
test('no-storage settings remain functional and legacy route filters survive',async()=>{
 const h=await feedHarness({search:'?view=nir-saved&sort=newest&window=30&q=tools',blockedStorage:true});
 assert.match(h.location.search,/view=saved-discoveries/);assert.match(h.location.search,/q=tools/);
 h.api.prepareSettings();h.node('#profile-name').value='Local';h.node('#profile-form').listeners.submit({preventDefault(){}});
 assert.equal(h.api.navItems()[0][2],'For Local');assert.equal(h.storage.has(PROFILE_KEY),false);
});
test('X custom-topic order and mounted embed survive profile saves',async()=>{
 const x=(id,title,published)=>({id:'x-'+id,postId:id,url:'https://x.com/builder/status/'+id,title,published,topics:[],media:'video'});
 const h=await feedHarness({search:'?sort=for-you',profileValue:{topics:['Robotics']},editionItems:[x('100','Other','2026-01-02'),x('101','Robotics','2026-01-01')]});
 let html=h.node('#main').innerHTML;assert.ok(html.indexOf('data-pick-card="x-101"')<html.indexOf('data-pick-card="x-100"'));
 h.location.search='?sort=newest';h.api.render();html=h.node('#main').innerHTML;
 assert.ok(html.indexOf('data-pick-card="x-100"')<html.indexOf('data-pick-card="x-101"'));
 h.location.hash='#/pick/x-101';h.node('#x-embed').dataset.postId='101';h.node('#main').innerHTML='mounted player sentinel';
 h.api.prepareSettings();h.node('#profile-name').value='Ada';h.node('#profile-form').listeners.submit({preventDefault(){}});
 assert.equal(h.node('#main').innerHTML,'mounted player sentinel');assert.match(h.node('.pick-detail .related').innerHTML,/Up next/);
});

test('custom topic affects actual feed and watch-next while Newest stays global',async()=>{
 const h=await feedHarness({search:'?sort=for-you',profileValue:{topics:['Agent archive']}});
 const html=h.node('#main').innerHTML;assert.ok(html.indexOf('data-video="older000000"')<html.indexOf('data-video="abcdefghijk"'));
 h.videos[0].title='Other';h.state.history=[];assert.match(h.api.relatedForVideo(h.videos[0]),/older000000/);
 h.location.search='?sort=newest';h.api.render();const chronological=h.node('#main').innerHTML;
 assert.ok(chronological.indexOf('data-video="abcdefghijk"')<chronological.indexOf('data-video="older000000"'));
 assert.doesNotMatch(chronological,/data-video="dislike0000"/);
});
