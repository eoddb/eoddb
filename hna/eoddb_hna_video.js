// Shared YouTube player for eoddb.com — facade thumbnail + sticky mini-player.
//
// Why it works this way:
//  - Nothing is requested from YouTube until the visitor clicks. Only the
//    thumbnail loads, and lazy facades don't even do that until revealed.
//  - The iframe is created once inside a single fixed container and is never
//    re-parented. Moving an iframe in the DOM reloads it, which would restart
//    the video and its ad — so instead the container is positioned over the
//    inline slot, and drops to a corner mini-player when that slot isn't on
//    screen. Playback survives navigating around the page.
//  - The player is always visible while playing, never hidden. A concealed
//    iframe accruing ad time would breach YouTube/AdSense viewability policy.
//  - Plain youtube.com (not -nocookie) with no ad-suppressing parameters, so
//    videos monetise exactly as they do on YouTube.
//
// Usage — drop an element on the page and the script fills it in:
//   <div class="eoddb-video" data-yt-id="VIDEOID" data-yt-label="Title"></div>
// Add data-yt-lazy="1" to hold the thumbnail back until EODDB_VIDEO.hydrate()
// is called (used where the video starts inside a collapsed section).
//
// API: EODDB_VIDEO.scan(root) / .hydrate(root) / .sync() / .stop()
// Fires 'eoddb-video-reveal' on a facade when the mini-player's back button
// wants it shown, so a page can expand whatever contains it.

(function () {
  var CSS = [
    // No width here on purpose — this stylesheet is injected after the page's
    // own, so any sizing would override the page's layout for the slot.
    '.eoddb-video .yt-thumb{position:relative;display:block;width:100%;padding:0;line-height:0;',
      'background:var(--surface,#161b25);border:1px solid var(--border,#252d3d);border-radius:8px;',
      'overflow:hidden;cursor:pointer;transition:border-color .15s;}',
    '.eoddb-video .yt-thumb:hover{border-color:var(--accent1,#717D92);}',
    '.eoddb-video .yt-thumb img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;display:block;}',
    '.eoddb-video .yt-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
      'width:52px;height:36px;border-radius:8px;background:rgba(113,125,146,.85);display:flex;',
      'align-items:center;justify-content:center;transition:background .15s,transform .15s;}',
    '.eoddb-video .yt-play::after{content:"";border-style:solid;border-width:8px 0 8px 13px;',
      'border-color:transparent transparent transparent var(--header-text,#e6edf3);margin-left:3px;}',
    '.eoddb-video .yt-thumb:hover .yt-play{background:var(--accent1,#717D92);transform:translate(-50%,-50%) scale(1.08);}',
    '.eoddb-video .yt-caption{font-size:.66rem;color:var(--text-muted,#6e7a8a);margin-top:5px;line-height:1.45;}',
    '.eoddb-video .yt-fallback{display:none;}',
    '.eoddb-video.thumb-failed .yt-thumb{display:none;}',
    '.eoddb-video.playing .yt-thumb{display:none;}',
    '.eoddb-video.thumb-failed .yt-fallback{display:inline-block;font-size:.75rem;color:var(--accent1,#717D92);',
      'text-decoration:none;border:1px solid var(--border,#252d3d);border-radius:6px;padding:8px 12px;}',
    '.eoddb-video.thumb-failed .yt-fallback:hover{background:var(--surface-hover,#1c2233);border-color:var(--accent1,#717D92);}',
    // reserves the inline box the floating player docks over
    '.eoddb-video .yt-holder{display:none;width:100%;aspect-ratio:16/9;border:1px solid var(--border,#252d3d);',
      'border-radius:8px;background:#000;}',
    '.eoddb-video.playing .yt-holder{display:block;}',
    '#eoddb-player{position:fixed;z-index:60;display:none;}',
    '#eoddb-player.active{display:block;}',
    '#eoddb-player .ep-frame{width:100%;height:100%;}',
    '#eoddb-player iframe{width:100%;height:100%;border:0;display:block;border-radius:8px;}',
    '#eoddb-player .ep-bar{display:none;}',
    '#eoddb-player.mini{right:16px;bottom:16px;left:auto;top:auto;width:min(300px,calc(100vw - 24px));height:auto;',
      'background:var(--surface,#161b25);border:1px solid var(--border,#252d3d);border-radius:8px;overflow:hidden;',
      'box-shadow:0 10px 30px rgba(0,0,0,.55);}',
    '#eoddb-player.mini .ep-frame{height:auto;aspect-ratio:16/9;}',
    '#eoddb-player.mini iframe{border-radius:0;}',
    '#eoddb-player.mini .ep-bar{display:flex;align-items:center;gap:8px;padding:6px 8px;}',
    '#eoddb-player .ep-back{flex:1;text-align:left;background:none;border:0;color:var(--text-muted,#6e7a8a);',
      'font-family:inherit;font-size:.68rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#eoddb-player .ep-back:hover{color:var(--header-text,#e6edf3);}',
    '#eoddb-player .ep-close{background:none;border:0;color:var(--text-muted,#6e7a8a);font-size:1rem;',
      'line-height:1;padding:2px 4px;cursor:pointer;}',
    '#eoddb-player .ep-close:hover{color:var(--header-text,#e6edf3);}'
  ].join('');

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var player = null;
  var current = { id: null, facade: null };
  var observer = null;

  function ensurePlayer() {
    if (player) return player;
    player = document.createElement('div');
    player.id = 'eoddb-player';
    player.innerHTML =
      '<div class="ep-frame"></div>' +
      '<div class="ep-bar">' +
        '<button type="button" class="ep-back"></button>' +
        '<button type="button" class="ep-close" aria-label="Close video">&times;</button>' +
      '</div>';
    document.body.appendChild(player);

    player.querySelector('.ep-close').addEventListener('click', function () { stop(); });

    player.querySelector('.ep-back').addEventListener('click', function () {
      var f = current.facade;
      if (!f) return;
      f.dispatchEvent(new CustomEvent('eoddb-video-reveal', { bubbles: true, detail: { facade: f } }));
      sync();
      f.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    var queued = false;
    function onMove() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; sync(); });
    }
    // capture phase so scrolling inside nested scrollers counts too
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove, { passive: true });
    return player;
  }

  function play(facade) {
    var id = facade.getAttribute('data-yt-id');
    if (!id) return;
    var label = facade.getAttribute('data-yt-label') || 'Video';
    ensurePlayer();
    stop(true);
    current = { id: id, facade: facade };

    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
    iframe.title = label;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    player.querySelector('.ep-frame').appendChild(iframe);
    player.querySelector('.ep-back').textContent = '▸ ' + (facade.getAttribute('data-yt-back') || label);

    facade.classList.add('playing');
    player.classList.add('active');

    // Scroll events alone would miss programmatic scrolls, scrolling inside a
    // nested container, and layout shifts. Watch the slot itself instead.
    if (observer) { observer.disconnect(); observer = null; }
    var holder = facade.querySelector('.yt-holder');
    if (holder && window.IntersectionObserver) {
      observer = new IntersectionObserver(function () { sync(); },
        { threshold: [0, 0.05, 0.3, 0.6, 1] });
      observer.observe(holder);
    }
    sync();
  }

  // Removing the iframe is what actually stops playback.
  function stop(keepActive) {
    if (!player) return;
    if (observer) { observer.disconnect(); observer = null; }
    player.querySelector('.ep-frame').innerHTML = '';
    current = { id: null, facade: null };
    Array.prototype.forEach.call(document.querySelectorAll('.eoddb-video.playing'), function (v) {
      v.classList.remove('playing');
    });
    if (!keepActive) {
      player.classList.remove('active', 'mini');
      player.removeAttribute('style');
    }
  }

  function sync() {
    if (!player || !current.id) return;
    var holder = current.facade && current.facade.querySelector('.yt-holder');
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var r = null;
    if (holder && holder.offsetParent !== null && vh) {
      var box = holder.getBoundingClientRect();
      if (box.height > 0 && box.bottom > 70 && box.top < vh - 40) r = box;
    }
    if (r) {
      player.classList.remove('mini');
      player.style.left = r.left + 'px';
      player.style.top = r.top + 'px';
      player.style.width = r.width + 'px';
      player.style.height = r.height + 'px';
    } else {
      player.classList.add('mini');
      player.removeAttribute('style');
    }
  }

  // A wrong or pulled ID doesn't 404 — YouTube answers with a 120x90 grey
  // placeholder and HTTP 200 — so size-check instead of trusting onerror.
  function markFailed(img) {
    var v = img.closest ? img.closest('.eoddb-video') : null;
    if (v) v.classList.add('thumb-failed');
  }

  function build(el) {
    var id = el.getAttribute('data-yt-id');
    if (!id || !/^[\w-]{11}$/.test(id) || el.dataset.ytReady === '1') return;
    var label = el.getAttribute('data-yt-label') || 'Gameplay video';
    var lazy = el.getAttribute('data-yt-lazy') === '1';
    var srcAttr = lazy ? 'data-src' : 'src';
    el.classList.add('eoddb-video');
    el.innerHTML =
      '<button type="button" class="yt-thumb" aria-label="Play ' + esc(label) + ' on YouTube">' +
        '<img ' + srcAttr + '="https://i.ytimg.com/vi/' + esc(id) + '/mqdefault.jpg" alt="" ' +
             'width="320" height="180" loading="lazy">' +
        '<span class="yt-play" aria-hidden="true"></span>' +
      '</button>' +
      '<a class="yt-fallback" href="https://www.youtube.com/watch?v=' + esc(id) + '" target="_blank" rel="noopener">Watch on YouTube &rarr;</a>' +
      '<div class="yt-holder" aria-hidden="true"></div>' +
      '<div class="yt-caption">' + esc(label) + ' &middot; EODGamer</div>';
    var img = el.querySelector('img');
    img.addEventListener('load', function () { if (img.naturalWidth <= 120) markFailed(img); });
    img.addEventListener('error', function () { markFailed(img); });
    el.dataset.ytReady = '1';
  }

  function scan(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-yt-id]'), build);
  }

  function hydrate(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('.eoddb-video img[data-src]'), function (img) {
      img.src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
    });
  }

  document.addEventListener('click', function (evt) {
    var thumb = evt.target.closest && evt.target.closest('.yt-thumb');
    if (!thumb) return;
    var facade = thumb.closest('.eoddb-video');
    if (facade) play(facade);
  });

  window.EODDB_VIDEO = { scan: scan, hydrate: hydrate, sync: sync, stop: stop };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(document); });
  } else {
    scan(document);
  }
})();
