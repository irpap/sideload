#!/usr/bin/env node
/* Generate a sideload signing keypair.
 *
 * You do not need this: the compiler's "Create key" button does the same thing
 * in your browser, and that way the private key never touches a terminal, a
 * shell history, or a scrollback buffer. Use this if you prefer a CLI, or if
 * you are scripting setup.
 *
 *   node tools/keygen.mjs
 *   node tools/keygen.mjs --quiet > key.txt     # private key only
 */
import { webcrypto as crypto } from 'node:crypto';

const EC = { name: 'ECDSA', namedCurve: 'P-256' };
const b64url = (buf) =>
  Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const kp = await crypto.subtle.generateKey(EC, true, ['sign', 'verify']);
const priv = b64url(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
const pub = b64url(await crypto.subtle.exportKey('raw', kp.publicKey));

if (process.argv.includes('--quiet')) {
  console.log(priv);
  process.exit(0);
}

console.log(`
sideload signing key
====================

1. PRIVATE KEY  --  secret. Save it in your password manager now.
   It is the only thing that can publish or update apps on your instance,
   and it cannot be recovered. Paste it into the compiler on each device
   you want to publish from ("Import key").

${priv}

2. PUBLIC KEY  --  not secret. Put this line in index.html, commit, deploy.
   Your engine will then run only apps signed by the key above.

var PUBLIC_KEY = '${pub}';

If you forked someone else's repo, you must replace that line with your own
key. If you forget, the compiler will tell you the key does not match and
will not let you publish.
`);
