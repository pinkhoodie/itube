import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'itube_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY = 4096;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_BUCKETS = 1024;
// Best effort only: runtime-local, bounded, reset on cold start, not a global limiter.
const attempts = new Map();

function headers(extra = {}) {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...extra,
  };
}
function response(body, status, extra) {
  return new Response(body, { status, headers: headers(extra) });
}
function redirect(location, extra = {}) {
  return response(null, 303, { Location: location, ...extra });
}
function escape(value) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function returnPath(value) {
  if (typeof value !== 'string' || value.length > 2048) return '/';
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return '/';
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { return '/'; }
  }
  try {
    const parsed = new URL(value, 'https://itube.invalid');
    if (parsed.origin !== 'https://itube.invalid' || parsed.pathname.startsWith('//') || ['/login', '/logout'].includes(parsed.pathname)) return '/';
    return parsed.pathname + parsed.search;
  } catch { return '/'; }
}
function loginPage(returnTo, message = '', status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · iTube</title><style>
  :root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#302a24;background:#f5f1e9}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:28px}main{width:100%;max-width:420px;background:#fffdf8;border:1px solid #e3dbce;border-radius:24px;padding:40px;box-shadow:0 18px 70px #4e35250b}.brand{font-weight:750;font-size:25px;letter-spacing:-1px}.mark{color:#b94e32;margin-right:8px}h1{font-size:30px;letter-spacing:-1px;margin:34px 0 12px}p{color:#776b5e;line-height:1.6;font-size:14px}label{display:block;font-size:13px;font-weight:650;margin:28px 0 9px}input,button{font:inherit;width:100%;border-radius:10px;padding:13px 14px}input{background:#fff;border:1px solid #cfc5b6;color:#302a24}input:focus-visible{outline:3px solid #ddac87;outline-offset:2px}button{margin-top:16px;background:#a9472d;border:0;color:white;font-weight:650;cursor:pointer}button:hover{background:#913a24}.note{font-size:12px;margin-bottom:0}.error{color:#963c28;background:#fbede5;border-radius:8px;padding:10px 12px}footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee6da;font-size:12px;color:#8a7c6e}
  </style></head><body><main><div class="brand"><span class="mark" aria-hidden="true">▶</span>iTube</div><h1>A little inspiration,<br>just for you.</h1><p>Your private collection of things worth watching, exploring, and building on.</p>${message ? `<p class="error" role="alert">${escape(message)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="returnTo" value="${escape(returnTo)}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024" autofocus><button type="submit">Enter iTube →</button><p class="note">You’ll stay signed in on this device for 30 days.</p></form><footer>A private space. A fresh perspective.</footer></main></body></html>`;
  return response(html, status, { 'Content-Type': 'text/html; charset=utf-8' });
}
function digest(value) { return createHash('sha256').update(value).digest(); }
function sign(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url'); }
function validSession(request, secret) {
  const cookieHeader = request.headers.get('cookie') || '';
  if (cookieHeader.length > 16384) return false;
  const matches = cookieHeader.split(';').map(s => s.trim()).filter(s => s.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return false;
  const token = matches[0].slice(COOKIE.length + 1);
  const match = /^(\d{10,13})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const [, expiry, nonce, signature] = match;
  const expected = sign(`${expiry}.${nonce}`, secret);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  const remaining = Number(expiry) - Math.floor(Date.now() / 1000);
  return remaining > 0 && remaining <= SESSION_SECONDS;
}
function sessionCookie(request, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return (!origin || origin === new URL(request.url).origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
}
async function bodyText(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('Body too large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function rateBucket(request) {
  const now = Date.now();
  const key = digest((request.headers.get('x-forwarded-for') || 'unknown').slice(0, 256)).toString('hex');
  for (const [id, bucket] of attempts) if (bucket.until <= now) attempts.delete(id);
  if (!attempts.has(key)) {
    if (attempts.size >= MAX_BUCKETS) attempts.delete(attempts.keys().next().value);
    attempts.set(key, { count: 0, until: now + WINDOW_MS });
  }
  return attempts.get(key);
}

/** Return a denial/auth response, or null to let the protected server continue. */
export async function gate(request, env = process.env) {
  const password = env.ITUBE_PASSWORD;
  const secret = env.ITUBE_SESSION_SECRET;
  if (typeof password !== 'string' || !password || password.startsWith('REPLACE_WITH_') || typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || secret.startsWith('REPLACE_WITH_') || secret === password) {
    return response('Sign-in is temporarily unavailable.', 503);
  }
  const url = new URL(request.url);
  const authenticated = validSession(request, secret);
  if (url.pathname === '/login') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const result = authenticated ? redirect(returnPath(url.searchParams.get('returnTo'))) : loginPage(returnPath(url.searchParams.get('returnTo')));
      if (request.method === 'HEAD') return new Response(null, { status: result.status, headers: result.headers });
      return result;
    }
    if (request.method !== 'POST') return response(null, 405, { Allow: 'GET, HEAD, POST' });
    if (!sameOrigin(request)) return response('Request origin not allowed.', 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return response('Use the password form to sign in.', 415);
    let form;
    try { form = new URLSearchParams(await bodyText(request)); }
    catch { return response('Sign-in request is too large or invalid.', 413); }
    const returnTo = returnPath(form.get('returnTo'));
    const bucket = rateBucket(request);
    if (bucket.count >= MAX_ATTEMPTS) return response('Too many attempts. Please try again later.', 429, { 'Retry-After': String(Math.max(1, Math.ceil((bucket.until - Date.now()) / 1000))) });
    bucket.count++;
    if (!timingSafeEqual(digest(form.get('password') || ''), digest(password))) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return loginPage(returnTo, 'That password didn’t match. Please try again.', 401);
    }
    bucket.count = 0;
    const payload = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${randomBytes(24).toString('base64url')}`;
    return redirect(returnTo, { 'Set-Cookie': sessionCookie(request, `${payload}.${sign(payload, secret)}`, SESSION_SECONDS) });
  }
  if (url.pathname === '/logout') {
    if (request.method !== 'POST') return response(null, 405, { Allow: 'POST' });
    if (!sameOrigin(request)) return response('Request origin not allowed.', 403);
    return redirect('/login', { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (authenticated) return null;
  const resource = url.pathname.startsWith('/data/') || url.pathname === '/data' || /\.[^/]+$/.test(url.pathname);
  if (request.method === 'GET' && !resource && (request.headers.get('accept')?.includes('text/html') || !request.headers.get('accept'))) {
    return redirect(`/login?returnTo=${encodeURIComponent(returnPath(url.pathname + url.search))}`);
  }
  return response(null, 401);
}
