// EODdb — shared team data layer. Used by the team planner and any page
// that renders or links teams. Pages call tcInitData(unitNames, eidoNames)
// (names in site-JSON row order) after fetching the site JSONs.
/*p1*/const _p1="VU2QTM3Yyg31FV81lk86sTAiC4t57q5UrkVTNCfX/RUTEZwUjEGftOwRF08EJ0vyVc9VXMhKccYvj01SjkypvFHE4ancvb7johgOIuGZ00N7FwTV7Ad+gWYi4OWyUiOWZ3z7AgoMF7NlWngJIQABlz9VCy0UBJP0vOIjDPm8TI/qiYjERBMAsfmIgtw+TSeLKNjdCiO+DYdKmkwVCDVQMn57YBSP/wrCTxQQ8md5zM+JbgJDb8oM13FduUPEcUfJ2C4rNLOWMdIRWLzHcc3JLnYwGiKybemwSEW1MkNT/rCpOzLP8sOtBVjCrGgvojATSGCa2XUgW2afzqBV7dPej7qxrQDY0TbuH4d1+9JNHPygMKAEFn34AZs8NCYLM54CI2tn4ld/6RD1wsN60gTNHRBKSygQVmn7CyuWJAtiGEOaym8WN/cxjieD4QIjOQMISlR210yIDY4pcZHWaDIlYCau5dYpFWQguVfd6kJKZxH3T5FhUd3rRrMGN3MZX1LTeAFto7m1JHoNRXxJ2RluW39Vsnp6qRZmK2YvVciBm/kCXvs0+7UPYj0pYC99AmCchV3nRueAflC3X5KTywSxpmjYEQ9QIhsVnOw6yZ7xINo+FirEEYU=";/*p1e*/

const tcUnitId = {}, tcUnitName = {}, tcEidoId = {}, tcEidoName = {};

function tcInitData(unitNames, eidoNames) {
  const raw = atob(_p1);
  let s = 2463534242;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>>= 0) & 0xFF; };
  let txt = '';
  for (let i = 0; i < raw.length; i++) txt += String.fromCharCode(raw.charCodeAt(i) ^ next());
  const [a, b] = txt.split('|').map(part => part.split(',').map(Number));
  unitNames.forEach((n, i) => { tcUnitId[n] = a[i]; tcUnitName[a[i]] = n; });
  eidoNames.forEach((n, i) => { tcEidoId[n] = b[i]; tcEidoName[b[i]] = n; });
}

function xxh32(d, seed) {
  const P1 = 2654435761, P2 = 2246822519, P3 = 3266489917, P4 = 668265263, P5 = 374761393;
  const u = x => x >>> 0, rl = (x, r) => u((x << r) | (x >>> (32 - r)));
  const r32 = o => (d[o] | (d[o+1] << 8) | (d[o+2] << 16) | (d[o+3] << 24)) >>> 0;
  let i = 0, h, len = d.length;
  if (len >= 16) {
    let v1 = u(seed + P1 + P2), v2 = u(seed + P2), v3 = u(seed), v4 = u(seed - P1);
    for (; i <= len - 16; i += 16) {
      v1 = u(Math.imul(rl(u(v1 + Math.imul(r32(i), P2)), 13), P1));
      v2 = u(Math.imul(rl(u(v2 + Math.imul(r32(i+4), P2)), 13), P1));
      v3 = u(Math.imul(rl(u(v3 + Math.imul(r32(i+8), P2)), 13), P1));
      v4 = u(Math.imul(rl(u(v4 + Math.imul(r32(i+12), P2)), 13), P1));
    }
    h = u(rl(v1, 1) + rl(v2, 7) + rl(v3, 12) + rl(v4, 18));
  } else h = u(seed + P5);
  h = u(h + len);
  for (; i <= len - 4; i += 4) h = u(Math.imul(rl(u(h + Math.imul(r32(i), P3)), 17), P4));
  for (; i < len; i++) h = u(Math.imul(rl(u(h + Math.imul(d[i], P5)), 11), P1));
  h ^= h >>> 15; h = u(Math.imul(h, P2));
  h ^= h >>> 13; h = u(Math.imul(h, P3));
  h ^= h >>> 16;
  return u(h);
}

function tcB64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tcBytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function tcParse(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i++], field = tag >> 3, wt = tag & 7;
    if (wt === 0) {
      let v = 0, shift = 0, b;
      do { b = buf[i++]; v += (b & 0x7F) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
      out.push([field, v]);
    } else if (wt === 2) {
      const len = buf[i++];
      out.push([field, tcParse(buf.slice(i, i + len))]);
      i += len;
    } else {
      throw new Error('bad wire type');
    }
  }
  return out;
}

function tcVarint(n) {
  const out = [];
  do { let b = n & 0x7F; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}

// Read-only mini board. renderTeamBoard(containerEl, code, opts?) draws the
// 4x7 hex grid + eido chips for a teamcode. Returns {units:[names], eidos:[names]}
// (unknown IDs render as "?" hexes and return null entries). opts.hexSize px.
function renderTeamBoard(container, code, opts) {
  opts = opts || {};
  const size = opts.hexSize || 36;
  if (!document.getElementById('tb-style')) {
    const st = document.createElement('style');
    st.id = 'tb-style';
    st.textContent =
      '.tb-board{display:inline-flex;flex-direction:column;gap:2px;padding:10px;background:#111821;border:1px solid #252d3d;border-radius:8px}' +
      '.tb-row{display:flex;gap:3px}' +
      '.tb-row.tb-off{margin-left:calc(var(--tb-size)/2 + 3px)}' +
      '.tb-hex{width:var(--tb-size);height:var(--tb-size);clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:#1a2130;display:flex;align-items:center;justify-content:center;position:relative}' +
      '.tb-hex.tb-filled{background:#252d3d}' +
      '.tb-hex img{width:calc(100% - 6px);height:calc(100% - 6px);object-fit:cover;border-radius:50%}' +
      '.tb-hex .tb-txt{font-size:calc(var(--tb-size)*0.28);color:#8a94a3;font-weight:600}' +
      '.tb-eidos{display:flex;gap:6px;justify-content:center;margin-top:8px}' +
      '.tb-eido{width:calc(var(--tb-size)*0.8);height:calc(var(--tb-size)*0.8);border-radius:50%;border:1.5px solid #717D92;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#1a2130}' +
      '.tb-eido img{width:100%;height:100%;object-fit:cover}' +
      '.tb-eido .tb-txt{font-size:calc(var(--tb-size)*0.24);color:#8a94a3;font-weight:600}';
    document.head.appendChild(st);
  }
  const team = tcDecode(code);
  const slug = n => n.toLowerCase().replace(/[ .']/g, '');
  const byCell = {};
  const unitNames = [];
  team.units.forEach(u => {
    const ci = Math.floor(u.pos / 8), ri = (u.pos % 8) - 4;
    const name = tcUnitName[u.id] || null;
    unitNames.push(name);
    if (ri >= 0 && ri < 4 && ci >= 0 && ci < 7) byCell[ri + '-' + ci] = name || '?';
  });
  const board = document.createElement('div');
  board.className = 'tb-board';
  board.style.setProperty('--tb-size', size + 'px');
  for (let ri = 0; ri < 4; ri++) {
    const row = document.createElement('div');
    row.className = 'tb-row' + (ri % 2 ? ' tb-off' : '');
    for (let ci = 0; ci < 7; ci++) {
      const hex = document.createElement('div');
      hex.className = 'tb-hex';
      const name = byCell[ri + '-' + ci];
      if (name) {
        hex.classList.add('tb-filled');
        hex.title = name;
        if (name === '?') {
          hex.innerHTML = '<span class="tb-txt">?</span>';
        } else {
          const img = document.createElement('img');
          img.alt = name;
      
          img.src = '/hna/img/nexusanima/' + slug(name) + '.webp';
          img.onerror = function () { hex.innerHTML = '<span class="tb-txt">' + name.slice(0, 3) + '</span>'; };
          hex.appendChild(img);
        }
      }
      row.appendChild(hex);
    }
    board.appendChild(row);
  }
  const eidoNames = [];
  if (team.eidos.length) {
    const strip = document.createElement('div');
    strip.className = 'tb-eidos';
    team.eidos.forEach(e => {
      const name = tcEidoName[e.id] || null;
      eidoNames.push(name);
      const chip = document.createElement('div');
      chip.className = 'tb-eido';
      chip.title = name || 'Unknown Eidos';
      if (name) {
        const img = document.createElement('img');
        img.alt = name;
    
        img.src = '/hna/img/eidos/' + slug(name) + '.webp';
        img.onerror = function () { chip.innerHTML = '<span class="tb-txt">' + name.slice(0, 2) + '</span>'; };
        chip.appendChild(img);
      } else {
        chip.innerHTML = '<span class="tb-txt">?</span>';
      }
      strip.appendChild(chip);
    });
    board.appendChild(strip);
  }
  container.appendChild(board);
  return {units: unitNames, eidos: eidoNames};
}

// Verify + parse a full code. Returns {units:[{pos,id,lvl,rank}], eidos:[{id,thread}]}
// with eidos already in slot order, or throws with a user-safe message.
function tcDecode(code) {
  let payload, suffix;
  try {
    payload = tcB64ToBytes(code.slice(0, -8));
    suffix = tcB64ToBytes(code.slice(-8));
  } catch (e) { throw new Error('not a team code'); }
  const h = xxh32(payload, 0);
  const expect = (suffix[0] | (suffix[1] << 8) | (suffix[2] << 16) | (suffix[3] << 24)) >>> 0;
  if (suffix.length !== 4 || h !== expect) throw new Error('checksum mismatch');
  const units = [], eidos = [];
  tcParse(payload).forEach(([f, v]) => {
    if (f !== 11 && f !== 7) return;
    const d = {}; v.forEach(([k, val]) => { d[k] = val; });
    if (f === 11) units.push({pos: d[9], id: Math.floor((d[12] || 0) / 100), lvl: d[2], rank: d[10] || 0});
    else eidos.push({slot: d[13] || 0, id: d[2], thread: d[3] || 0});
  });
  eidos.sort((a, b) => a.slot - b.slot);
  return {units: units, eidos: eidos};
}
