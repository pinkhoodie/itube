import test from 'node:test';
import assert from 'node:assert/strict';
import {gate} from '../auth.mjs';
test('checked-in configuration placeholders never become working credentials',async()=>{
 const env={ITUBE_PASSWORD:'REPLACE_WITH_A_STRONG_PRIVATE_PASSWORD',ITUBE_SESSION_SECRET:'REPLACE_WITH_AN_INDEPENDENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'};
 for(const path of ['/','/login','/app.js','/data/videos.json'])assert.equal((await gate(new Request('http://localhost'+path),env)).status,503);
});
