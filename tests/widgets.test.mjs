import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('widget script timeout removes failed script so retry issues a fresh request',async()=>{
 const source=await readFile(new URL('../discovery.js',import.meta.url),'utf8');
 const loader=source.slice(source.indexOf('let widgetsPromise;'),source.indexOf('export function initDiscovery'));
 let active=null,appended=0;const timers=[];
 const sandbox={window:{},Error,Promise,document:{getElementById:()=>active,createElement:()=>({remove(){if(active===this)active=null;},addEventListener(){}}),head:{append(script){active=script;appended++;}}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
 vm.createContext(sandbox);vm.runInContext(loader+';globalThis.loadTest=loadWidgets;',sandbox);
 const first=sandbox.loadTest();assert.equal(appended,1);timers[0]();
 await assert.rejects(first,/did not respond/);assert.equal(active,null);
 const retry=sandbox.loadTest();assert.equal(appended,2);
 sandbox.window.twttr={widgets:{createTweet(){}}};active.onload();
 assert.equal(await retry,sandbox.window.twttr);
});
