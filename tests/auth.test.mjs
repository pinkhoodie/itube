import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { gate } from '../auth.mjs';

const env = {
  ITUBE_PASSWORD: randomBytes(20).toString('base64url'),
  ITUBE_SESSION_SECRET: randomBytes(48).toString('base64url'),
};
let client = 0;
function req(path = '/', init = {}, origin = 'https://itube.test') {
  return new Request(origin + path, init);
}
function post(path, fields, extra = {}, origin = 'https://itube.test') {
  return req(path, { method: 'POST', body: new URLSearchParams(fields), headers: { 'x-forwarded-for': `test-client-${client++}`, ...extra } }, origin);
}
async function login(returnTo = '/', origin = 'https://itube.test') {
  return gate(post('/login', { password: env.ITUBE_PASSWORD, returnTo }, {}, origin), env);
}
function cookie(result) { return result.headers.get('set-cookie').split(';')[0]; }
function tokenAt(expiry, secret = env.ITUBE_SESSION_SECRET) {
  const payload = `${expiry}.${randomBytes(24).toString('base64url')}`;
  return `itube_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function assertPrivate(result) {
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.match(result.headers.get('x-robots-tag'), /noindex/);
}

test('fails closed on every path when either setting is missing or unsafe', async () => {
  for (const config of [{}, { ITUBE_PASSWORD: env.ITUBE_PASSWORD }, { ITUBE_SESSION_SECRET: env.ITUBE_SESSION_SECRET }, { ...env, ITUBE_SESSION_SECRET: 'short' }, { ITUBE_PASSWORD: env.ITUBE_SESSION_SECRET, ITUBE_SESSION_SECRET: env.ITUBE_SESSION_SECRET }]) {
    for (const path of ['/', '/login', '/logout', '/data/videos.json', '/app.js']) {
      const result = await gate(req(path), config);
      assert.equal(result.status, 503);
      assertPrivate(result);
      const text = await result.text();
      assert.ok(!text.includes(env.ITUBE_PASSWORD));
      assert.ok(!text.includes(env.ITUBE_SESSION_SECRET));
    }
  }
});

test('browser form origin is preserved without leaking cross-site referrers', async () => {
  const result=await gate(req('/login'),env);
  assert.equal(result.headers.get('referrer-policy'),'same-origin');
});

test('login page is self-contained, private, accessible, and does not reveal credentials', async () => {
  const result = await gate(req('/login?returnTo=%2Fwatch%3Fid%3Dabc'), env);
  assert.equal(result.status, 200);
  assertPrivate(result);
  assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await result.text();
  assert.match(html, /iTube/);
  assert.match(html, /method="post" action="\/login"/);
  assert.match(html, /type="password"/);
  assert.match(html, /30 days/);
  assert.match(html, /value="\/watch\?id=abc"/);
  assert.ok(!html.includes(env.ITUBE_PASSWORD));
  assert.ok(!html.includes(env.ITUBE_SESSION_SECRET));
  assert.ok(!/<script|<link|<img/i.test(html));
  const head = await gate(req('/login', { method: 'HEAD' }), env);
  assert.equal(await head.text(), '');
});

test('HTML navigation preserves path and query; direct resources and non-GET are denied empty', async () => {
  const nav = await gate(req('/watch?item=123&mode=all', { headers: { accept: 'text/html' } }), env);
  assert.equal(nav.status, 303);
  assert.equal(nav.headers.get('location'), '/login?returnTo=%2Fwatch%3Fitem%3D123%26mode%3Dall');
  assertPrivate(nav);
  for (const path of ['/data/videos.json', '/data/private', '/data', '/app.js', '/style.css', '/favicon.ico']) {
    const result = await gate(req(path, { headers: { accept: 'text/html' } }), env);
    assert.equal(result.status, 401, path);
    assert.equal(await result.text(), '');
    assertPrivate(result);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const result = await gate(req('/watch', { method }), env);
    assert.equal(result.status, 401);
    assert.equal(await result.text(), '');
  }
});

test('HTTPS login sets 30-day signed secure cookie; authenticated paths and methods continue', async () => {
  const result = await login('/watch?v=abc');
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/watch?v=abc');
  assert.equal(await result.text(), '');
  assertPrivate(result);
  const setCookie = result.headers.get('set-cookie');
  for (const flag of ['Max-Age=2592000', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes(env.ITUBE_PASSWORD));
  assert.ok(!setCookie.includes(env.ITUBE_SESSION_SECRET));
  for (const path of ['/', '/data/videos.json', '/app.js']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD']) {
      assert.equal(await gate(req(path, { method, headers: { cookie: cookie(result) } }), env), null);
    }
  }
  const revisit = await gate(req('/login?returnTo=%2Fwatch', { headers: { cookie: cookie(result) } }), env);
  assert.equal(revisit.status, 303);
  assert.equal(revisit.headers.get('location'), '/watch');
});

test('local HTTP sessions work without Secure and cookies are randomized per login', async () => {
  const a = await login('/', 'http://localhost:3000');
  const b = await login('/', 'http://localhost:3000');
  assert.doesNotMatch(a.headers.get('set-cookie'), /; Secure/);
  assert.notEqual(cookie(a), cookie(b));
  assert.equal(await gate(req('/', { headers: { cookie: cookie(a) } }, 'http://localhost:3000'), env), null);
});

test('wrong password waits at least 250ms and provides safe retry form', async () => {
  const wrong = randomBytes(16).toString('hex');
  const start = performance.now();
  const result = await gate(post('/login', { password: wrong, returnTo: '/watch?x=1' }), env);
  assert.ok(performance.now() - start >= 245);
  assert.equal(result.status, 401);
  assert.equal(result.headers.get('set-cookie'), null);
  assertPrivate(result);
  const html = await result.text();
  assert.match(html, /Please try again/);
  assert.ok(!html.includes(wrong));
  assert.match(html, /value="\/watch\?x=1"/);
  const missing = await gate(post('/login', {}), env);
  assert.equal(missing.status, 401);
});

test('expired, future, tampered, malformed, duplicate, and rotated sessions are rejected', async () => {
  const good = cookie(await login());
  const now = Math.floor(Date.now() / 1000);
  const tokens = [
    '', 'itube_session=%bad', 'itube_session=undefined', 'itube_session=1.a.b',
    good.replace(/.$/, good.endsWith('a') ? 'b' : 'a'),
    tokenAt(now - 1), tokenAt(now), tokenAt(now + 2592060),
    tokenAt(now + 100, randomBytes(48).toString('hex')),
    `${good}; ${good}`, `itube_session=${'x'.repeat(17000)}`,
  ];
  for (const value of tokens) {
    const result = await gate(req('/data/private.json', { headers: { cookie: value } }), env);
    assert.equal(result.status, 401);
  }
  assert.equal(await gate(req('/', { headers: { cookie: tokenAt(now + 10) } }), env), null);
});

test('returnTo cannot redirect externally or inject markup/headers', async () => {
  for (const unsafe of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/%0d%0aLocation:evil', '/login', '/logout', '/%252f%252fevil.test', '/a/..//evil.test', '/%2e%2e//evil.test']) {
    const result = await login(unsafe);
    assert.equal(result.headers.get('location'), '/', unsafe);
  }
  const result = await gate(req('/login?returnTo=' + encodeURIComponent('/watch?x="<x>')), env);
  const html = await result.text();
  assert.ok(!html.includes('value="/watch?x="<x>'));
  assert.match(html, /value="\/watch\?x=%22%3Cx%3E"/);
});

test('login and logout reject cross-origin/browser cross-site requests', async () => {
  for (const path of ['/login', '/logout']) {
    for (const extra of [{ origin: 'https://evil.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
      const result = await gate(post(path, { password: env.ITUBE_PASSWORD }, extra), env);
      assert.equal(result.status, 403);
      assert.equal(result.headers.get('set-cookie'), null);
      assertPrivate(result);
    }
  }
  assert.equal((await gate(post('/login', { password: env.ITUBE_PASSWORD }, { origin: 'https://itube.test' }), env)).status, 303);
});

test('logout is POST-only and clears the cookie without a cached response', async () => {
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const result = await gate(req('/logout', { method }), env);
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'POST');
    assert.equal(result.headers.get('set-cookie'), null);
  }
  const result = await gate(post('/logout', {}, { origin: 'https://itube.test' }), env);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/login');
  assert.match(result.headers.get('set-cookie'), /^itube_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure$/);
  assertPrivate(result);
  assert.equal(await result.text(), '');
});

test('body limit is enforced for declared and streamed bodies; wrong content type and methods fail', async () => {
  const oversized = await gate(post('/login', { password: 'x'.repeat(5000) }), env);
  assert.equal(oversized.status, 413);
  const declared = await gate(post('/login', {}, { 'content-length': '5000' }), env);
  assert.equal(declared.status, 413);
  const streamed = new Request('https://itube.test/login', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); controller.close(); } }) });
  assert.equal((await gate(streamed, env)).status, 413);
  assert.equal((await gate(req('/login', { method: 'POST', body: '{}' }), env)).status, 415);
  assert.equal((await gate(req('/login', { method: 'DELETE' }), env)).status, 405);
});

test('best-effort runtime limiter stops repeated attempts and sends Retry-After', async () => {
  const ip = `limited-${randomBytes(10).toString('hex')}`;
  for (let i = 0; i < 8; i++) {
    const result = await gate(post('/login', { password: 'incorrect' }, { 'x-forwarded-for': ip }), env);
    assert.equal(result.status, 401);
  }
  const result = await gate(post('/login', { password: env.ITUBE_PASSWORD }, { 'x-forwarded-for': ip }), env);
  assert.equal(result.status, 429);
  assert.ok(Number(result.headers.get('retry-after')) > 0);
  assert.equal(result.headers.get('set-cookie'), null);
  assertPrivate(result);
});
