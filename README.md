# sideload

sideload runs a single-file HTML app from a URL. The app's entire source lives in the link,
so publishing one is a paste rather than a deploy, and you can do it from a phone.

## Why it exists

I kept asking Claude for small tools while away from home — an itinerary with the next
train on it, a budget planner. Claude writes you a complete, self-contained HTML file in
about twenty seconds, and then you cannot use it, because iOS will not run a local `.html`
file as a web page. Safari has no way to open one. To get it onto the home screen you have
to put it on the web, and putting it on the web means a repo, a commit, a deploy, and a
laptop you did not bring.

That overhead is absurd for one file, and it is the same overhead whether the file is a
mortgage calculator or a packing list. So sideload moves the file into the URL instead of
onto a server. You paste HTML into a page, it hands you a link, and the link is the app:

```
you.github.io/sideload/#2-SXg9kR7mQw…jTn.H4sIAAAAAAAA…
                        │ │           └ your app, gzipped and base64url-encoded
                        │ └ signature over those bytes
                        └ format version
```

Everything after the `#` is the URL **fragment**, and a fragment is not part of an HTTP
request — the browser keeps it and sends the rest. So GitHub serves you the page without
ever learning which app you opened. Add the link to your home screen and iOS keeps the
whole thing, fragment included, so the app comes back with its own name and icon.

## The three decisions that make it work

These are one chain, not three features, and the order matters.

**Apps need to remember things.** The obvious way to render HTML you have decoded is to
hand it to an iframe as a `data:` URL, which is what
[itty.bitty.site](https://github.com/arfct/itty-bitty) has done since 2018. The problem is
that a `data:` URL lands on an **opaque origin**, and on an opaque origin `localStorage`
does not return empty — it throws `SecurityError`. Every app that saves anything breaks on
the first write. That was no cost to itty-bitty, which exists to share documents, but it
rules out the entire category I wanted: tools that keep your numbers between visits.
Sandboxing an iframe without `allow-same-origin` has the same effect, and adding
`allow-same-origin` back buys no protection, because a frame can remove its own `sandbox`
attribute and escape.

So sideload renders with `document.write` into the live page instead. The app replaces the
engine in the document it is already in, which keeps the real origin — so storage works —
keeps the URL — so Add to Home Screen captures the fragment — and gives the app the real
viewport, which matters more than it sounds: inside an iframe, dragging an
`<input type=range>` sideways on iOS scrolls the page instead of moving the slider.

**That creates an exposure.** Once the fragment runs on your real origin with your real
storage, *anyone's* fragment would. Someone could send you a link to your own site with
their code in it, and it would run with access to everything your apps had saved. On a
shared origin that is not a hypothetical, it is the default.

**So apps are signed.** You hold an ECDSA P-256 private key; your public key is committed
into `index.html`. The engine verifies the signature *before* it decompresses or renders
anything, so a link that is not yours never runs at all and there is no warning to click
past. This is what makes a single origin safe enough to use, which in turn is what keeps
publishing free of a deploy.

### Why not just isolate each app instead

Isolation is the textbook answer: give every app its own origin and the browser separates
their storage for you. Three properties, and you can have two:

| | no deploy per app | isolated per app | free |
|---|---|---|---|
| one origin, signed payloads ← this | yes | no | yes |
| one hostname per app | no | yes | yes |
| wildcard DNS | yes | yes | no |

A hostname per app means deploying per app, and then the server already holds the HTML and
the fragment is doing no work — you have rebuilt ordinary static hosting and deleted the
reason the project exists. Wildcard DNS is the right answer and it costs money: Cloudflare
serves proxied wildcard records on Enterprise plans, Netlify wildcard subdomains start at
Pro, and GitHub Pages cannot issue a wildcard certificate at all, because its certificates
cover one custom domain exactly as specified. The cheapest honest version is a small VPS
with a DNS-01 wildcard certificate, around $70 a year.

Signing was the trade that let the free single-origin option stop being reckless.

---

## Setup

Once, and then you can publish from your phone indefinitely.

### 1. Deploy your own copy

Fork this repo. In **Settings → Pages**, set **Source** to `Deploy from a branch` — GitHub
defaults to "GitHub Actions", so this needs changing — and **Branch** to `main`, folder
`/ (root)`. Your copy goes live at `https://<you>.github.io/sideload/`, usually within a
minute or two.

It will refuse to run anything yet, because no key is set.

### 2. Create your key

Open your copy and tap **Create key**. Your browser generates the keypair locally and shows
you both halves.

The **private key** is the only thing that can publish to your site, and it cannot be
recovered. Put it in your password manager before you close the page. The **public key** is
meant to be published.

There is also `node tools/keygen.mjs` if you prefer a terminal, though the browser is the
better option: a terminal leaves your private key in shell history and scrollback.

### 3. Commit your public key

Replace the empty declaration near the top of `index.html` with the line the page shows
you:

```js
/* INSTANCE PUBLIC KEY  --  replace this with your own. See the README. */
var PUBLIC_KEY = 'BG9x...your key...';
```

Commit, push, wait for Pages to redeploy. Reloading the compiler should now say **Ready to
publish**.

### 4. Put the key on your phone

Open your copy on the phone, tap **Import key**, paste the private key from your password
manager. That device can now publish. Repeat for any other device you want to publish from;
devices that only *use* your apps need nothing at all.

Do this while you still have your password manager to hand, rather than when you first want
to publish something.

---

## Using it

**Publishing.** Paste HTML into the box. The app name fills in from the `<title>` tag and a
data name is derived from it. Check the size meter, tap **Open app**, then Share → **Add to
Home Screen**.

**Updating.** Paste the new HTML and keep the **same data name**. The data name is the
prefix your app's storage keys live under, so keeping it is what reattaches the new build to
what you already saved. The link itself changes — the app is inside it, so new code is
necessarily a new link — which means your old home-screen icon still points at the old
version. Delete it and add the new one. There is no way around that part.

**Sharing an app.** Send the link however you like; the recipient needs nothing from you.
Their browser fetches your engine from your site, checks your signature against the public
key baked into it, and runs the app. They can add it to their home screen too, and their
data stays in their own browser. Your private key is not involved and never leaves your
device — `localStorage` is per-origin *and* per-device, and never travels over the network.

Links run to tens of thousands of characters, which is well past what a QR code holds and
more than some chat apps will carry intact. AirDrop, Messages, email and notes are fine.

**Sharing the tool.** Send someone this repo. They set up their own copy with their own key,
and the two instances cannot publish to each other. That is why it is safe for many people
to use this at once: everybody runs only their own code, on their own origin.

---

## What it costs you

**A size ceiling, which is a guess.** The budget is 64,000 URL characters. No browser
documents a limit on URL length: the URI spec sets none, the WHATWG URL Standard sets none,
and the 8,000-octet figure people cite is RFC 7230's recommended floor for an HTTP
*request line*, which cannot apply here because the fragment is never in a request.
Chromium documents its own 2 MB cap; Apple publishes nothing for Safari. And none of that is
really the constraint anyway — what matters is how much iOS keeps in a home-screen bookmark,
which Apple documents nowhere. 64,000 is a conservative number chosen here, and the only
measurement behind it is that a link of about 21,000 characters has survived Add to Home
Screen on an iPhone.

If a link does get cut short, the signature catches it: truncation changes the bytes,
verification fails, and nothing runs. The engine says so rather than showing a blank screen.

**Compression that varies.** The app is gzipped and then base64url-encoded, which adds a
third back, so the useful figure is HTML bytes per URL character rather than the gzip ratio
alone. Measured on the HTML in this repo:

| file | raw | gzipped | ratio |
|---|---|---|---|
| `index.html` | 74,325 | 24,890 | 2.99× |
| `samples/storage-probe.html` | 5,235 | 2,203 | 2.38× |
| a 53 KB artifact | 54,243 | 15,580 | 3.48× |

That 53 KB artifact became a 21,411-character URL, a third of the budget. At those ratios
the ceiling sits somewhere near 140–170 KB of HTML, but five files is not a law — the meter
in the compiler measures your actual file, and that is the number to trust. A single base64
image is usually over the limit by itself.

**It is not offline, yet.** The app needs no network, because it is in the link. The engine
that unpacks it does: a few KB of static HTML fetched from your Pages site, with no service
worker caching it. So an app with no external resources works on a plane for exactly as long
as your browser happens to have that page cached, which is not something to rely on. A
service worker would fix this properly and is maybe fifteen lines, since the engine is one
file that rarely changes. It is not built.

**Browser requirements.** `CompressionStream` means Safari 16.4, Firefox 113, Chrome 80 or
later. Signature checking uses Web Crypto, which browsers only expose in a secure context,
so the page has to be served over https or from `localhost` — not from a `file://` path.

**External resources.** CDN scripts, web fonts and remote images still load, and still work.
They just add a network dependency on every open. The compiler lists every external host it
finds, and distinguishes a stylesheet (the app works, looks wrong) from a script (the app
usually will not run).

**Storage eviction.** WebKit exempts home-screen web apps from Safari's seven-day
script-writable storage cap. Apps you only ever open in a browser tab are not exempt. Use
**Export all app data** for anything you would mind losing. That backup contains your app
data and deliberately not your private key, which belongs in your password manager.

---

## Running Claude artifacts

Artifacts work as they are: copy the HTML out of the chat, paste it in, publish.

Some artifacts store data through `window.claude`, which only exists on claude.ai. sideload
installs a local stand-in built from the published runtime contract (0.2.96) and backed by
the app's own namespaced `localStorage`, so those apps keep working and save to your device
instead. Anything already in your Claude account stays there, so the app starts empty.

Two capabilities are implemented in full — `db`, including documents, collections,
`where`/`orderBy`/`limit` queries, `onSnapshot` subscriptions and document leases, and
`user`, which reports you as the owner of your own app. The rest (`room`, `sample`,
`artifact`, `assets`, `downloads`, `files`, `mcp`, `comments`) are not implemented, and that
is deliberate rather than unfinished: the contract has `claude.use(name)` resolve `null` for
anything unavailable in a given view, and artifacts are written to branch on it, so an app
that wanted one of those degrades the way its author intended. A half-implemented namespace
would be worse than an absent one, because an object with missing methods has no defined
handling and simply throws.

The stand-in is injected by the engine at run time, so none of it is in the payload and it
costs your app's budget nothing.

### Compared with publishing the artifact on claude.ai

Publishing on claude.ai is one click and better for showing someone a demo. The differences
that are structural rather than subject to product changes:

| | published artifact | sideload |
|---|---|---|
| where saved data lives | Anthropic's servers | the viewer's own browser |
| who controls the hosting | Anthropic | you |
| what a viewer needs | depends on how you shared it | the link |

If you want a small private tool whose data sits on your phone and which keeps working
regardless of anybody's subscription, this. If you want to show someone something in one
click, publish the artifact.

---

## Security

The model is that every app on your instance is one you pasted in yourself.

**Signing holds up the part that faces outward.** Nobody can construct a link that runs
their code on your origin, because the engine verifies against your public key before it
unpacks anything. That is the whole attack that a shared origin would otherwise invite, and
it is closed. It also means a fork is harmless to you: another person's instance has their
key, and neither of you can publish to the other.

**Signing does not hide your code.** gzip and base64 are encoding, not encryption. Anyone
with a link can decode it, read your HTML, modify it and run it elsewhere. They cannot run a
modified version on your origin.

**Your own apps are not isolated from each other.** They share one origin, so they share one
`localStorage`. Each app's keys are prefixed with its data name, and the engine replaces
`window.localStorage` inside the app with a namespaced proxy — but that prevents accidents,
not attacks. The proxy is installed as a configurable own property on `window`, and the
native accessor lives on `Window.prototype`, so `delete window.localStorage` restores it;
appending a same-origin iframe and reading `frame.contentWindow.localStorage` does the same.
Either is one line.

What that reaches includes **the private key**, which is stored as a plain string in
`localStorage`. So the real policy is the simple one: do not paste code you have not read.
The first-order cost of ignoring it is that one bad app can read everything your other apps
saved. The second-order cost is worse, because a key that leaves your device lets whoever
holds it publish to your origin indefinitely, including to people you have shared links
with, and recovering means a new key, an edited `index.html`, a push, republishing every app
and every home-screen icon breaking.

Two consequences worth acting on:

- Keep sideload on a GitHub account that hosts nothing with real secrets. One
  `github.io` origin covers every repo on the account, so any page you host there can read
  this storage.
- If this ever stops being only yours, the fix is origin separation, not more checks in the
  engine. Splitting the compiler onto a different host from the runner would put the key on
  an origin that never runs guest code at all.

---

## Reference

```
index.html              the whole engine: compiler, runner, signing, storage, launcher
icon.png                fallback apple-touch-icon
tools/keygen.mjs        generate a keypair from the command line
samples/
  storage-probe.html    writes generic storage keys; two copies show apps stay separate
test/run.mjs            headless tests
test/mklinks.mjs        dev helper: short redirect stubs, so a 20,000-character URL is
                        tappable on a phone
```

`index.html` opens with a map of its nine sections. It is one file in plain ES5 with no
build step, deliberately: it is the thing being published, it has to run on whatever Safari
is on your phone, and the whole trust boundary should be readable in one sitting.

### Tests

```
node test/run.mjs                              # samples only
node test/run.mjs ~/Downloads/some-app.html    # plus your own files
```

170 checks, plus three more for each file you pass: that apps survive the codec byte for
byte, that every way of faking or tampering with a signature is refused, that apps cannot
see each other's storage, that the `window.claude` stand-in matches its contract, and that
real files fit the budget. Anything involving the home screen has to be tested on a real
phone.

### iOS specifics

`apple-mobile-web-app-capable`, the status bar style and a fallback `apple-touch-icon` sit in
`index.html` as static tags, because iOS reads them when you tap Add to Home Screen and
every app is the same page with a different fragment — one set of tags covers all of them.
The app name, `apple-mobile-web-app-title` and a generated icon are added at run time so each
app gets its own label and coloured tile. There is deliberately no `<link rel="manifest">`:
a manifest's `start_url` would drop the fragment and open the empty compiler instead of your
app.

### Troubleshooting

**"This site has no signing key"** — `PUBLIC_KEY` is still empty in `index.html`. See step 3.

**"This key does not match your site"** — usually a fork where step 3 was skipped, so the
engine still trusts the original author's key. The compiler shows the line to paste.

**"Refused: this link is not signed by your key"** — the signature check doing its job. The
link was built on another instance or altered after it was made.

**"This link looks cut short"** — a long link that failed verification, which is what
truncation looks like. Something shortened it in transit. Rebuild from a smaller app.

**"Insecure context"** — Web Crypto needs https. Use your Pages URL, not a `file://` path.

**A blank app with no error** — check the compiler's external-host warning. A CDN script
that fails to load will usually stop the app dead.

## Prior art

[itty.bitty.site](https://github.com/arfct/itty-bitty) has been putting pages in URLs since
2018, using LZMA, which compresses better than gzip does. It renders into
`iframe.src = "data:text/html;base64,…"`, which is why it cannot run an app that saves
anything, and that is a reasonable trade for sharing documents. sideload is narrower on
purpose: your own tools, with storage that works, and signing so that only your code runs.
