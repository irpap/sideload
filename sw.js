/* sideload service worker -- makes the engine available without a network.
 *
 * There is only one thing to cache. An app's source travels in the URL
 * fragment, and a fragment is not part of an HTTP request, so every app you
 * will ever publish arrives as the same request: GET /sideload/. Cache that
 * one response and every app works offline, including apps published later.
 * Nothing here knows or needs to know that apps exist.
 *
 * NETWORK FIRST, on purpose. Serving the cached engine unconditionally would
 * mean a pushed fix never reaches your phone -- and worse, a cached engine
 * holding your old PUBLIC_KEY would refuse links signed with your new one.
 * So: ask the network, fall back to the cache, and race a short timer so a
 * stalled connection does not leave you staring at a blank page.
 *
 * Scope is whatever directory this file is served from, which is the same
 * directory as index.html. Registration is in section 9 of index.html.      */

var CACHE  = 'sideload-engine-v1';
var ASSETS = ['./', './index.html', './icon.png'];
var STALL  = 2500;                 /* ms before a slow network loses to the cache */

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(ASSETS); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ return self.skipWaiting(); })   /* a failed precache is not fatal */
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

function cached(req){
  /* ignoreSearch so ?v=... or a tracking parameter still finds the engine */
  return caches.match(req, {ignoreSearch:true}).then(function(hit){
    return hit || caches.match('./index.html');
  });
}

function networkFirst(req){
  return new Promise(function(resolve){
    var settled = false, timer = null;
    function done(res){
      if(settled) return;
      settled = true;
      if(timer) clearTimeout(timer);
      resolve(res);
    }

    timer = setTimeout(function(){
      cached(req).then(function(hit){ if(hit) done(hit); });
    }, STALL);

    fetch(req).then(function(res){
      /* Refresh the cache even if the timer already answered from it, so the
         next launch gets the newer engine. */
      if(res && res.ok){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
      }
      done(res);
    }).catch(function(){
      cached(req).then(function(hit){ done(hit || Response.error()); });
    });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var url;
  try{ url = new URL(req.url); }catch(err){ return; }

  /* Leave anything an app fetches from elsewhere alone: fonts, CDN scripts and
     remote images are the app's business, and caching them here would quietly
     change what "this app needs a connection" means. */
  if(url.origin !== self.location.origin) return;

  e.respondWith(networkFirst(req));
});
