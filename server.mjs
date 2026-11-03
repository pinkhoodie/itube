import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate } from './auth.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
export function makeServer({auth = true, env = process.env} = {}) {
  return createServer(async (req, res) => {
    try {
      if (auth) {
        let body;
        if (!['GET','HEAD'].includes(req.method)) {
          const chunks=[];let size=0;
          for await (const chunk of req) {size+=chunk.length;if(size>8192){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
          body=Buffer.concat(chunks);
        }
        const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {method:req.method,headers:req.headers,...(body ? {body} : {})});
        const denied = await gate(request,env);
        if (denied) {res.writeHead(denied.status,Object.fromEntries(denied.headers));res.end(req.method === 'HEAD' ? undefined : Buffer.from(await denied.arrayBuffer()));return;}
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); return res.end(); }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // Serve only public data and the four app assets, never source/tests/config.
      const allowed = ['/', '/index.html', '/app.js', '/lib.mjs', '/style.css', '/discovery.js', '/discovery-lib.mjs', '/profile-lib.mjs'];
      if (!allowed.includes(pathname) && !/^\/data\/(?:[A-Za-z0-9_.-]+|comments\/[\w-]{11}\.json)$/.test(pathname)) { res.writeHead(404); return res.end('Not found'); }
      const base = pathname.startsWith('/data/') ? resolve(root, env.ITUBE_DATA_DIR || 'public/data') : root;
      const relative = pathname.startsWith('/data/') ? pathname.slice('/data'.length) : pathname;
      const file = resolve(base, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); return res.end(); }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':body.length, 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin', 'Cache-Control':auth ? 'private, no-store, max-age=0' : pathname.startsWith('/data/') ? 'public, max-age=3600' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) { res.writeHead(err instanceof URIError ? 400 : 404); res.end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(resolve(root,'.env.local')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const port = Number(process.env.PORT || 4187);
  const host = process.env.HOST || '127.0.0.1';
  makeServer().listen(port, host, () => console.log(`iTube running at http://${host}:${port}`));
}
