import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = `${root}dist`;
try { process.loadEnvFile(resolve(root,'.env.local')); } catch (error) { if(error.code!=='ENOENT')throw error; }
const dataRoot=resolve(root,process.env.ITUBE_DATA_DIR || 'public/data');
await rm(dist, { recursive:true, force:true });
await mkdir(dist, { recursive:true });
for (const file of ['index.html','app.js','lib.mjs','style.css','discovery.js','discovery-lib.mjs','profile-lib.mjs']) await copyFile(`${root}${file}`,`${dist}/${file}`);
await cp(dataRoot,`${dist}/data`,{recursive:true});
console.log('Static iTube built in dist/ (app and public dataset only).');
