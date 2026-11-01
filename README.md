# sideload

`sideload` runs single-file HTML apps from a URL. It stores the app's source in the URL fragment. To publish an app, you paste its HTML into the compiler and save the signed link it generates.

The engine is deployed once to GitHub Pages. Individual apps need no deployment.

## Why it exists

LLMs can generate small, self-contained HTML tools: calculators, trackers and checklists, usually a few hundred lines of HTML, CSS and JavaScript with state in `localStorage`.

On a desktop, these files run directly from disk. On iOS, Safari will not open a local `.html` file as a web page. Getting one onto the home screen usually requires committing it to a repository and deploying it to a host, which adds several steps and requires a computer.

sideload stores the app in a signed URL:

```text
you.github.io/sideload/#2-SXg9kR7mQw…jTn.H4sIAAAAAAAA…
                        │ │              └ the app, gzipped then base64url-encoded
                        │ └ ECDSA P-256 signature over those bytes
                        └ payload format version
```

Browsers do not send URL fragments in HTTP requests, so GitHub Pages serves `index.html` without seeing the payload.

`index.html` is both the compiler and the runtime:

- With no fragment, it shows the compiler, where you paste HTML and sign it.
- With a fragment, it verifies the signature against its compiled-in public key, decompresses the payload and runs the app.

iOS Add to Home Screen saves the whole URL, including the fragment. Each app gets its own icon, title and storage namespace.

## How it works

### Rendering and storage

[itty.bitty.site](https://github.com/arfct/itty-bitty) has stored pages in URL fragments since 2018. It decodes the fragment and passes the HTML to an iframe as a `data:text/html` URL.

A `data:` URL works for static documents, but runs in an opaque origin. Accessing `localStorage` throws a `SecurityError`, so apps that use it cannot save data. A sandboxed iframe has the same restriction unless it has `allow-same-origin`. Adding that permission removes the protection because script inside the frame can delete its own `sandbox` attribute.

sideload writes the decoded HTML into the top-level document with `document.write`. This preserves:

- The origin, `https://<you>.github.io`, so `localStorage` works normally.
- The URL, so Add to Home Screen captures the fragment.
- The top-level viewport. On iOS, dragging an `<input type="range">` inside an iframe scrolls the page instead of moving the slider.

The engine injects a prelude as the first script in the written document, before any app code runs. The prelude replaces `window.localStorage` with a proxy that prefixes every key with the app's data name. Two apps can both use a key called `data` without accidentally overwriting each other.

These prefixes provide namespacing only. The security implications of sharing an origin are covered below.

### Origin tradeoffs

Browser storage isolation requires one origin per app. Of these three properties, an instance can have two:

| Approach | No deploy per app | Isolated origin per app | Free |
|---|---|---|---|
| **Single origin, signed payloads** (this) | Yes | No | Yes |
| One hostname per app | No | Yes | Yes |
| Wildcard DNS (`*.example.com`) | Yes | Yes | No |

One hostname per app requires one deployment per app. The server already holds the HTML in that arrangement, so ordinary static hosting handles it without a fragment payload.

Wildcard DNS provides arbitrary subdomains without per-app deployments, but has a cost. GitHub Pages cannot issue a wildcard certificate; its certificates cover one custom domain exactly as written. Cloudflare proxies wildcard records on Enterprise plans only, and Netlify starts wildcard subdomains at Pro. The cheapest arrangement that works is a small VPS with a DNS-01 wildcard certificate, at roughly $70 a year.

### Offline loading

The payload arrives in the link and needs no network access. The engine must be fetched, so `sw.js` caches it in a service worker.

Every app produces the same `GET` request for the same page because the fragment is excluded from the request. One cached response covers all apps, including apps published later. The worker does not need to track individual apps.

The worker tries the network first and falls back to the cache. Cache-first loading would prevent pushed fixes from reaching a device. It could also leave a cached engine with an old `PUBLIC_KEY`, causing it to reject links signed with a new key.

A 2.5 second timer runs alongside the request so a stalled connection does not leave a blank page. A response that arrives after the timer still updates the cache for the next load.

With the engine cached, an app that fetches no external resources can open offline. The first load on a new device requires the network. iOS storage eviction can also remove cached resources; see [Storage eviction](#storage-eviction).

### iOS home-screen support

`apple-mobile-web-app-capable`, the status bar style and a fallback `apple-touch-icon` are static in `index.html`. iOS reads them when saving the bookmark, and one set of tags covers every app because each uses the same document with a different fragment.

The title, `apple-mobile-web-app-title` and a generated icon are set at runtime to give each app its own label and tile.

There is no `<link rel="manifest">`: a manifest's `start_url` would strip the fragment and launch the empty compiler. The service worker preserves this behavior because it only controls the response to a request.

## Security model

The intended use is running code you wrote or have read, on an origin you control.

### Signed payloads

`document.write` runs app code on the engine's origin with full access to its `localStorage`. Accepting arbitrary fragments would let anyone construct a link containing JavaScript that could read data stored by the instance's apps.

Each payload is signed with an ECDSA P-256 private key. The matching public key is compiled into `index.html`. The engine verifies the signature before decompressing or rendering the payload. Links signed with another key or altered after signing are rejected before any app code runs, with no prompt to override the check.

Each instance trusts its own public key. A fork with its own key cannot publish executable links to the original instance, and the original cannot publish to the fork. This signature check allows the instance to accept links while keeping all apps on one origin.

### Payload visibility

gzip and base64url provide no encryption. Anyone holding a link can decode the fragment, read the HTML, modify it and run it elsewhere. They cannot run a modified payload on your origin without a valid signature.

Do not put API keys or secrets in an app you intend to share.

### Shared-origin access

All apps on an instance share one origin and one underlying `localStorage`. The key prefixes prevent accidental collisions but provide no security boundary.

App code can reach the real `localStorage` in one line:

- `delete window.localStorage` exposes the native accessor on `Window.prototype`.
- A same-origin iframe also provides access to the real storage.

An app you publish can therefore read data saved by your other apps. It can also read your signing key, which is stored as a plain string. Publish only HTML you have read.

If a key is exposed, generate a new keypair and commit the new public key. Existing apps must then be republished with the new key.

Anything else served from `you.github.io` shares the same origin. GitHub Pages gives each account one host and separates repositories by path. Other pages on that host matter if they store valuable data in `localStorage`, such as an API token.

## Setup

Setup is done once on a computer because step 3 requires a commit. After that, you can publish from a phone.

### 1. Deploy an instance

Fork this repository. Under **Settings → Pages**, set:

- **Source:** `Deploy from a branch` (GitHub defaults to "GitHub Actions").
- **Branch:** `main`.
- **Folder:** `/ (root)`.

The instance goes live at `https://<you>.github.io/sideload/`, usually within a minute or two. It refuses to run apps until a public key is configured.

### 2. Generate a keypair

Open the deployed URL and tap **Create key**. The browser generates an ECDSA P-256 keypair locally and shows both halves.

The private key signs apps for your instance. It cannot be recovered, so save it to a password manager before closing the page. The public key goes into `index.html` to verify your links.

`node tools/keygen.mjs` generates a keypair from a terminal. The browser is preferable because a terminal leaves the private key in shell history and scrollback.

### 3. Commit the public key

Replace the empty declaration near the top of `index.html` with the line the compiler shows:

```js
/* INSTANCE PUBLIC KEY  --  replace this with your own. See the README. */
var PUBLIC_KEY = 'BG9x...your key...';
```

Commit and push. Once Pages has redeployed, reload the compiler. It should report **Ready to publish**.

### 4. Import the private key on each publishing device

Open the instance on your phone, tap **Import key**, and paste the private key from your password manager. Repeat on each device you want to publish from.

Devices that only run apps need no key.

## Usage

### Publish an app

Paste HTML into the compiler. The app name comes from the `<title>` tag. The compiler derives a data name from it, which becomes the app's `localStorage` prefix.

Check the size meter, tap **Open app**, then **Share → Add to Home Screen**.

### Update an app

Paste the new HTML and keep the same data name to reuse the existing storage keys.

New code produces a new URL. The old home-screen icon still points to the old version, so delete it and add the new link.

### Share an app

Send the link. The recipient needs no setup: their browser fetches the engine from your instance and runs the app locally after verification.

Their app data stays in their own browser. `localStorage` is scoped per origin and per device and is never sent over the network. Your private key is not needed to open the link and does not travel with it.

Links can be tens of thousands of characters long, exceeding QR code capacity and the limits of some chat clients. AirDrop, Messages, email and notes handle them.

### Share the tool

Anyone who wants to publish their own apps forks the repository and generates their own keypair.

## Limitations

### URL length budget: 64,000 characters

The compiler allows URLs up to 64,000 characters. This is a conservative budget; testing has only confirmed that a roughly 21,000-character link survives Add to Home Screen on an iPhone. Apple does not document how much of a URL a home-screen bookmark preserves.

Neither the URI specification nor the WHATWG URL Standard sets a maximum length. Chromium documents a 2 MB cap; Apple publishes no Safari limit. RFC 7230's often-quoted 8,000-octet figure is a recommended minimum for HTTP request lines and does not apply to fragments, which browsers never send.

If a link gets truncated, signature verification fails and the engine displays an error instead of running the app.

### Compression

Payloads are gzipped and then base64url-encoded. Base64url adds back about a third, so the useful measure is HTML bytes per URL character.

Measurements from the HTML in this repository:

| File | Raw | Gzipped | Ratio |
|---|---|---|---|
| `index.html` | 74,325 B | 24,890 B | 2.99x |
| `samples/storage-probe.html` | 5,235 B | 2,203 B | 2.38x |
| a 53 KB app | 54,243 B | 15,580 B | 3.48x |

The 53 KB file produces a 21,411-character URL, about a third of the budget. At these ratios, the ceiling is approximately 140 to 170 KB of HTML. Three files are too small a sample to establish a distribution; use the compiler's measurement for each app.

Inline base64 images will exceed the budget on their own.

### Browser requirements

The engine requires `CompressionStream`: Safari 16.4, Chrome 80 or Firefox 113 and later.

Signature verification uses Web Crypto, which browsers expose only in a secure context. Serve the page over `https://` or from `localhost`. A `file://` path will not work.

### External resources

CDN scripts, stylesheets and remote fonts load normally, but add a network dependency every time the app opens.

The compiler scans pasted HTML and lists the external hosts it finds. It distinguishes stylesheets, whose failure usually leaves the app functional but incorrectly styled, from scripts, whose failure usually stops the app from running.

### Storage eviction

WebKit deletes script-writable storage after seven days without user interaction in ordinary browser tabs. Home-screen web apps are exempt from that rule, but iOS can still evict their storage, so offline access and saved data are not guaranteed.

Use **Export all app data** for anything that matters. The export includes app data but excludes the private key, which belongs in a password manager.

## Running Claude artifacts

Single-file artifacts from Claude can be pasted and published as they are.

Artifacts that persist state call `window.claude`, which normally exists only on claude.ai. The engine injects a local stand-in backed by the app's namespaced `localStorage`, implemented against published runtime contract 0.2.96.

The stand-in fully implements:

- `db`: documents, collections, `where`, `orderBy` and `limit` queries, `onSnapshot` subscriptions, generated ids and document leases.
- `user`: reports the viewer as the app's owner.

`room`, `sample`, `artifact`, `assets`, `downloads`, `files`, `mcp` and `comments` are intentionally unimplemented. The contract specifies that `claude.use(name)` resolves to `null` for a namespace unavailable in a given view. Artifacts branch on that result and can degrade as their authors intended. Returning a partial namespace would expose missing methods with no defined handling, causing exceptions.

The stand-in lives in `index.html` and is injected at runtime, so it adds nothing to the app's URL budget.

Data stored in a Claude account stays there. A sideloaded artifact starts empty.

### Comparison with publishing on claude.ai

Publishing on claude.ai takes one click and is the better option for showing someone a demo. The following differences are structural:

| | Published on claude.ai | sideload |
|---|---|---|
| Where saved data lives | Anthropic's servers | the viewer's own browser |
| Who controls hosting | Anthropic | the publishing GitHub account |
| What a viewer needs | depends on sharing settings | the link |

## Reference

```text
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

`index.html` is plain ES5 with no build step. It begins with a map of its nine sections. The file is the deployed artifact and must run on the phone's Safari version. Keeping it self-contained also makes the full trust boundary readable in one sitting.

### Tests

```sh
node test/run.mjs                              # bundled samples only
node test/run.mjs ~/Downloads/some-app.html    # plus the files you name
```

The suite covers:

- Round-trip fidelity through the codec.
- Signature verification and each way of tampering with a payload.
- `localStorage` namespace separation.
- Conformance of the `window.claude` stand-in.
- The URL budget.

Files named on the command line are also checked for byte fidelity and size.

The service worker runs in a sandbox with a fake cache, a fake network and a manually fired timer. Tests exercise the network-first path, offline fallback and stall race.

Home-screen behavior and real browser caches require testing on a phone.

### Troubleshooting

- **"This site has no signing key"** means `PUBLIC_KEY` is still empty in `index.html`. See setup step 3.
- **"This key does not match your site"** means the private key in the browser does not correspond to the committed `PUBLIC_KEY`. This is common when forking without completing step 3.
- **"Refused: this link is not signed by your key"** means the link was signed by a different key or altered after signing.
- **"This link looks cut short"** means signature verification failed on a link near the budget. Something shortened it in transit.
- **"Insecure context"** means Web Crypto is unavailable. Use `https://` or `localhost`; a `file://` path will not work.
- **A blank screen with no error** usually means a CDN script in the app failed to load. Check the compiler's external-host warning.
- **An engine change has not reached a device.** The worker tries the network first, so reloading while online should pick it up. Bumping `CACHE` in `sw.js` makes every device discard the old cache on its next visit.
