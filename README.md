# sideload

`sideload` runs single-file HTML apps from a URL. The app's entire source lives in the URL
fragment, so publishing one means pasting HTML into a page and saving the resulting link —
no repo change, commit or deploy per app.

## Why it exists

LLMs are good at producing small self-contained HTML tools: a calculator, a tracker, a
checklist, a few hundred lines of HTML, CSS and JavaScript using `localStorage` for state.
On a desktop such a file can be opened directly from disk. On iOS it cannot — Safari has no
way to open a local `.html` file and run it as a web page — so getting one onto the home
screen normally means committing it to a repository and deploying it to a host. That is a
disproportionate amount of work for one file, and it needs a computer.

`sideload` removes the per-app deploy by putting the app in the URL rather than on a server.
The engine is deployed once to GitHub Pages; after that, pasting HTML into it produces a
signed link containing the app:

```
you.github.io/sideload/#2-SXg9kR7mQw…jTn.H4sIAAAAAAAA…
                        │ │              └ the app, gzipped then base64url-encoded
                        │ └ ECDSA P-256 signature over those bytes
                        └ payload format version
```

Everything after `#` is the URL **fragment**. Browsers do not send fragments in HTTP
requests, so GitHub Pages serves `index.html` without ever seeing the payload.

`index.html` is both the compiler and the runtime:

- **without a fragment** it shows the compiler, where HTML is pasted and signed;
- **with a fragment** it verifies the signature against the hardcoded public key,
  decompresses the payload, and runs the app.

iOS **Add to Home Screen** saves the complete URL, fragment included, so each app becomes
its own icon with its own title and its own persistent storage.

---

## How it works

### Rendering with `document.write` rather than a `data:` iframe

[itty.bitty.site](https://github.com/arfct/itty-bitty) has been storing pages in URL
fragments since 2018. It renders them by passing the decoded HTML to an iframe as a
`data:text/html` URL. That is fine for static documents, but a `data:` URL executes in an
**opaque origin**, where `localStorage` does not return empty — it throws `SecurityError`.
Every app that saves anything fails on its first write. Sandboxed iframes behave the same
way unless `allow-same-origin` is set, which defeats the sandbox, because framed script can
remove its own `sandbox` attribute.

`sideload` therefore writes the decoded HTML into the top-level document with
`document.write`. Replacing the document in place has three effects:

1. **The origin is preserved** (`https://<you>.github.io`), so `localStorage` works.
2. **The URL is preserved**, so Add to Home Screen captures the fragment.
3. **The app gets the top-level viewport**, which avoids an iOS Safari behaviour where
   dragging an `<input type="range">` inside an iframe scrolls the outer page instead of
   moving the slider.

Before the app's own scripts run, the engine injects a prelude as the first script in the
written document. The prelude replaces `window.localStorage` with a proxy that prefixes
every key with the app's data name, so two apps on one instance can both use a key called
`data` without colliding.

### Signing, because the origin is shared

`document.write` runs the fragment on the real origin with full access to `localStorage`.
Without verification, anyone could construct a link to that origin containing arbitrary
JavaScript, and it would execute with access to everything the instance's apps had saved.

Every payload is therefore signed with an **ECDSA P-256** private key, and the corresponding
public key is hardcoded in `index.html`. The engine verifies the signature *before*
decompressing or rendering anything, so an unsigned or altered link never executes and there
is no warning to dismiss. Signing is what makes a single shared origin viable, which in turn
is what keeps publishing free of a deploy step.

### Why not isolate each app on its own origin

Browser storage isolation requires a separate origin per app. In practice two of these three
properties are available at once:

| Approach | No deploy per app | Isolated origin per app | Free |
|---|---|---|---|
| **Single origin, signed payloads** (this) | Yes | No | Yes |
| One hostname per app | No | Yes | Yes |
| Wildcard DNS (`*.example.com`) | Yes | Yes | No |

A hostname per app requires a deploy per app, at which point the server already holds the
HTML and the fragment is doing no work — that is ordinary static hosting. Wildcard DNS gives
arbitrary subdomains without deploys but is not available free: GitHub Pages cannot issue a
wildcard certificate, because its certificates cover one custom domain exactly as specified;
Cloudflare serves proxied wildcard records on Enterprise plans; Netlify wildcard subdomains
start at Pro. The cheapest version that actually works is a small VPS with a DNS-01 wildcard
certificate, around $70 a year.

### Offline

The app payload needs no network, since it travels in the link. The engine that unpacks it
does, so `sw.js` caches it in a service worker.

There is exactly one response to cache, which is what makes this simple. Because the
fragment is not part of the request, every app ever published arrives as the same `GET` for
the same page — one cached response covers all of them, including apps published later. The
worker knows nothing about apps. This is unrelated to the reason there is no manifest: a
manifest's `start_url` would drop the fragment, whereas a service worker never touches
navigation targets, only responses.

The worker is network-first rather than cache-first. Serving the cache unconditionally would
stop a pushed fix reaching a device, and a cached engine still holding an old `PUBLIC_KEY`
would refuse links signed with a new one. So it requests the network, falls back to the
cache, and races a 2.5-second timer so a stalled connection does not produce a blank page. A
late response still refreshes the cache for the next launch.

---

## Setup

Done once, on a computer, because step 3 requires a commit. After that, apps can be
published from a phone.

### 1. Deploy an instance

Fork this repository. Under **Settings → Pages**, set **Source** to `Deploy from a branch`
(GitHub defaults to "GitHub Actions") and **Branch** to `main`, folder `/ (root)`. The
instance goes live at `https://<you>.github.io/sideload/`, usually within a minute or two.

It refuses to run anything until a public key is configured.

### 2. Generate a keypair

Open the deployed URL and tap **Create key**. The browser generates an ECDSA P-256 keypair
locally and shows both halves.

- **Private key** — signs and publishes apps to the instance. It cannot be recovered, so
  save it to a password manager before closing the page.
- **Public key** — committed into `index.html` so the instance can verify links.

`node tools/keygen.mjs` does the same thing from a terminal. The browser is preferable,
because a terminal leaves the private key in shell history and scrollback.

### 3. Commit the public key

Replace the empty declaration near the top of `index.html` with the line the compiler
displays:

```js
/* INSTANCE PUBLIC KEY  --  replace this with your own. See the README. */
var PUBLIC_KEY = 'BG9x...your key...';
```

Commit and push. Once Pages has redeployed, reloading the compiler should report **Ready to
publish**.

### 4. Import the private key on each publishing device

Open the instance on the phone, tap **Import key**, and paste the private key from the
password manager. Repeat on any other device that should be able to publish. Devices that
only *run* the apps need nothing.

---

## Usage

**Publishing.** Paste HTML into the compiler. The app name is taken from the `<title>` tag,
and a data name — the `localStorage` prefix — is derived from it. Check the size meter, tap
**Open app**, then **Share → Add to Home Screen**.

**Updating.** Paste the new HTML and keep the **same data name**, which is what reattaches
the new build to the existing storage keys. Because the source lives in the URL, new code
necessarily means a new URL, so the old home-screen icon still points at the old version:
delete it and add the new link.

**Sharing an app.** The recipient needs nothing. Their browser fetches the engine from the
publishing instance, verifies the signature against its public key, and runs the app
locally. Their data stays in their own browser. The private key is not involved and does not
travel: `localStorage` is per-origin *and* per-device, and is never sent over the network.

Links run to tens of thousands of characters, past QR code capacity and past what some chat
clients will carry intact. AirDrop, Messages, email and notes handle them.

**Sharing the tool.** Anyone who wants to publish their own apps forks the repository and
generates their own keypair. Each instance trusts only its own public key, so two instances
cannot publish to each other.

---

## Limitations

**URL length budget: 64,000 characters.** Neither the URI specification nor the WHATWG URL
Standard defines a maximum URL length. The 8,000-octet figure commonly cited is RFC 7230's
recommended floor for an HTTP *request line*, which does not apply here because the fragment
is never sent. Chromium documents a 2 MB cap of its own; Apple publishes no figure for
Safari. The binding constraint is how long a URL iOS retains in a home-screen bookmark,
which is undocumented. 64,000 is therefore a conservative chosen ceiling, not a measured
one; the only measurement behind it is that a link of roughly 21,000 characters has survived
Add to Home Screen on an iPhone.

A truncated link fails signature verification, because truncation changes the bytes. The
engine reports it as a cut-short link rather than rendering a broken page.

**Compression.** Payloads are gzipped and then base64url-encoded, which adds a third back,
so the useful figure is HTML bytes per URL character rather than the gzip ratio alone.
Measured on the HTML in this repository:

| File | Raw | Gzipped | Ratio |
|---|---|---|---|
| `index.html` | 74,325 B | 24,890 B | 2.99× |
| `samples/storage-probe.html` | 5,235 B | 2,203 B | 2.38× |
| a 53 KB app | 54,243 B | 15,580 B | 3.48× |

That 53 KB file produces a 21,411-character URL, about a third of the budget. At these
ratios the ceiling corresponds to roughly 140–170 KB of HTML, but three files are not a
distribution — the compiler measures the actual file before publishing, and that is the
number to use. Inline base64 images will exceed the budget on their own.

**Offline is likely, not guaranteed.** With the engine cached, an app that fetches nothing
external opens without a connection. However, iOS clears storage for sites it considers
idle, home-screen apps fare better than tabs but have no guarantee, and the first load on a
new device must come from the network.

**Browser requirements.** `CompressionStream` (Safari 16.4+, Chrome 80+, Firefox 113+) and
Web Crypto, which browsers expose only in a secure context — `https://` or `localhost`, not
`file://`.

**External resources.** CDN scripts, stylesheets and remote fonts load normally but add a
network dependency on every open. The compiler scans pasted HTML, lists the external hosts
it finds, and distinguishes a stylesheet (the app runs, looks wrong) from a script (the app
usually does not run).

**Storage eviction.** WebKit deletes script-writable storage after seven days without user
interaction for ordinary browser tabs, and exempts web apps added to the home screen. Use
**Export all app data** to back up anything that matters. That export contains app data and
deliberately excludes the private key, which belongs in a password manager.

---

## Running Claude artifacts

Single-file artifacts from Claude can be pasted and published as they are.

Artifacts that persist state call `window.claude`, which exists only on claude.ai. The
engine injects a local stand-in backed by the app's namespaced `localStorage`, built against
the published runtime contract (0.2.96).

- **Implemented in full:** `db` — documents, collections, `where`/`orderBy`/`limit` queries,
  `onSnapshot` subscriptions, generated ids and document leases — and `user`, which reports
  the viewer as the owner of the app.
- **Not implemented:** `room`, `sample`, `artifact`, `assets`, `downloads`, `files`, `mcp`,
  `comments`. This is deliberate rather than unfinished. The contract has `claude.use(name)`
  resolve `null` for anything unavailable in a given view, and artifacts are written to
  branch on that, so an app wanting one of these degrades as its author intended. A
  half-implemented namespace would be worse than an absent one, since an object with missing
  methods has no defined handling and simply throws.

The stand-in is part of `index.html` and is injected at runtime, so it adds nothing to the
app's URL budget.

Data already stored in a Claude account stays there; a sideloaded artifact starts empty.

### Compared with publishing the artifact on claude.ai

Publishing on claude.ai takes one click and is the better option for showing someone a demo.
The differences that are structural rather than subject to product change:

| | Published on claude.ai | sideload |
|---|---|---|
| Where saved data lives | Anthropic's servers | the viewer's own browser |
| Who controls hosting | Anthropic | the publishing GitHub account |
| What a viewer needs | depends on sharing settings | the link |

---

## Security model

The intended use is running code that the instance's owner wrote or has read, on an origin
they control.

**1. Links from anyone else cannot execute.** The engine verifies the ECDSA signature
against the hardcoded public key before decompressing or rendering the fragment. Links built
on another instance, or altered in transit, are rejected before any code runs. A fork is
therefore harmless in both directions: each instance holds its own key.

**2. Payloads are encoded, not encrypted.** gzip and base64url hide nothing. Anyone holding
a link can decode the fragment and read the HTML, modify it, and run it elsewhere — they
just cannot run a modified version on the original origin. Do not put API keys or secrets in
an app that will be shared.

**3. Apps on one instance are not isolated from each other.** The `localStorage` proxy
prefixes keys to prevent accidental collisions, not deliberate access. All apps run on the
same origin, so app script can bypass the proxy: it is installed as a configurable own
property on `window` while the native accessor lives on `Window.prototype`, so
`delete window.localStorage` restores it, and reading `frame.contentWindow.localStorage`
from a same-origin iframe does the same. Either is one line.

That reaches every app's stored data, and also **the signing private key**, which is held as
a plain string in `localStorage`. The operative rule is therefore to publish only HTML that
has been read. The first-order cost of breaking it is that one app can read what the others
saved; the second-order cost is larger, because a key that leaves the device lets whoever
holds it publish to that origin indefinitely, including to people who have been sent links,
and recovery means a new key, an edited `index.html`, a push, republishing every app, and
every existing home-screen icon breaking.

Two practical consequences:

- Host the instance on a GitHub account that serves nothing sensitive. One `github.io`
  origin covers every repository on the account, so any page hosted there can read this
  storage.
- Separating the compiler and the runner onto different origins would put the key on an
  origin that never runs app code. That is the right fix if an instance ever stops being
  single-user; it costs an extra one-time deploy and no per-app deploy.

---

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

`index.html` is plain ES5 with no build step, and opens with a map of its nine sections. The
lack of tooling is deliberate: the file is the thing being published, it has to run on
whatever Safari version is on the phone, and the whole trust boundary should be readable in
one sitting.

### Tests

```sh
node test/run.mjs                              # bundled samples only
node test/run.mjs ~/Downloads/some-app.html    # plus specified files
```

Covers lossless round-trip through the codec, signature verification and every tampering
case, `localStorage` namespace separation, `window.claude` stand-in conformance, and the URL
budget. Each file passed in is additionally checked for byte fidelity and size. The service
worker is driven in a sandbox with a fake cache, a fake network and a hand-fired timer, so
the network-first path, the offline fallback and the stall race are exercised rather than
assumed.

Anything involving the home screen, or a real browser cache, has to be tested on a phone.

### iOS specifics

`apple-mobile-web-app-capable`, the status bar style and a fallback `apple-touch-icon` are
static in `index.html`, because iOS reads them when the bookmark is saved and every app is
the same document with a different fragment — one set of tags covers all of them. The title,
`apple-mobile-web-app-title` and a generated icon are set at runtime so each app gets its
own label and tile. `<link rel="manifest">` is deliberately omitted: a manifest's
`start_url` would strip the fragment and launch the empty compiler instead of the app.

### Troubleshooting

- **"This site has no signing key"** — `PUBLIC_KEY` is still empty in `index.html`; see
  setup step 3.
- **"This key does not match your site"** — the imported private key does not correspond to
  the committed `PUBLIC_KEY`. Common when forking without doing step 3.
- **"Refused: this link is not signed by your key"** — the link was signed by a different
  key, or altered after signing.
- **"This link looks cut short"** — signature verification failed on a link near the budget,
  which is what truncation looks like. Something shortened it in transit.
- **"Insecure context"** — Web Crypto requires `https://` or `localhost`, not `file://`.
- **Blank screen, no error** — check the compiler's external-host warning. A CDN script that
  fails to load usually halts the app.
- **An engine change has not reached a device** — the worker is network-first, so a reload
  while online should pick it up. Bumping `CACHE` in `sw.js` forces every device to discard
  the old cache on its next visit.
