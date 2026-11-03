import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {makeServer} from '../server.mjs';
const load=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('public release contains only the deliberate minimal demo, not a personal corpus',async()=>{
 const archive=await load('public/data/videos.json'),fresh=await load('public/data/fresh-youtube.json'),edition=await load('public/data/discoveries.json');
 assert.equal(archive.length,0);assert.equal(fresh.length,1);assert.equal(edition.items.length,1);
 assert.equal(fresh[0].vid,'JxNCuXkSWyQ');assert.equal(edition.items[0].postId,'2116383901115711897');
 for(const item of [...fresh,...edition.items]){
  assert.equal(item.description,undefined);assert.equal(item.views,undefined);assert.equal(item.likes,undefined);
 }
 const entries=await readdir(new URL('../public/data',import.meta.url));
 assert.ok(!entries.includes('mentions.json')&&!entries.includes('comments'));
});
test('local server protects demo and profile module, and never serves env/source',async t=>{
 const server=makeServer({env:{ITUBE_PASSWORD:'public-release-test-only',ITUBE_SESSION_SECRET:'generated-test-fixture-not-a-live-secret-12345678'}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/profile-lib.mjs')).status,401);
 const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'password=public-release-test-only',redirect:'manual'});
 assert.equal(login.status,303);const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
 assert.equal((await fetch(base+'/profile-lib.mjs',{headers})).status,200);
 for(const path of ['/.env.local','/.env.example','/auth.mjs','/tests/auth.test.mjs'])assert.equal((await fetch(base+path,{headers})).status,404);
 assert.equal((await (await fetch(base+'/data/fresh-youtube.json',{headers})).json()).length,1);
});
