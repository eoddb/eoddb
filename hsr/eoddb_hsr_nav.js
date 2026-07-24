const EODDB_NAV_PAGES = [
  { label: 'Honkai: Star Rail', href: '/hsr', isHome: true },
  { label: 'Price Comparison', href: '/hsr/p2w' },
  { label: 'Powercreep', href: '/hsr/powercreep' },
];

(function() {
  const currentPath = location.pathname.replace(/\.html$/, '').replace(/\/$/, '');

  const nav = document.createElement('nav');
  nav.className = 'eoddb-nav';

  const inner = document.createElement('div');
  inner.className = 'eoddb-nav-inner';

  const brand = document.createElement('a');
  brand.href = '/';
  brand.className = 'eoddb-nav-brand';
  brand.innerHTML = 'EOD<span class="db">db.com</span>';
  inner.appendChild(brand);

  const sep = document.createElement('span');
  sep.className = 'eoddb-nav-sep';
  inner.appendChild(sep);

  EODDB_NAV_PAGES.forEach(page => {
    const a = document.createElement('a');
    a.href = page.href;
    a.textContent = page.label;
    a.className = 'eoddb-nav-link';
    if (page.isHome) a.classList.add('eoddb-nav-home');
    if (currentPath === page.href) a.classList.add('eoddb-nav-active');
    inner.appendChild(a);
  });

  nav.appendChild(inner);
  document.currentScript.parentNode.insertBefore(nav, document.currentScript);

  const style = document.createElement('style');
  style.textContent = `
    .eoddb-nav {
      background: #111821;
      border-bottom: 1px solid #252d3d;
      padding: 0 1.5rem;
      margin: -2rem -1.5rem 1.4rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .eoddb-nav-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      /* Not baseline: MOON GET! draws its glyphs ~0.23em BELOW the
         typographic baseline, so baseline-aligning the two fonts ties their
         vertical positions together and neither can be placed on its own.
         Stretching every item to full bar height and pinning the text by
         padding instead decouples them, and keeps the active link's
         underline flush with the bottom of the bar. */
      align-items: stretch;
      gap: 0;
      overflow-x: auto;
    }
    /* Two groups, deliberately independent. THE INVARIANT: the MOON GET!
       items — the EODdb.com lockup and the game-name home link — stay
       centred in the bar, and 15px top padding is what centres them (their
       line box is shorter than the body font's, so an even 12/12 leaves them
       riding ~3px high). Never retune the nav by moving both groups together;
       adjust the body-font links below and leave these two alone. */
    .eoddb-nav-brand {
      display: block;
      padding: 15px 0 9px;
      margin-right: 6px;
      font-size: 0.8rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #e6edf3;
      text-decoration: none;
      white-space: nowrap;
      transition: color 0.15s;
    }
    .eoddb-nav-brand:hover {
      color: #a9b4c6;
    }
    /* Two-tone lockup, site-wide standard: EOD stays off-white, db.com
       carries the slate accent. Keeps the brand from reading as just
       another bold nav link next to the home link. */
    .eoddb-nav-brand .db {
      text-transform: none;
      color: #717D92;
      transition: color 0.15s;
    }
    .eoddb-nav-brand:hover .db {
      color: #8f9bb0;
    }
    .eoddb-nav-sep {
      width: 1px;
      height: 20px;
      background: #252d3d;
      margin: 0 10px;
      flex-shrink: 0;
      align-self: center;
    }
    /* The body-font links: this is the group that gets adjusted. Top and
       bottom move in opposite directions so the box height — and with it the
       bar height and the active link's underline — stays put. */
    .eoddb-nav-link {
      display: block;
      padding: 14px 16px 10px;
      font-size: 0.8rem;
      font-weight: 500;
      color: #6e7a8a;
      text-decoration: none;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .eoddb-nav-link:hover {
      color: #c9d1d9;
    }
    .eoddb-nav-link.eoddb-nav-active {
      color: #e6edf3;
      border-bottom-color: #717D92;
    }
    .eoddb-nav-home {
      font-weight: 700;
      letter-spacing: 0.02em;
      /* MOON GET!, so it takes the brand's centring, not the links'. */
      padding-top: 15px;
    }
  `;
  document.head.appendChild(style);
})();
