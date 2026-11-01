# sideload

`sideload` runs single-file HTML apps from a URL. The app's source is stored in the URL
fragment instead of on a server, so you publish an app by pasting its HTML into a page and
saving the link it gives you. The engine is deployed once and individual apps are not
deployed at all.

## Why it exists

LLMs are good at writing small self-contained HTML tools: a calculator, a tracker, a
checklist, usually a few hundred lines of HTML, CSS and JavaScript that keep their state in
`localStorage`. On a desktop you can open the file from disk and it runs. On iOS you cannot,
because Safari will not open a local `.html` file and run it as a web page. The normal way
to get one onto the home screen is to commit it to a repository and deploy it to a host,
which is a lot of steps for a single file and needs a computer.

sideload avoids the per-app deploy by storing the app in the URL. You deploy the engine once
to GitHub Pages, and after that, pasting HTML into it gives you a signed link that contains
the app:

```
you.github.io/sideload/#2-SXg9kR7mQw…jTn.H4sIAAAAAAAA…
                        │ │              └ the app, gzipped then base64url-encoded
                        │ └ ECDSA P-256 signature over those bytes
                        └ payload format version
```

Everything after `#` is the URL fragment. Browsers do not send fragments in HTTP requests,
so GitHub Pages serves `index.html` without seeing the payload.

`index.html` is both the compiler and the runtime. With no fragment it shows the compiler,
where you paste HTML and sign it. With a fragment it verifies the signature against the
public key compiled into it, decompresses the payload and runs the app.

iOS Add to Home Screen saves the whole URL including the fragment, so each app gets its own
icon, its own title and its own storage.

## How it works

### Rendering with document.write instead of a data: iframe

[itty.bitty.site](https://github.com/arfct/itty-bitty) has stored pages in URL fragments
since 2018. It decodes the fragment and hands the HTML to an iframe as a `data:text/html`
URL. That works for static documents, but a `data:` URL runs in an opaque origin, where any
access to `localStorage` throws a `SecurityError` instead of returning empty, so an app that
stores anything breaks the first time it writes. A sandboxed iframe behaves the same way
unless you add `allow-same-origin`, and adding it removes the protection anyway, because
script inside the frame can delete its own `sandbox` attribute.

sideload writes the decoded HTML into the top-level document with `document.write` instead.
Replacing the document in place keeps three things that matter:

- the origin, `https://<you>.github.io`, so `localStorage` works normally
- the URL, so Add to Home Screen captures the fragment
- the top-level viewport, which matters because dragging an `<input type="range">` inside an
  iframe on iOS scrolls the page instead of moving the slider

The engine injects a prelude as the first script in the written document, so it runs before
any of the app's own code. The prelude replaces `window.localStorage` with a proxy that
prefixes every key with the app's data name, so two apps on one instance can both use a key
called `data` without overwriting each other.

### Signing

Because `document.write` runs the fragment on the real origin with full access to
`localStorage`, an engine that ran any fragment it was handed would let anyone build a link
to that origin containing their own JavaScript, and that code would be able to read whatever
the instance's apps had stored.

Each payload is signed with an ECDSA P-256 private key, and the matching public key is
compiled into `index.html`. The engine checks the signature before it decompresses or
renders anything, so a link signed with any other key does not run, and there is no prompt
to click through. Signing is what makes a single shared origin workable, and a single shared
origin is what removes the per-app deploy.

### Why not give each app its own origin

Storage isolation in the browser needs one origin per app. Of these three properties you can
have two:

| Approach | No deploy per app | Isolated origin per app | Free |
|---|---|---|---|
| **Single origin, signed payloads** (this) | Yes | No | Yes |
| One hostname per app | No | Yes | Yes |
| Wildcard DNS (`*.example.com`) | Yes | Yes | No |

One hostname per app means one deploy per app, and at that point the server already holds
the HTML and the fragment is doing nothing, which is ordinary static hosting. Wildcard DNS
gives you arbitrary subdomains with no deploys, but not for free. GitHub Pages cannot issue
a wildcard certificate, because its certificates cover one custom domain exactly as written.
Cloudflare proxies wildcard records on Enterprise plans only, and Netlify starts wildcard
subdomains at Pro. The cheapest arrangement that works is a small VPS with a DNS-01 wildcard
certificate, at roughly $70 a year.

### Offline

The app payload does not need the network, because it arrives in the link. The engine that
unpacks it does, so `sw.js` caches it in a service worker.

There is only one response to cache, which is what makes this straightforward. The fragment
is not part of the request, so every app you publish arrives as the same `GET` for the same
page. One cached response covers all of them, including apps published later, and the worker
does not need to know that apps exist. This is unrelated to the reason there is no manifest:
a manifest's `start_url` would drop the fragment, whereas a service worker only decides what
to answer a request with.

The worker asks the network first and falls back to the cache. Cache-first would be wrong
here, because a pushed fix would never reach a device, and a cached engine still holding an
old `PUBLIC_KEY` would reject links signed with the new one. A 2.5 second timer runs
alongside the request so a stalled connection does not leave you with a blank page, and a
response that arrives after the timer still updates the cache for next time.

## Setup

Done once, on a computer, because step 3 needs a commit. After that you can publish from a
phone.

### 1. Deploy an instance

Fork this repository. Under **Settings → Pages**, set **Source** to `Deploy from a branch`,
since GitHub defaults to "GitHub Actions", and set **Branch** to `main` with folder
`/ (root)`. The instance goes live at `https://<you>.github.io/sideload/`, usually within a
minute or two. It will refuse to run anything until a public key is configured.

### 2. Generate a keypair

Open the deployed URL and tap **Create key**. The browser generates an ECDSA P-256 keypair
locally and shows you both halves.

The private key signs and publishes apps to your instance. It cannot be recovered, so save
it to a password manager before closing the page. The public key goes into `index.html` so
the instance can verify your links.

`node tools/keygen.mjs` does the same thing from a terminal, though the browser is
preferable, because a terminal leaves the private key in shell history and scrollback.

### 3. Commit the public key

Replace the empty declaration near the top of `index.html` with the line the compiler shows
you:

```js
/* INSTANCE PUBLIC KEY  --  replace this with your own. See the README. */
var PUBLIC_KEY = 'BG9x...your key...';
```

Commit and push. Once Pages has redeployed, reloading the compiler should report **Ready to
publish**.

### 4. Import the private key on each publishing device

Open the instance on your phone, tap **Import key**, and paste the private key from your
password manager. Repeat on any other device you want to publish from. Devices that only run
the apps need nothing.

## Usage

**Publishing.** Paste HTML into the compiler. The app name comes from the `<title>` tag, and
a data name, which is the `localStorage` prefix, is derived from it. Check the size meter,
tap **Open app**, then **Share → Add to Home Screen**.

**Updating.** Paste the new HTML and keep the same data name, which is what reattaches the
new build to the existing storage keys. The source lives in the URL, so new code means a new
URL, and your old home-screen icon still points at the old version. Delete it and add the
new link.

**Sharing an app.** The person you send it to needs nothing. Their browser fetches the engine
from your instance, verifies the signature against your public key, and runs the app
locally. Their data stays in their own browser. Your private key is not involved and does not
travel, because `localStorage` is scoped per origin and per device and is never sent over the
network.

Links run to tens of thousands of characters, which is past QR code capacity and past what
some chat clients will carry intact. AirDrop, Messages, email and notes handle them.

**Sharing the tool.** Anyone who wants to publish their own apps forks the repository and
generates their own keypair. Each instance trusts only its own public key, so two instances
cannot publish to each other.

## Limitations

**URL length budget of 64,000 characters.** Neither the URI specification nor the WHATWG URL
Standard defines a maximum URL length. The 8,000 octet figure that gets quoted is RFC 7230's
recommended floor for an HTTP request line, which does not apply here, because the fragment
is never sent. Chromium documents a 2 MB cap of its own, and Apple publishes no figure for
Safari. The limit that actually matters is how long a URL iOS will keep in a home-screen
bookmark, and that is undocumented. So 64,000 is a conservative number chosen for the
compiler rather than a measured one, and the only measurement behind it is a link of roughly
21,000 characters that has survived Add to Home Screen on an iPhone.

A truncated link fails signature verification, because truncation changes the bytes. The
engine reports it as a cut-short link rather than rendering a broken page.

**Compression.** Payloads are gzipped and then base64url-encoded, which adds back about a
third, so what matters is HTML bytes per URL character rather than the gzip ratio on its
own. Measured on the HTML in this repository:

| File | Raw | Gzipped | Ratio |
|---|---|---|---|
| `index.html` | 74,325 B | 24,890 B | 2.99x |
| `samples/storage-probe.html` | 5,235 B | 2,203 B | 2.38x |
| a 53 KB app | 54,243 B | 15,580 B | 3.48x |

That 53 KB file produces a 21,411 character URL, about a third of the budget. At these
ratios the ceiling works out somewhere near 140 to 170 KB of HTML, though three files are
not a distribution. The compiler measures whatever you paste, and that number is the one to
go by. Inline base64 images will exceed the budget on their own.

**Offline usually works but is not guaranteed.** With the engine cached, an app that fetches
nothing external opens without a connection. iOS clears storage for sites it treats as idle,
home-screen apps survive longer than browser tabs but have no guarantee, and the first load
on a new device comes from the network.

**Browser requirements.** `CompressionStream`, so Safari 16.4, Chrome 80 or Firefox 113 and
later. Signature checking uses Web Crypto, which browsers only expose in a secure context,
so the page has to be served over `https://` or from `localhost` rather than a `file://`
path.

**External resources.** CDN scripts, stylesheets and remote fonts load normally, but they
add a network dependency every time the app opens. The compiler scans pasted HTML, lists the
external hosts it finds, and distinguishes a stylesheet, where the app still runs but looks
wrong, from a script, where it usually does not run.

**Storage eviction.** WebKit deletes script-writable storage after seven days without user
interaction for ordinary browser tabs, and exempts web apps added to the home screen. Use
**Export all app data** for anything that matters. The export contains app data and leaves
out the private key, which belongs in a password manager.

## Running Claude artifacts

Single-file artifacts from Claude can be pasted and published as they are.

Artifacts that persist state call `window.claude`, which only exists on claude.ai. The
engine injects a local stand-in backed by the app's namespaced `localStorage`, written
against the published runtime contract 0.2.96.

`db` is implemented in full, covering documents, collections, `where`, `orderBy` and `limit`
queries, `onSnapshot` subscriptions, generated ids and document leases. So is `user`, which
reports the viewer as the owner of the app.

`room`, `sample`, `artifact`, `assets`, `downloads`, `files`, `mcp` and `comments` are not
implemented, which is deliberate rather than unfinished. The contract has `claude.use(name)`
resolve to `null` for anything unavailable in a given view, and artifacts are written to
branch on that, so an app that wanted one of these degrades the way its author intended. A
half-implemented namespace would be worse than an absent one, because an object with missing
methods has no defined handling and throws.

The stand-in lives in `index.html` and is injected at runtime, so it adds nothing to the
app's URL budget.

Data already stored in a Claude account stays there, so a sideloaded artifact starts empty.

### Compared with publishing the artifact on claude.ai

Publishing on claude.ai takes one click and is the better option for showing someone a demo.
The differences that are structural rather than subject to product change:

| | Published on claude.ai | sideload |
|---|---|---|
| Where saved data lives | Anthropic's servers | the viewer's own browser |
| Who controls hosting | Anthropic | the publishing GitHub account |
| What a viewer needs | depends on sharing settings | the link |

## Security model

The intended use is running code you wrote or have read, on an origin you control.

**Links from anyone else do not execute.** The engine verifies the ECDSA signature against
the compiled-in public key before it decompresses or renders the fragment, so a link built
on another instance, or altered in transit, is rejected before any code runs. A fork is
harmless in both directions, because each instance holds its own key.

**Payloads are encoded, not encrypted.** gzip and base64url hide nothing, so anyone holding
a link can decode the fragment, read the HTML, modify it and run it elsewhere. What they
cannot do is run a modified version on your origin. Do not put API keys or secrets in an app
you intend to share.

**Apps on one instance are not isolated from each other.** The `localStorage` proxy prefixes
keys to avoid accidental collisions between your own apps, not to stop deliberate access.
Every app runs on the same origin, so app code can get past the proxy in a single line. The
proxy is installed as a configurable own property on `window` while the native accessor sits
on `Window.prototype`, so `delete window.localStorage` brings the original back, and
appending a same-origin iframe and reading `frame.contentWindow.localStorage` has the same
effect.

That reaches every app's stored data, and the signing private key as well, which is held as
a plain string in `localStorage`. So the rule to work by is that you publish only HTML you
have read. If you break it, the immediate cost is that one app can read what your other apps
saved, and the larger cost is that a key which leaves your device lets whoever has it publish
to your origin indefinitely, including to people you have sent links to. Recovering from that
means generating a new key, editing `index.html`, pushing, republishing every app, and losing
every home-screen icon you have.

Two practical consequences:

- Host the instance on a GitHub account that serves nothing sensitive. One `github.io` origin
  covers every repository on the account, so any page hosted there can read this storage.
- Putting the compiler and the runner on different origins would keep the key on an origin
  that never runs app code. That is the right fix if an instance stops being single-user. It
  costs one extra deploy at setup and no per-app deploy.

## Reference

```
index.html              the engine: compiler, runner, signing, storage proxy, launcher
sw.js                   service worker; caches the engine for offline use
icon.png                fallback apple-touch-icon
tools/keygen.mjs        generate an ECDSA P-256 keypair from the command line
samples/
  storage-probe.html    writes generic storage keys; two copies show apps stay separate
test/run.mjs            headless test suite
test/mklinks.mjs        dev helper: short redirect stubs, so a 20,000-character URL is
                        tappable on a phone
```

`index.html` is plain ES5 with no build step, and it opens with a map of its nine sections.
The lack of tooling is deliberate, because the file is the thing being published, it has to
run on whatever Safari version is on the phone, and the whole trust boundary should be
readable in one sitting.

### Tests

```sh
node test/run.mjs                              # bundled samples only
node test/run.mjs ~/Downloads/some-app.html    # plus the files you name
```

The suite covers round-trip fidelity through the codec, signature verification and each way
of tampering with a payload, `localStorage` namespace separation, conformance of the
`window.claude` stand-in, and the URL budget. Any file you name on the command line is also
checked for byte fidelity and size. The service worker runs in a sandbox with a fake cache,
a fake network and a timer fired by hand, so the network-first path, the offline fallback
and the stall race are exercised rather than assumed.

Anything involving the home screen, or a real browser cache, has to be tested on a phone.

### iOS specifics

`apple-mobile-web-app-capable`, the status bar style and a fallback `apple-touch-icon` are
static in `index.html`, because iOS reads them when the bookmark is saved and every app is
the same document with a different fragment, so one set of tags covers all of them. The
title, `apple-mobile-web-app-title` and a generated icon are set at runtime so each app gets
its own label and tile. There is deliberately no `<link rel="manifest">`, because a
manifest's `start_url` would strip the fragment and launch the empty compiler instead of the
app.

### Troubleshooting

- **"This site has no signing key"** means `PUBLIC_KEY` is still empty in `index.html`. See
  setup step 3.
- **"This key does not match your site"** means the private key in the browser does not
  correspond to the committed `PUBLIC_KEY`. This is common when forking without doing step 3.
- **"Refused: this link is not signed by your key"** means the link was signed by a different
  key, or altered after signing.
- **"This link looks cut short"** means signature verification failed on a link near the
  budget, which is what truncation looks like. Something shortened it in transit.
- **"Insecure context"** means Web Crypto is unavailable. Use `https://` or `localhost`
  rather than a `file://` path.
- **A blank screen with no error** usually means a CDN script in the app failed to load.
  Check the compiler's external-host warning.
- **An engine change has not reached a device.** The worker asks the network first, so a
  reload while online should pick it up. Bumping `CACHE` in `sw.js` makes every device
  discard the old cache on its next visit.
