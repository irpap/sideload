/* Headless checks for the parts of sideload that don't need a browser:
   the payload codec, prelude injection, the storage namespacing shim,
   and the Claude-runtime stand-in.
   Run: node test/run.mjs [extra.html ...]                                  */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (d ? ' -- ' + d : '')); }
};
const eq = (n, a, b) =>
  ok(n, a === b, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
const head = (s) => console.log('\n' + s);

/* ---- lift the pure/codec helpers out of the IIFE and eval them ---- */
const grab = (...names) => names.map((n) => {
  const m = new RegExp('\\nfunction ' + n + '\\([\\s\\S]*?\\n\\}', 'm').exec(src);
  if (!m) throw new Error('could not extract ' + n + '()');
  return m[0];
}).join('\n');

const ctx = {
  TextEncoder, TextDecoder, CompressionStream, DecompressionStream,
  Response, btoa, atob, URL, console, Promise, Math, JSON, Array,
  String, Number, Uint8Array, Buffer,
  crypto: webcrypto,
  window: { crypto: webcrypto },
};
/* the algorithm constants are `var`s, not functions -- pull them from source
   too rather than restating them here, so the test cannot drift from the engine */
const grabVar = (name) => {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*[^;]+;').exec(src);
  if (!m) throw new Error('could not extract var ' + name);
  return m[0];
};

vm.createContext(ctx);
vm.runInContext(
  "var VERSION='2';\nvar PUBLIC_KEY='';\nvar te=new TextEncoder(), td=new TextDecoder();\n" +
  grabVar('EC') + grabVar('SIGALG') + '\n' +
  grab('gzipStr', 'gunzipBytes', 'toB64url', 'fromB64url', 'injectPrelude',
       'slugify', 'hashStr', 'analyze', 'guessTitle', 'haveCrypto',
       'importPublic', 'importPrivate', 'genKeyPair', 'exportPublicRaw',
       'exportPrivatePkcs8', 'publicFromPrivate', 'encodeSigned',
       'decodeVerified'),
  ctx);

/* Two independent keypairs: one is "this instance", one is an attacker. */
const mkKey = async () => {
  const kp = await ctx.genKeyPair();
  return {
    priv: await ctx.exportPrivatePkcs8(kp.privateKey),
    pub: await ctx.exportPublicRaw(kp.publicKey),
  };
};
const mine = await mkKey();
const theirs = await mkKey();
const setInstanceKey = (pub) => vm.runInContext(`PUBLIC_KEY=${JSON.stringify(pub)};`, ctx);
setInstanceKey(mine.pub);

const sign = (meta) => ctx.encodeSigned(meta, mine.priv);
const APP = { v: 1, title: 'T', slug: 't', html: '<p>hi</p>', claudeShim: true };

const preludeBody = src.match(/var PRELUDE_BODY = `([\s\S]*?)`;\n/)[1];

class FakeStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { const k = [...this.m.keys()][i]; return k === undefined ? null : k; }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(String(k)); }
}

/* Minimal DOM/BOM stand-in: enough for the prelude to install itself. */
function fakeEnv(backing, slug, { claudeShim = true, payload = 'PAY' } = {}) {
  const listeners = { window: {}, document: {} };
  const appended = [];
  const mkEl = (tag) => ({
    tagName: String(tag).toUpperCase(), style: {}, children: [], _attrs: {},
    textContent: '', innerHTML: '',
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); appended.push(c); return c; },
    remove() {},
    querySelector() { return mkEl('div'); },
    attachShadow() { const r = mkEl('shadow'); this.shadowRoot = r; return r; },
    closest() { return null; },
    scrollIntoView() {},
  });
  const doc = {
    readyState: 'complete',
    head: mkEl('head'), body: mkEl('body'),
    createElement: mkEl,
    getElementById: () => null,
    getElementsByName: () => [],
    addEventListener(t, f) { (listeners.document[t] ||= []).push(f); },
  };
  const win = {
    localStorage: backing, sessionStorage: new FakeStorage(),
    addEventListener(t, f) { (listeners.window[t] ||= []).push(f); },
    scrollTo() {},
  };
  const sb = {
    window: win, document: doc, console, Promise, Object, Array, String,
    JSON, Proxy, Math, URL,
    location: { hash: '#' + payload, href: 'https://x.test/sideload/#' + payload,
                origin: 'https://x.test' },
    history: { replaceState() {} },
    CFG: { ns: '__sideload__' + slug + ':', slug, origin: 'https://x.test', claudeShim },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext('(function(){\n' + preludeBody + '\n})();', sb);
  return { win, doc, listeners, appended };
}
const runApp = (backing, slug, claudeShim = true) =>
  fakeEnv(backing, slug, { claudeShim });

/* ===================== 1. signed payload codec ===================== */
head('1. Signed payload codec');
{
  const closeTag = '<' + '/script>';
  const samples = [
    ['ascii', '<h1>hi</h1>'],
    ['emoji + CJK', '<p>\u{1F389} 日本語 — café naïve ½</p>'],
    ['quotes', '<a href="x" data-y=\'z\'>&amp;</a>'],
    ['script close', '<script>var s="' + closeTag + '";' + closeTag],
    ['controls', '<p>a bc\td\r\ne</p>'],
    ['long', '<div>' + 'x'.repeat(200000) + '</div>'],
  ];
  for (const [name, body] of samples) {
    const meta = { ...APP, title: 'T \u{1F388}', html: body };
    const p = await sign(meta);
    const back = await ctx.decodeVerified(p);
    ok('round-trip: ' + name, back.html === body && back.title === meta.title);
    ok('url-safe:   ' + name, /^2-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(p), p.slice(0, 48));
  }

  const good = await sign(APP);
  eq('signature is 86 b64url chars', good.split('.')[0].slice(2).length, 86);

  try { await ctx.decodeVerified('9-' + good.slice(2)); ok('rejects wrong version', false); }
  catch (e) { ok('rejects wrong version', /format "9"/.test(e.message), e.message); }
  try { await ctx.decodeVerified('garbage'); ok('rejects no version prefix', false); }
  catch (e) { ok('rejects no version prefix', /no version prefix/.test(e.message), e.message); }
  try { await ctx.decodeVerified('2-nodothere'); ok('rejects missing signature', false); }
  catch (e) { ok('rejects missing signature', /missing signature/.test(e.message), e.message); }
}

/* ================= 1b. forgery and tampering =================
 * The whole security model is here: an attacker controls only the fragment,
 * so these are the only moves available to them.                          */
head('1b. Forgery and tampering');
{
  const good = await sign(APP);
  const [sig, body] = [good.slice(2).split('.')[0], good.slice(2).split('.')[1]];

  ok('the honest payload verifies', !!(await ctx.decodeVerified(good)));

  const expectBadSig = async (label, payload) => {
    try { await ctx.decodeVerified(payload); ok(label, false, 'it RENDERED'); }
    catch (e) { ok(label, e.message === 'BADSIG', 'threw ' + e.message); }
  };

  /* attacker swaps in their own app, keeps the victim's signature */
  const evilBody = (await sign({ ...APP, html: '<script>steal()<' + '/script>' })).split('.')[1];
  await expectBadSig('rejects swapped body', '2-' + sig + '.' + evilBody);

  /* attacker signs their app with their OWN key */
  const theirSigned = await ctx.encodeSigned({ ...APP, html: '<p>evil</p>' }, theirs.priv);
  await expectBadSig('rejects a different key', theirSigned);

  /* attacker flips bits in the signature */
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  await expectBadSig('rejects flipped signature byte', '2-' + flip(sig, 10) + '.' + body);

  /* attacker flips bits in the body */
  await expectBadSig('rejects flipped body byte', '2-' + sig + '.' + flip(body, 20));

  /* attacker strips the signature entirely */
  await expectBadSig('rejects empty signature', '2-.' + body);

  /* VERIFY-BEFORE-DECOMPRESS: body is both unsigned AND not valid gzip.
     A gzip error here would prove we decompressed attacker bytes first. */
  await expectBadSig('verifies before decompressing', '2-' + sig + '.' + ctx.toB64url(
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])));

  /* replaying the author's own payload is fine -- it is just their app */
  const replayed = await ctx.decodeVerified(good);
  eq('replay of own payload is allowed', replayed.html, APP.html);

  /* an unconfigured instance runs nothing at all */
  setInstanceKey('');
  try { await ctx.decodeVerified(good); ok('unconfigured instance runs nothing', false, 'it RENDERED'); }
  catch (e) { ok('unconfigured instance runs nothing', e.message === 'UNCONFIGURED', e.message); }
  setInstanceKey(mine.pub);
  ok('restored instance key', !!(await ctx.decodeVerified(good)));
}

/* ====================== 1c. key handling ====================== */
head('1c. Key handling');
{
  ok('haveCrypto() true under Node webcrypto', ctx.haveCrypto());
  eq('public key is a 65-byte EC point', ctx.fromB64url(mine.pub).length, 65);
  eq('uncompressed point marker', ctx.fromB64url(mine.pub)[0], 4);

  /* the compiler derives the public half to compare against the deployment */
  eq('publicFromPrivate matches', await ctx.publicFromPrivate(mine.priv), mine.pub);
  ok('two keypairs differ', mine.pub !== theirs.pub);
  eq('publicFromPrivate(theirs) matches theirs', await ctx.publicFromPrivate(theirs.priv), theirs.pub);

  /* a private key round-trips through the backup string */
  const reimported = await ctx.importPrivate(mine.priv);
  ok('private key re-imports from backup string', !!reimported);
  const afterRestore = await ctx.encodeSigned(APP, mine.priv);
  ok('restored key still produces valid signatures', !!(await ctx.decodeVerified(afterRestore)));

  try { await ctx.importPrivate(ctx.toB64url(new Uint8Array([9, 9, 9]))); ok('junk key rejected', false); }
  catch { ok('junk key rejected', true); }
}

/* ====================== 2. prelude injection ====================== */
head('2. Prelude injection');
{
  const S = '<!--P-->';
  const cases = [
    ['after <head>', '<!doctype html><html><head><meta></head><body>b</body></html>', '<head>'],
    ['after <html>', '<!doctype html><html><body>b</body></html>', '<html>'],
    ['after doctype', '<!doctype html><body>b</body>', '<!doctype html>'],
    ['bare fragment', '<div>b</div>', null],
    ['head with attrs', '<html><head lang="en" x>y</head></html>', '<head lang="en" x>'],
  ];
  for (const [name, doc, anchor] of cases) {
    const out = ctx.injectPrelude(doc, S);
    eq(name, out.indexOf(S), anchor ? doc.indexOf(anchor) + anchor.length : 0);
    ok(name + ' -- document otherwise untouched', out.replace(S, '') === doc);
  }
  ok('doctype stays first',
     ctx.injectPrelude('<!doctype html><html><head></head>', S)
        .toLowerCase().startsWith('<!doctype html>'));
}

/* ====================== 3. storage shim ====================== */
head('3. Storage namespacing shim');
{
  const backing = new FakeStorage();
  const a = runApp(backing, 'budget').win;
  const b = runApp(backing, 'japan').win;

  ok('localStorage proxied', a.localStorage !== backing);
  ok('sessionStorage proxied', a.sessionStorage && typeof a.sessionStorage.getItem === 'function');

  a.localStorage.setItem('data', 'BUDGET');
  b.localStorage.setItem('data', 'JAPAN');
  eq('app A reads its own', a.localStorage.getItem('data'), 'BUDGET');
  eq('app B reads its own', b.localStorage.getItem('data'), 'JAPAN');
  eq('backing key namespaced', backing.getItem('__sideload__budget:data'), 'BUDGET');
  eq('no bare key leaked', backing.getItem('data'), null);
  eq('missing key is null', a.localStorage.getItem('nope'), null);

  /* property-style access -- plenty of generated artifacts use it */
  a.localStorage.viaProp = 'yes';
  eq('property set', a.localStorage.getItem('viaProp'), 'yes');
  eq('property get', a.localStorage.viaProp, 'yes');
  ok('"in" works', 'viaProp' in a.localStorage);
  ok('"in" is scoped', !('viaProp' in b.localStorage));
  delete a.localStorage.viaProp;
  eq('property delete', a.localStorage.getItem('viaProp'), null);

  /* enumeration must only ever see our own namespace */
  a.localStorage.setItem('second', '2');
  eq('length scoped (A)', a.localStorage.length, 2);
  eq('length scoped (B)', b.localStorage.length, 1);
  eq('Object.keys scoped',
     JSON.stringify(Object.keys(a.localStorage).sort()),
     JSON.stringify(['data', 'second']));
  ok('key(i) de-prefixed', ['data', 'second'].includes(a.localStorage.key(0)));
  eq('key() out of range', a.localStorage.key(99), null);

  /* clear() must not touch the neighbour */
  a.localStorage.clear();
  eq('clear emptied A', a.localStorage.length, 0);
  eq('clear spared B', b.localStorage.getItem('data'), 'JAPAN');
  eq('methods survive clear', typeof a.localStorage.getItem, 'function');

  /* numbers and objects coerce like the real thing */
  a.localStorage.setItem('n', 42);
  eq('values coerce to string', a.localStorage.getItem('n'), '42');
}

/* ================= 4. Claude runtime stand-in ================= */
head('4. Claude artifact-runtime stand-in');
{
  const backing = new FakeStorage();
  const { win } = runApp(backing, 'fully-mine', true);
  const claude = win.claude;
  ok('window.claude installed', !!claude && typeof claude.use === 'function');

  const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  const id = await user.id();
  ok('user.id() resolves', typeof id === 'string' && id.length > 0, id);

  /* exactly the call shape "Fully Mine.html" uses */
  const ref = db.doc('data/users/' + id + '/plan');
  const empty = await ref.get();
  eq('missing doc .exists', empty.exists, false);
  eq('missing doc .data()', empty.data(), null);

  await ref.set({ version: 3, amount: 6000 });
  const snap = await ref.get();
  eq('doc .exists after set', snap.exists, true);
  eq('doc .data() round-trips',
     JSON.stringify(snap.data()), JSON.stringify({ version: 3, amount: 6000 }));

  await ref.update({ amount: 7000 });
  eq('doc .update merges',
     JSON.stringify((await ref.get()).data()),
     JSON.stringify({ version: 3, amount: 7000 }));

  const dbKey = [...backing.m.keys()].find((k) => k.includes('__claudedb__'));
  ok('db writes land in the app namespace',
     !!dbKey && dbKey.startsWith('__sideload__fully-mine:'), dbKey);

  await ref.delete();
  eq('doc .delete', (await ref.get()).exists, false);

  eq('use() of unknown capability', await claude.use('nope'), null);

  /* with the stand-in off, window.claude must stay absent */
  const off = runApp(new FakeStorage(), 'no-shim', false).win;
  ok('stand-in respects the toggle', !off.claude);
}

/* ============ 4b. runner guards installed by the prelude ============ */
head('4b. Runner guards');
{
  const direct = fakeEnv(new FakeStorage(), 'direct-app');
  ok('error handler installed', !!direct.listeners.window.error);
  ok('rejection handler installed', !!direct.listeners.window.unhandledrejection);
  ok('click guard installed', !!direct.listeners.document.click);
  ok('hash guard installed', !!direct.listeners.window.hashchange);

  const sl = direct.appended.find(
    (e) => e.getAttribute && e.getAttribute('data-sideload') === 'touch');
  ok('slider touch-action fix injected', !!sl,
     JSON.stringify(direct.appended.map((e) => e.tagName)));
  ok('touch-action targets range inputs',
     !!sl && /input\[type=range\]\s*\{\s*touch-action:\s*none\s*\}/.test(sl.textContent),
     sl && sl.textContent);
  ok('touch fix avoids !important', !!sl && !/!important/.test(sl.textContent));

}

/* ============ 5. real artifacts: fidelity, budget, analysis ============ */
head('5. Real artifacts -- byte fidelity, budget, analysis');
{
  const BUDGET = 64000;
  const files = process.argv.slice(2);
  const dir = path.join(root, 'samples');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f)))
      files.push(path.join(dir, f));
  }
  if (!files.length) console.log('  (none found -- pass artifact paths as arguments)');

  for (const f of files) {
    if (!fs.existsSync(f)) { ok('missing file: ' + f, false); continue; }
    const body = fs.readFileSync(f, 'utf8');
    const name = path.basename(f);
    const title = ctx.guessTitle(body) || name.replace(/\.html?$/i, '');
    const slug = ctx.slugify(title);

    const payload = await sign({ v: 1, title, slug, html: body, claudeShim: true });
    const back = await ctx.decodeVerified(payload);

    ok(name + ' -- byte-identical round-trip', back.html === body,
       back.html.length !== body.length
         ? back.html.length + ' vs ' + body.length + ' chars'
         : 'same length, different bytes');
    eq(name + ' -- title survives', back.title, title);

    const urlLen = 'https://example.github.io/sideload/'.length + 1 + payload.length;
    const pct = urlLen / BUDGET * 100;
    const raw = Buffer.byteLength(body, 'utf8');
    console.log('       ' + (raw / 1024).toFixed(1) + ' KB raw -> ' + payload.length +
                ' payload chars -> ~' + urlLen + ' URL chars (' + pct.toFixed(1) +
                '% of budget), slug "' + slug + '"');
    ok(name + ' -- fits the budget', urlLen <= BUDGET, urlLen + ' > ' + BUDGET);

    const a = ctx.analyze(body);
    if (a.hosts.length) console.log('       external hosts: ' + a.hosts.join(', '));
    if (a.claude) console.log('       expects window.claude -- stand-in will cover it');
    if (a.storage) console.log('       uses local/sessionStorage -- namespaced to "' + slug + '"');
    if (a.modules) console.log('       uses ES modules');
    if (a.dataImgs) console.log('       ' + a.dataImgs + ' embedded base64 image(s)');
  }
}

console.log('\n' + (fail ? 'FAILED' : 'All passed') +
            ' -- ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
