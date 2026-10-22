# sideload

Run a single-file HTML app straight from a URL. One static page, no backend, no build step,
and no deploy for each app you make.

On iOS you cannot open a local `.html` file and have it run as an app. Safari blocks it. So
every small utility you generate with an AI needs a full deploy before it can sit on your
home screen. That is a lot of work for one file, and it needs a laptop.

sideload skips the deploy. You paste the HTML and get a link that contains the whole app.
Open that link in Safari, add it to your home screen, and it runs full screen and offline
with its own name and icon. You can do all of this from your phone.

```
you.github.io/sideload/#2-MEUCIQ...H4sIAAAA...
                         ^signature  ^your app, gzipped
```

Everything after the `#` stays in your browser. Browsers never send that part to a server,
so your code and your data never leave your device.

Your apps are **signed**. The engine only runs apps signed with your own key, so nobody can
send you a link that runs their code on your site and reads your saved data.

---

## Setup

You do this once. It takes about ten minutes. After that you can publish apps from your
phone with no laptop and no commands.

### 1. Deploy your copy

Fork this repo. Then go to **Settings → Pages** and set:

- **Source:** `Deploy from a branch` — GitHub often defaults to "GitHub Actions", so change it
- **Branch:** `main`, folder `/ (root)`

Save. A minute later your copy is live at `https://<you>.github.io/sideload/`.

It will not run anything yet, because you have not set a key. That is expected.

### 2. Create your key

Open `https://<you>.github.io/sideload/` and tap **Create key**.

Your browser generates a keypair. Nothing is uploaded. You get two strings:

- **Private key.** Keep this secret. Save it in your password manager now. It is the only
  thing that can publish or update apps on your site, and you cannot recover it if you lose
  it.
- **Public key.** This one is meant to be published.

If you would rather use a terminal, `node tools/keygen.mjs` does the same thing. The browser
is safer, because a terminal leaves your private key in your shell history.

### 3. Put your public key in the engine

Copy the `var PUBLIC_KEY = '...';` line that the compiler shows you. Replace the empty one
near the top of `index.html`:

```js
/* INSTANCE PUBLIC KEY -- replace this with your own. */
var PUBLIC_KEY = 'BG9x...your key...';
```

Commit and push. GitHub Pages redeploys in under a minute.

Reload the compiler. The key section should now say **Ready to publish**.

### 4. Put your key on your phone

On your phone, open `https://<you>.github.io/sideload/`, tap **Import key**, and paste the
private key from your password manager.

Do this before you travel. Once your phone has the key, you can publish and update apps from
it for as long as you like.

Repeat on any other device you want to publish from. Devices that only *use* your apps need
nothing.

---

## Publishing an app

1. Get an HTML file from Claude, or write one yourself. Copy it.
2. Open your compiler and paste it in.
3. The name fills in from the `<title>` tag. A storage key is suggested below it.
4. Check the size meter. You have about 64,000 URL characters. Most single-file apps use
   around a third of that.
5. Tap **Open app**, then Share → **Add to Home Screen**.

## Updating an app

Paste the new HTML, **keep the same storage key**, and publish. Open the new link and your
saved data will still be there, because the site address has not changed.

Your home screen icon still points at the old link, so delete it and add the new one. This
takes about fifteen seconds. There is no way around it: the app travels inside the link, so
new code always means a new link.

## Sharing

**Sharing an app** needs nothing from the person you send it to. Send them the link by
AirDrop, Messages, email, or a note. Their browser loads your engine from your site, checks
your signature against your public key, and runs the app. They can add it to their home
screen too. Their data stays in their own browser.

The link is over 20,000 characters, so it will not fit in a QR code and some chat apps will
break it.

**Sharing the tool** means sending someone this repo. They set up their own copy with their
own key. They cannot publish to your site and you cannot publish to theirs. That is what
makes it safe for lots of people to use it: everyone runs only their own code, on their own
site.

---

## How it works

| Step | What happens |
|---|---|
| Compress | `CompressionStream('gzip')`, built into the browser |
| Encode | base64url, so nothing needs escaping in a URL |
| Sign | ECDSA P-256 over the compressed bytes, using your private key |
| Transport | the part of the URL after `#`, which never reaches a server |
| Verify | checked against the public key in the engine, before anything runs |
| Run | `document.write`, so the app gets the whole page |

### Why signing

Your apps all share one site address, which means they share one storage area. Without
signing, anyone could send you a link to your own site with their code in it. Their code
would run with full access to everything your apps had saved.

Signing stops that. The engine checks the signature before it decompresses or renders
anything, so an unsigned or altered link never runs at all. There is no warning to click
past.

What signing does **not** do is hide your code. The payload is gzip and base64, not
encryption. Anyone with a link can decode it, read your HTML, copy it, change it, and run it
somewhere else. They just cannot run a changed version on your site.

### Why the app replaces the page instead of loading in an iframe

Two reasons.

A sandboxed iframe without `allow-same-origin` gets what browsers call an opaque origin, and
`localStorage` throws a `SecurityError` there. Any app that saves data breaks immediately.
Adding `allow-same-origin` makes storage work but gives no protection, because the frame can
remove its own `sandbox` attribute and escape.

An iframe also adds a second scrollable layer, which breaks sliders on iOS. Drag an
`<input type=range>` sideways and Safari scrolls the page instead of moving the slider.

Writing the app straight into the page avoids both. It keeps the real site address, so
storage works, and it gets the real page, so touch and scrolling behave normally.

---

## Limits

- **About 64,000 URL characters**, which is roughly 150–200 KB of HTML once compressed.
  Markup, CSS and JavaScript compress about four times. One embedded image will use up the
  whole budget, and the size meter warns you before you find out the hard way.
- **iOS 16.4 or newer**, for `CompressionStream`. Any current Chrome or Firefox is fine.
- **Must be served over https**, because signature checking uses Web Crypto, which browsers
  only allow on secure pages.
- **External files work online but not offline.** CDN scripts, web fonts and remote images
  still load, but they break the offline promise. The compiler lists every external host it
  finds so you know before you get on a plane.
- **Back up your data.** Apps on your home screen are exempt from Safari's seven-day storage
  cleanup, but apps you only open in a browser tab are not. Use **Export all app data**.

## Using apps from Claude

**Yes, Claude artifacts work.** Copy the HTML out of the chat, paste it in, publish. Nothing
to change.

One thing worth knowing. Some artifacts save their data into Claude's own cloud storage
instead of the browser's, by calling `window.claude`. That only exists on claude.ai, so
outside it those apps would normally lose the ability to save anything. sideload supplies a
local replacement automatically, so the app saves to your device instead and keeps working.
You do not have to do anything, and there is no setting to change.

What it cannot do is bring data across. Anything already saved in your Claude account stays
there, and the app starts empty on your device.

**So when you ask Claude to build something for sideload, tell it to use `localStorage`.**
That keeps the app self-contained, avoids the whole issue, and means the same file works
anywhere.

### Why not just publish the artifact on claude.ai?

Publishing on claude.ai is one click, and for a quick share it is the easier option. The
differences that matter:

| | Published artifact | sideload |
|---|---|---|
| Works offline | No | Yes |
| Where your data is kept | Anthropic's servers | your own device |
| Saving data | needs the author on a paid plan | free |
| Viewer needs an account | depends which share button you use | no |
| Who controls the hosting | Anthropic | you |

If you want a small private tool that keeps working regardless of your subscription, runs on
a plane, and keeps your data on your phone, use this. If you want to show someone a demo in
one click, publish the artifact.

## iOS details

- `apple-mobile-web-app-capable`, the status bar style, and a fallback `apple-touch-icon` are
  written into `index.html` directly. iOS reads them when you tap Add to Home Screen, and
  every app is the same page with a different `#` part, so one set of tags covers all of them.
- The app name, `apple-mobile-web-app-title`, and a generated icon are added at runtime, so
  each app gets its own label and its own coloured tile.
- There is deliberately no `<link rel="manifest">`. A manifest's `start_url` would drop the
  part after the `#` and open the empty compiler instead of your app.

## Files

```
index.html              the whole engine: compiler, runner, signing, storage, launcher
icon.png                fallback apple-touch-icon
tools/keygen.mjs         generate a keypair from the command line
samples/
  storage-probe.html    writes generic keys, so two copies show storage is separated
test/run.mjs            headless tests
test/mklinks.mjs        dev helper: short links for testing on a phone
```

## Tests

```
node test/run.mjs                              # samples only
node test/run.mjs ~/Downloads/some-app.html    # plus your own files
```

Checks that apps come back out byte for byte, that every way of faking a signature is
refused, that apps cannot read each other's data, and that real files fit the size budget.

Anything involving the home screen has to be tested on a real phone.

## Security

**Safe:** running your own apps, and sharing your apps with other people.

**Not possible:** someone sending you a link that runs their code on your site. The signature
check blocks it before anything runs.

**Worth knowing:** all your own apps share one site address, so any app you sign can read any
other one's saved data, and the private key in your browser storage. These are all apps you
chose to publish, so this is about trusting your own code rather than about attackers. Two
things follow from it:

- Keep sideload on a GitHub account where you do not host anything with real secrets, because
  one `github.io` address covers every repo you publish.
- If that bothers you, giving each app its own subdomain fixes it properly. See `DESIGN.md`.
  It needs wildcard DNS, which costs around $3 a month, and it protects you from your own
  code rather than from anyone else.

## Troubleshooting

**"This instance has no signing key"** — `PUBLIC_KEY` is still empty in `index.html`. See
step 3.

**"Key does not match this deployment"** — usually a fork where step 3 was skipped, so the
engine still trusts the original author's key. The compiler shows you the line to paste.

**"Refused: this link is not signed by this instance"** — this is the signature check doing
its job. The link was made somewhere else, altered, or is an old unsigned link from before
signing existed. Make it again in your compiler.

**"Insecure context"** — Web Crypto needs https. Use your Pages URL, not a `file://` path or
a plain-http address.

**A blank app with no error** — check the compiler's external-host warning. An app that loads
a script from a CDN will fail offline. Missing fonts are harmless; missing scripts are not.

## Prior art

[itty.bitty.site](https://github.com/arfct/itty-bitty) has put pages inside URLs since 2018,
using LZMA, which compresses better than this does. It renders with
`iframe.src = "data:text/html;base64,…"`, which lands on an opaque origin where storage
throws. That is fine for sharing small documents, which is what it was built for, but it
cannot run an app that saves anything. sideload is narrower on purpose: your own tools, with
storage that works and signing so only your code runs.
