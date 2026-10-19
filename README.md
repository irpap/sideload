# sideload

Run a single-file HTML app straight out of a URL fragment. One static page, no backend,
no build step, no deploy per app.

On iOS you cannot open a local `.html` file and have it run. So every throwaway utility an
AI generates for you — a budget planner, a mortgage calculator, a trip itinerary — needs a
full deploy before it can live on your home screen. That is a lot of ceremony for one file,
and it needs a laptop.

sideload takes the deploy step out. Paste the HTML, get a link that **is** the app. Open it
in Safari, Add to Home Screen, and it runs borderless and offline with its own icon and name.
The whole flow works from the phone — no git, no account, no laptop.

```
your.github.io/sideload/#1-H4sIAAAA…      <- the app's entire source lives here
```

The fragment after `#` is never sent to a server. Your code and all of its data stay on
your device.

## Use it

1. Open the page on a laptop or phone.
2. Paste your HTML (or drop a `.html` file).
3. Name it — the name becomes the home-screen icon label.
4. **Open app**, then on iPhone: Share → **Add to Home Screen**.

The **storage key** shown under the name is what your saved data is filed under. Keep it
stable and you can regenerate the app as often as you like without losing anything.

## How it works

| Step | Mechanism |
|---|---|
| Compress | `CompressionStream('gzip')` — native, no library |
| Encode | base64url, so nothing needs escaping in a fragment |
| Transport | the URL fragment — never leaves the browser |
| Run | a **same-origin** `srcdoc` iframe at `100vw`/`100dvh` |
| Isolate | a `Proxy` over `localStorage` that namespaces every key per app |

### Why a same-origin iframe, and not a sandbox

This is the whole design, so it is worth being precise.

A document loaded from a `data:` URL, or inside an iframe with a `sandbox` attribute that
omits `allow-same-origin`, gets an **opaque origin**. Browsers key storage to an origin, and
an opaque origin owns no storage bucket — so `localStorage`, `sessionStorage` and
`document.cookie` all throw `SecurityError` *on access*. Not an empty result: an exception.
Any app whose point is saved state is dead on arrival.

That is a hard platform rule with no workaround. So sideload does the opposite: a `srcdoc`
iframe with no sandbox attribute, which **inherits this page's origin**. Storage simply works.

The cost is that every app shares one origin, so they would collide on generic keys like
`data`. That is a tractable problem, and the storage shim solves it: keys are transparently
prefixed with `__sideload__<slug>:`, and `clear()`, `length`, `key(i)` and enumeration are
all scoped so one app can neither read, enumerate, nor wipe another's data by accident.

### Trust model — read this one

Because apps share an origin, the isolation here prevents **accidents, not attacks**. A
pasted app technically can reach other apps' raw keys and the parent page. `allow-scripts`
plus `allow-same-origin` would not help even if set — a frame in that configuration can
rewrite its own `sandbox` attribute and escape.

So: paste code you wrote, or that you asked an AI to write for you. **Do not paste HTML a
stranger sent you.** A correct small trust model beats a confident wrong one.

## Limits

- **~64,000 URL characters**, which is roughly 150–200 KB of HTML after compression. Plain
  markup, CSS and JS compress about 4×. A single embedded base64 image will blow the budget;
  the compiler's meter tells you before you find out the hard way.
- **iOS 16.4+ / Safari 16.4+** for `CompressionStream`. Any current Chrome or Firefox is fine.
- **External resources work online, not offline.** CDN scripts, webfonts and remote images
  still load — but they break the offline promise. The compiler lists every external host it
  finds so this is visible at compile time rather than discovered on a plane.
- **Links are too long to share.** Past QR capacity (~2,953 bytes) and past the linkification
  limits of most chat and mail clients. Treat a sideload link as yours, not as publishing.
- **Back your data up.** Home-screen web apps are exempt from WebKit's 7-day cap on
  script-writable storage, but an app you only ever open in a browser tab is not, and no
  `persist()` call changes that. Use **Export all app data**.

## Claude artifact runtime stand-in

Artifacts built on claude.ai can call `window.claude.use('db')` and `use('user')` for hosted
storage and identity. That API exists only inside claude.ai — anywhere else `window.claude`
is undefined and those apps silently fall back to local-only, or lose their sync feature.

sideload can supply a local stand-in (on by default, toggleable in the compiler) implementing
`db.doc(path)` with `.get()` / `.set()` / `.update()` / `.delete()`, and `user.id()`, backed
by the app's own namespaced storage. The app's sync code then works against the device.

**It does not migrate anything.** Data already saved in your Claude account stays there;
the stand-in starts empty.

## Notes on the iOS integration

- `apple-mobile-web-app-capable`, the status-bar style and a fallback `apple-touch-icon` are
  **static** in `index.html`. iOS reads them when you tap Add to Home Screen, and since every
  app is the same document with a different `#fragment`, static markup covers all of them.
- Per-app `document.title`, `apple-mobile-web-app-title` and a canvas-generated
  `apple-touch-icon` are injected at runtime, so each app gets its own label and a distinct
  colored tile.
- **There is deliberately no `<link rel="manifest">`.** A manifest's `start_url` would drop
  the fragment and launch the bare compiler instead of your app — actively worse than no
  manifest at all.

## Layout

```
index.html              the whole engine: compiler, runner, storage shim, launcher
icon.png                static apple-touch-icon fallback
samples/
  storage-probe.html    writes generic keys; two copies prove isolation
test/run.mjs            headless checks — codec, injection, shim, real artifacts
```

## Tests

```
node test/run.mjs                              # samples/ only
node test/run.mjs ~/Downloads/some-app.html    # plus your own artifacts
```

Covers payload round-trip fidelity (emoji, CJK, quotes, literal `</script>`, 200 KB inputs),
version rejection, prelude injection against five document shapes, storage namespacing and
cross-app isolation including `clear()` / `length` / `Object.keys` / property access, the
Claude stand-in, and byte-identical round-trip plus budget analysis for any real artifact
you point it at.

The rest needs a real device: URL survival through Add to Home Screen, whether iOS picks up
the injected title and icon, and standalone launch.

## Prior art

[itty.bitty.site](https://github.com/arfct/itty-bitty) has encoded pages into URL fragments
since 2018, with LZMA and better compression than this uses. It renders via
`iframe.src = "data:text/html;base64,…"`, which is exactly the opaque-origin trap above — fine
for sharing small documents, which is what it was built for, but it cannot run a stateful app.
sideload is narrower on purpose: one person's utilities, with storage that works.
