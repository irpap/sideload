# sideload — design notes

Where the project stands, what the next architecture is, and why. Written down so the
reasoning survives; the research behind each claim is cited.

---

## 1. Where it stands today

Working, tested on-device, 71 headless tests green.

- gzip + base64url payload in the URL fragment; never sent to a server
- rendered by `document.open/write/close` — the app *becomes* the page
- `localStorage` namespaced per app by a `Proxy` installed before app code runs
- local stand-in for `window.claude` db/user, so artifact sync code still runs
- error overlay in a shadow root; a failure is never a blank screen
- Add to Home Screen works: borderless launch, per-app name and generated icon

### Why no iframe

An iframe was the original design and it was wrong twice over. A `sandbox` without
`allow-same-origin` lands on an **opaque origin**, where `localStorage` throws
`SecurityError` — so it breaks every stateful app. And with `allow-scripts` +
`allow-same-origin` it provides no security either, because the frame can rewrite its own
`sandbox` attribute and escape. On top of that, the nested scroll container made iOS
resolve a horizontal drag on `<input type=range>` as a page pan, so sliders barely worked.

`document.write` keeps the real origin (storage works), keeps the URL (Add to Home Screen
works), and gives the app the real viewport (native gestures).

### What is NOT secure about it

Single origin, so the per-app namespacing is **labels, not walls**. Defeated in one line:

```js
const f = document.createElement('iframe');
document.body.appendChild(f);
f.contentWindow.localStorage;   // pristine, un-shimmed, the whole origin
```

Fine while every app is one you pasted in yourself. Not fine the moment anyone opens a link
someone else made. Also, everything on `*.github.io` shares one origin, so a malicious app
could reach any other project hosted under the same account — the risk
[CodePen describes](https://blog.codepen.io/2023/01/18/397-user-generated-content-saftey/)
as the reason they serve user code from `cdpn.io`.

**Conclusion: ship as a personal tool now; do not publish the single-origin version.**

---

## 2. Next architecture: content-addressed origins

Each app gets its own subdomain, derived from a hash of its own payload:

```
japan-trip-k7m2x9p4q8w3n5.sideloadcontent.com/#<payload>
```

The engine computes `SHA-256(payload)`, compares it to the subdomain label, and **refuses to
render on mismatch** — before any app code runs. One payload maps to exactly one origin, so
an attacker's code can never land on your app's origin, and therefore can never reach its
storage. Different subdomain means different origin means a different `localStorage` bucket.

This dissolves the trade-off rather than patching it:

| | storage works | real isolation | native gestures |
|---|---|---|---|
| itty-bitty (`data:` URL) | no | yes | yes |
| sideload today (one origin) | yes | no | yes |
| **content-addressed subdomains** | **yes** | **yes** | **yes** |

Client-side enforcement is sufficient: an attacker controls the fragment, never the engine
being served.

### Requirements that are easy to get wrong

**Hash length ≥128 bits.** Truncate to 32 bits and a second-preimage attack is seconds of
GPU time — an attacker crafts malicious HTML that hashes into *your* subdomain. SHA-256 in
base32 is 52 chars; 26 chars (130 bits) fits a 63-char DNS label with room for a slug prefix.

**Cookies cross subdomains; `localStorage` does not.** A cookie set with
`Domain=.sideloadcontent.com` is readable by every app. Two fixes, and GitHub uses both:
get the domain on the [Public Suffix List](https://publicsuffix.org) (free, but months to
reach shipped browsers), and/or serve apps from a **separate registrable domain** — which is
exactly why GitHub has `githubusercontent.com`. Plan: compiler on `sideload.app`, apps on
`*.sideloadcontent.com`.

**Only one wildcard level is free.** Cloudflare Universal SSL covers `*.example.com` but not
`*.*.example.com`, so the slug and hash share a single DNS label: `slug-hash.domain`.

---

## 3. Hosting

Research finding that rules out the obvious options: **wildcard subdomains are unsupported on
both GitHub Pages and Cloudflare Pages.** Cloudflare's docs state plainly that wildcard
custom domains are not supported for Pages projects, and
[GitHub Pages cannot set custom HTTP headers at all](https://github.com/orgs/community/discussions/54257)
— no CSP, no `X-Robots-Tag`, no COOP.

Also note: the **CSP `sandbox` directive only works as an HTTP header, never as a `<meta>`
tag**, so on GitHub Pages sandboxing the top-level document is simply unavailable.

**Target: Cloudflare Workers** (not Pages) with a wildcard route `*.sideloadcontent.com/*`
and static assets. Free tier covers 100k req/day. Gives custom headers, hence real CSP and
`noindex`.

**Source stays on GitHub** and Cloudflare deploys from it on push. Hosting and source
control are independent — open source for the HN post, Workers for the wildcard.

---

## 4. Remaining risks after content addressing

Theft is solved. Two things are not.

### Reputation / phishing

From the [itty-bitty HN thread](https://news.ycombinator.com/item?id=17459204), the two
objections that matter. gbba: attackers can *"effectively steal the trustworthiness of the
domain name."* And shitloadofbooks, which is the one to actually defend against:

> "An attacker can craft a URL which renders obscene content, then scatter that link
> everywhere on the web and get it crawled. Eventually it shows up in searches, but it's
> definitely 'on my domain.'"

Mitigations, in order of actual effectiveness:

1. **`robots.txt` + `X-Robots-Tag: noindex`** on app subdomains. Kills the crawler attack
   directly. Needs Workers; impossible on GitHub Pages.
2. **The ugly hostname is itself the defence.** `k7m2x9p4q8w3n5.sideloadcontent.com` looks
   nothing like a bank, and the URL bar is the only surface an app cannot spoof.
3. **First-run interstitial** — "this is a user-generated mini app" — remembered per origin,
   which under content addressing means once per app version. Cheap, worth doing, but weak:
   users dismiss warnings reflexively and the app still runs after acceptance. Count it as
   honesty, not as a control. A permanent badge is no better — in direct mode the app can
   draw over it.

### Trusting the served JavaScript

The sharpest critique of this whole category, and it applies to sideload unchanged:

> "Unless you actually audit the JS on the page yourself every time you visit… there's no
> guarantee that the JS isn't sending the decompressed page content back to the server."

"Your data never leaves your device" depends entirely on trusting the host's engine. Open
source helps; self-hosting is the real answer. State it first, before someone else does.

---

## 5. The data migration problem

Content addressing means **changing one character of code changes the origin, which orphans
all saved data.** This is the main cost of the design, and it is also the category's
best-documented complaint — from
[HN on single-file HTML tools](https://news.ycombinator.com/item?id=46353359):

> "Updating the thing and keeping my data is always annoying even with web storage."

### Chosen solution: compiler-brokered migration

The compiler lives on one fixed trusted origin and remembers which origin each app version
used. To carry data forward:

1. Compiler opens a hidden iframe to `oldhash.sideloadcontent.com/?vault=1` — **vault mode:
   the engine loads, the app's code does not run.**
2. The engine checks `event.origin === 'https://sideload.app'` — browser-enforced and
   unspoofable — and replies with that origin's storage dump.
3. Compiler opens the new hash in vault mode, posts the data in, the engine writes it.

One click, no backend, and no untrusted code executes during the migration. The compiler
must send `frame-ancestors 'none'` so it cannot be framed and clickjacked.

### Rejected alternatives

- **Shared vault origin for all app data.** The vault can only identify a caller by its
  origin, which changes every version — so it still needs per-migration user approval, plus
  a clickjacking surface. That is the chosen design with extra steps.
- **Sync via the user's own cloud** (gist, iCloud Drive, Dropbox). Needs auth; natural v2.
- **Export/import only.** Already shipped; keep as the manual backstop, not the main path.

Framing: each hash is an immutable pinned release, and migration is a deliberate visible
act. That is a feature, not an apology.

---

## 6. Competitive position

Demand is real. Documented pain: *"If you ever want 'install as app' functionality, you'd
need to host them (even on GitHub Pages). File:// URLs don't support service workers."* And
*"even Firefox doesn't allow saving/opening .html files on mobile"* — not an iOS-only
problem. Plus the standing friction that Vercel and Netlify want a repo, a config file and a
CLI to publish one HTML file.

The field is crowded, and this should be acknowledged rather than discovered:

- [Claude publishes artifacts with a public link](https://claude.com/blog/claude-powered-artifacts)
  as of mid-2026 — and keeps `window.claude` db/identity genuinely working, which sideload
  can only simulate. For a Claude-native app this is the real alternative.
- **Netlify Drop** — drag a file, get a URL, no account.
- `@baaqar/artifact-to-pwa` — npx, artifact → installable PWA with IndexedDB. Needs a laptop.
- `claude-artifact-runner`, OneClickLive, nativeappai, code2native.
- "Host a Single HTML File: 8 Tools Compared (2026)" exists as a listicle.

### Genuine differentiators

1. **The code never leaves the device.** Everyone else uploads.
2. **Works entirely from the phone** — no laptop, npx or git.
3. **No account, ever.**
4. **Content-addressed origins.** Nobody else is doing this; it is the novel idea and the
   one worth writing about.

---

## 7. Build order

1. `SECURITY.md` stating the current single-origin trust model plainly.
2. Content-addressed subdomains: SHA-256 of payload → subdomain, verify before render.
3. Cloudflare Worker, wildcard route, `_headers` with CSP + `noindex`, `robots.txt`.
4. Compiler-brokered migration (`?vault=1` mode).
5. First-run interstitial, remembered per origin.
6. Separate registrable domain for app content; submit the apex to the PSL.
