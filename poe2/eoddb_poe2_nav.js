const EODDB_NAV_PAGES = [
  { label: 'Path of Exile 2', href: '/poe2', isHome: true },
  { label: 'Crafting', href: '/poe2/crafting' },
  { label: 'Economy', href: '/poe2/economy' },
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
         typographic baseline, so baseline-aligning it with the body font
         left the ordinary links floating ~3px high. Stretching every item
         to full bar height and pinning the text by padding instead lands
         both fonts' letter-bottoms on the same line, and keeps the active
         link's underline flush with the bottom of the bar. */
      align-items: stretch;
      gap: 0;
      overflow-x: auto;
    }
    /* Vertical padding is what sets the text block's height in the bar, and
       brand and links carry the same split — change it on both together or
       the two fonts stop sharing a baseline. */
    .eoddb-nav-brand {
      display: block;
      padding: 12px 0;
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
    .eoddb-nav-link {
      display: block;
      padding: 12px 16px;
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
    }
  `;
  document.head.appendChild(style);
})();
