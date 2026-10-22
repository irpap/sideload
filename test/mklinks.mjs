/* Dev helper: build signed links, plus short redirect stubs under local/ so a
   20,000-character URL is tappable on a phone during testing.

   Needs a signing key, since the engine refuses unsigned payloads:
     SIDELOAD_KEY=<private key>  node test/mklinks.mjs https://host
   or put the key in local/key.txt (gitignored) and just:
     node test/mklinks.mjs https://host                                      */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<div id="root"><\/div>\s*<script>([\s\S]*?)\n<\/script>/)[1];

const grab = (...n) => n.map((x) =>
  new RegExp('\\nfunction ' + x + '\\([\\s\\S]*?\\n\\}', 'm').exec(src)[0]).join('\n');
const grabVar = (name) =>
  new RegExp('\\nvar ' + name + '\\s*=\\s*[^;]+;').exec(src)[0];

const ctx = {
  TextEncoder, TextDecoder, CompressionStream, Response, btoa, atob, URL,
  console, Promise, Math, JSON, Array, String, Number, Uint8Array,
  crypto: webcrypto, window: { crypto: webcrypto },
};
vm.createContext(ctx);
vm.runInContext(
  "var VERSION='2';var te=new TextEncoder(),td=new TextDecoder();\n" +
  grabVar('EC') + grabVar('SIGALG') + '\n' +
  grab('gzipStr', 'toB64url', 'fromB64url', 'importPrivate', 'encodeSigned',
       'slugify', 'guessTitle'), ctx);

/* ---- the signing key ---- */
const keyFile = path.join(root, 'local', 'key.txt');
const priv = (process.env.SIDELOAD_KEY ||
  (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();

if (!priv) {
  console.error(`
No signing key. The engine refuses unsigned payloads, so this tool needs one.

  SIDELOAD_KEY=<private key> node test/mklinks.mjs <baseUrl>

or write the key to local/key.txt (gitignored). Generate one with:

  node tools/keygen.mjs

For a real deployment, prefer the compiler's "Create key" button -- that way the
private key never lands in shell history or scrollback.
`);
  process.exit(1);
}
try { await ctx.importPrivate(priv); }
catch { console.error('That key is not a valid sideload private key.'); process.exit(1); }

const base = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const outDir = path.join(root, 'local');
fs.mkdirSync(outDir, { recursive: true });

/* [ sourceFile, stubName, slugOverride ] */
const jobs = [
  ['/Users/irene/Downloads/Fully Mine.html', 'fully-mine', null],
  [path.join(root, 'samples/storage-probe.html'), 'probe-a', 'probe-a'],
  [path.join(root, 'samples/storage-probe.html'), 'probe-b', 'probe-b'],
];

const index = [];
for (const [file, stub, slugOverride] of jobs) {
  if (!fs.existsSync(file)) { console.log('skip (missing): ' + file); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const title = (ctx.guessTitle(html) || path.basename(file).replace(/\.html?$/i, '')) +
                (slugOverride ? ' ' + slugOverride.slice(-1).toUpperCase() : '');
  const slug = slugOverride || ctx.slugify(title);
  const payload = await ctx.encodeSigned({ v: 1, title, slug, html, claudeShim: true }, priv);
  const target = base + '/#' + payload;

  fs.writeFileSync(path.join(outDir, stub + '.html'),
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<body style="font:16px -apple-system,system-ui,sans-serif;padding:2rem;background:#101318;color:#e8ebf1">' +
    '<p>Opening <b>' + title + '</b>…</p>' +
    '<p style="color:#98a1b0;font-size:13px">' + target.length + ' character URL. ' +
    'If nothing happens, <a id="a" style="color:#5b9dff">tap here</a>.</p>' +
    '<script>var t=' + JSON.stringify(target) + ';' +
    'document.getElementById("a").href=t;location.replace(t);<\/script>');

  index.push({ title, slug, stub, chars: target.length });
  console.log(stub.padEnd(12) + String(target.length).padStart(7) + ' chars  ' +
              base + '/local/' + stub + '.html');
}

fs.writeFileSync(path.join(outDir, 'index.html'),
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>sideload test links</title>' +
  '<body style="font:16px/1.6 -apple-system,system-ui,sans-serif;padding:1.5rem;' +
  'background:#101318;color:#e8ebf1;max-width:34rem;margin:auto">' +
  '<h1 style="font-size:19px">sideload test links</h1>' +
  '<ul style="padding-left:1.1rem">' +
  index.map((e) =>
    '<li style="margin:.7rem 0"><a href="' + e.stub + '.html" style="color:#5b9dff;font-weight:600">' +
    e.title + '</a><br><span style="color:#98a1b0;font-size:13px">slug <code>' + e.slug +
    '</code> &middot; ' + e.chars.toLocaleString() + ' char URL</span></li>').join('') +
  '</ul><p style="margin-top:1.4rem"><a href="../" style="color:#5b9dff">← compiler</a></p>');

console.log('\nindex:  ' + base + '/local/');
