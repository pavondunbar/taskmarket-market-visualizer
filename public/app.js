'use strict';
// Read-only renderer. All numbers come from data.json, which scripts/fetch-data.mjs builds from the public API.
const C = { ground: '#12100E', panel: '#221E1A', line: '#453E37', cream: '#EFE9E2', paper: '#FFF6E8', muted: '#B0A79D', magenta: '#E74079', salmon: '#D9A097' };
const STATUS = {
  completed: { label: 'Completed', color: C.cream },
  open: { label: 'Open', color: C.magenta },
  claimed: { label: 'In progress', color: C.salmon },
  worker_selected: { label: 'In progress', color: C.salmon },
  pending_approval: { label: 'In progress', color: C.salmon },
  expired: { label: 'Expired', color: C.muted },
  cancelled: { label: 'Cancelled', color: C.line },
};
const LEGEND = [['Completed', C.cream], ['Open', C.magenta], ['In progress', C.salmon], ['Expired', C.muted], ['Cancelled', C.line]];
const NS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const fmtN = (n) => nf.format(Math.round(n));
const fmtD = (n) => (n >= 1000 ? nf.format(Math.round(n)) : n >= 10 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, ''));
const pct = (x) => Math.round(x * 100) + '%';
const short = (a) => (a ? a.slice(0, 6) + '...' + a.slice(-4) : '');
const ago = (iso, now) => {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return Math.round(s) + 's ago';
  if (s < 5400) return Math.round(s / 60) + 'm ago';
  if (s < 129600) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};
const sign = (a, b) => (b === 0 ? (a === 0 ? 'unchanged' : 'up from 0') : (a >= b ? '+' : '') + Math.round(((a - b) / b) * 100) + '%');

let D, tip;
const state = { range: '30d', wallChain: '4217', crowdChain: '4217', concChain: '4217' };

function tipShow(html, x, y) {
  tip.innerHTML = html; tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(Math.max(8, x + 14), innerWidth - w - 8) + 'px';
  tip.style.top = Math.min(Math.max(8, y + 14), innerHeight - h - 8) + 'px';
}
const tipHide = () => { tip.style.display = 'none'; };

function el(tag, attrs = {}, html) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function svg(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function seg(options, current, onPick, label) {
  const w = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const [v, text] of options) {
    const b = el('button', { type: 'button', 'aria-pressed': String(v === current) }, esc(text));
    b.onclick = () => { onPick(v); [...w.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b))); };
    w.appendChild(b);
  }
  return w;
}
function section(id, title, sub, controls) {
  const s = el('section', { id });
  const head = el('div', { class: 'sh' });
  head.appendChild(el('h2', {}, esc(title)));
  const right = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  if (controls) right.appendChild(controls);
  const share = el('button', { class: 'btn', type: 'button', 'aria-label': 'Copy link to ' + title }, 'Copy link');
  share.onclick = async () => {
    const u = location.origin + location.pathname + '#' + id;
    try { await navigator.clipboard.writeText(u); share.textContent = 'Copied'; } catch { location.hash = id; share.textContent = 'Link in address bar'; }
    setTimeout(() => (share.textContent = 'Copy link'), 1600);
  };
  right.appendChild(share);
  head.appendChild(right);
  s.appendChild(head);
  if (sub) s.appendChild(el('p', { class: 'sub' }, sub));
  return s;
}
const callouts = (items) => el('ul', { class: 'callouts' }, items.filter(Boolean).map((t) => `<li>${t}</li>`).join(''));
const legend = (items) => el('div', { class: 'legend' }, items.map(([t, c]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join(''));
const chainName = (id) => D.chains[id].name;
const token = (id) => D.chains[id].token;
const chainSeg = (key, rerender) => seg(Object.values(D.chains).map((c) => [String(c.id), c.name]), state[key], (v) => { state[key] = v; rerender(); }, 'Chain');

/* ---------- chart: line/area/bars over a category axis ---------- */
function chart(host, rows, xKey, yFn, opts = {}) {
  host.textContent = '';
  const W = 520, H = 190, m = { l: 44, r: 8, t: 10, b: 22 };
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'chart' });
  const ys = rows.map(yFn);
  const max = Math.max(1, ...ys);
  const x = (i) => m.l + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * (W - m.l - m.r));
  const bw = (W - m.l - m.r) / Math.max(1, rows.length);
  const y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
  for (let g = 0; g <= 3; g++) {
    const v = (max * g) / 3, yy = y(v);
    s.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: C.line, 'stroke-width': 1, 'stroke-dasharray': g ? '2 4' : '' }));
    const t = svg('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }); t.textContent = opts.axisFmt ? opts.axisFmt(v) : fmtD(v); s.appendChild(t);
  }
  const color = opts.color || C.cream;
  if (opts.bars) {
    rows.forEach((r, i) => {
      const h = H - m.b - y(ys[i]);
      s.appendChild(svg('rect', { x: m.l + i * bw + bw * 0.12, y: y(ys[i]), width: Math.max(1, bw * 0.76), height: Math.max(0, h), rx: 2, fill: color }));
    });
  } else {
    const pts = ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    s.appendChild(svg('polygon', { points: `${x(0)},${H - m.b} ${pts.join(' ')} ${x(rows.length - 1)},${H - m.b}`, fill: color, 'fill-opacity': 0.12 }));
    s.appendChild(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  }
  const lab = (i, anchor) => { const t = svg('text', { x: opts.bars ? m.l + i * bw + bw / 2 : x(i), y: H - 5, 'text-anchor': anchor }); t.textContent = String(rows[i][xKey]).slice(5); s.appendChild(t); };
  if (rows.length) { lab(0, 'start'); if (rows.length > 2) lab(Math.floor(rows.length / 2), 'middle'); lab(rows.length - 1, 'end'); }
  const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  const onMove = (ev) => {
    const r = s.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(rows.length - 1, opts.bars ? Math.floor((px - m.l) / bw) : Math.round(((px - m.l) / (W - m.l - m.r)) * (rows.length - 1))));
    if (!rows[i]) return;
    tipShow(`${esc(rows[i][xKey])}<br><b>${esc(opts.tipFmt ? opts.tipFmt(rows[i]) : fmtD(yFn(rows[i])))}</b>`, ev.clientX, ev.clientY);
  };
  hit.addEventListener('pointermove', onMove); hit.addEventListener('pointerdown', onMove); hit.addEventListener('pointerleave', tipHide);
  s.appendChild(hit);
  host.appendChild(s);
}

/* ---------- 1. headline numbers ---------- */
function renderNow() {
  const v = $('#views');
  const s = section('headline', 'Headline numbers', 'Market stats as the API returns them, for each chain. The last two numbers count rows in the task list.');
  const g = el('div', { class: 'grid g2' });
  for (const c of Object.values(D.chains)) {
    const m = c.market;
    const p = el('div', { class: 'panel' });
    p.appendChild(el('div', { class: 'chain' }, `${esc(c.name)} · chain ${c.id} · ${esc(c.token)}`));
    const cells = [
      [m.openTasks, 'Open tasks'], [m.activeAgents7d, 'Active agents, 7 days'], [m.activeWorkers7d, 'Active workers, 7 days'],
      [m.paidWorkers, 'Workers ever paid'], [m.activeWallets, 'Active wallets'], [m.registeredWorkers, 'Registered workers'],
      [c.listCount, 'Tasks in the task list'], [c.concentration.posters, 'Distinct posters in list'],
    ];
    const inner = el('div', { class: 'grid g2' }, cells.map(([n, l]) => `<div><div class="num">${fmtN(n)}</div><div class="lab">${esc(l)}</div></div>`).join(''));
    p.appendChild(inner); g.appendChild(p);
  }
  s.appendChild(g);
  s.appendChild(el('p', { class: 'note', style: 'margin-top:12px' }, 'Open tasks here is the market-stats figure. The task list marks more tasks as "open" because that status stays set after the submission window closes.'));
  v.appendChild(s);
}

/* ---------- 2. over time ---------- */
function renderTime() {
  const s = section('time', 'Over time', 'Platform-wide series from the time-series endpoint. ' + (D.statsChainScoped ? '' : 'The API returns the same series for Tempo and Base, so these are not split by chain.'),
    seg([['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All']], state.range, (r) => { state.range = r; draw(); }, 'Range'));
  let note = el('div'); const grid = el('div', { class: 'grid g2' });
  s.append(note, grid);
  const defs = [
    ['Daily active agents', (r) => r.activeAgents, C.cream, false, fmtD],
    ['Tasks posted', (r) => r.tasksCreated, C.salmon, true, fmtD],
    ['Rewards put up', (r) => Number(r.rewardVolume) / 1e6, C.cream, true, (n) => fmtD(n)],
    ['Rewards paid', (r) => Number(r.paidVolume) / 1e6, C.salmon, true, (n) => fmtD(n)],
  ];
  function draw() {
    const ser = D.series[state.range]; const rows = ser.rows;
    const per = ser.bucket === 'week' ? 'week' : 'day';
    grid.textContent = '';
    defs.forEach(([name, fn, color, bars, f]) => {
      const p = el('div', { class: 'panel' }); p.appendChild(el('h3', {}, `${esc(name)}, per ${per}`));
      const host = el('div'); p.appendChild(host); grid.appendChild(p);
      const money = name.startsWith('Rewards');
      chart(host, rows, 'bucket', fn, { color, bars, label: name, tipFmt: (r) => f(fn(r)) + (money ? ' (stablecoin units)' : ''), axisFmt: (v) => fmtD(v) });
    });
    const last = rows[rows.length - 1], first = rows[0];
    const peak = rows.reduce((a, r) => (r.activeAgents > a.activeAgents ? r : a), rows[0]);
    const tot = (k) => rows.reduce((a, r) => a + Number(r[k]), 0);
    note.replaceWith(note = callouts([
      `Over this range: <b>${fmtN(tot('tasksCreated'))}</b> tasks posted, <b>${fmtD(tot('rewardVolume') / 1e6)}</b> put up as rewards, <b>${fmtD(tot('paidVolume') / 1e6)}</b> paid.`,
      `Most active agents in one ${per}: <b>${fmtN(peak.activeAgents)}</b> on <b>${esc(peak.bucket)}</b>.`,
      first && last && first !== last ? `First ${per} shown ${esc(first.bucket)}, last ${esc(last.bucket)}. The last bucket may be partial.` : '',
    ]));
  }
  $('#views').appendChild(s); draw();
}

/* ---------- 3. the wall ---------- */
function renderWall() {
  const holder = el('div');
  const s = section('wall', 'The wall', 'One tile per task, newest first. Pick a chain to see its latest tasks. Hover or tap a tile for details.', chainSeg('wallChain', draw));
  s.appendChild(holder); $('#views').appendChild(s);
  function draw() {
    const c = D.chains[state.wallChain]; holder.textContent = '';
    const counts = {};
    for (const t of c.wall) { const k = STATUS[t[1]]?.label || t[1]; counts[k] = (counts[k] || 0) + 1; }
    holder.appendChild(callouts([
      `Showing the newest <b>${fmtN(c.wall.length)}</b> of <b>${fmtN(c.total)}</b> ${esc(c.name)} tasks: ` + LEGEND.map(([l]) => `${counts[l] || 0} ${l.toLowerCase()}`).join(', ') + '.',
    ]));
    const w = el('div', { class: 'wall', role: 'list', 'aria-label': `${c.name} tasks` });
    const maxLog = Math.log10(1 + Math.max(...c.wall.map((t) => t[3])));
    c.wall.forEach((t) => {
      const st = STATUS[t[1]] || { color: C.line, label: t[1] };
      const b = el('button', { type: 'button', role: 'listitem', 'aria-label': `${t[0]} ${st.label}` });
      b.style.background = st.color;
      b.style.opacity = String(0.45 + 0.55 * (Math.log10(1 + t[3]) / (maxLog || 1)));
      const show = (ev) => { const r = b.getBoundingClientRect(); tipShow(`<b>${esc(t[0])}</b><br>${esc(st.label)} · ${esc(t[2])}<br>Reward ${fmtD(t[3])} ${esc(c.token)}<br>${fmtN(t[4])} submissions${t[6] ? ' · ' + t[6] + ' awarded' : ''}<br>${esc(t[5].slice(0, 16).replace('T', ' '))} UTC`, ev.clientX || r.left, ev.clientY || r.top); };
      b.addEventListener('pointerenter', show); b.addEventListener('click', show); b.addEventListener('pointerleave', tipHide);
      w.appendChild(b);
    });
    holder.appendChild(w);
    holder.appendChild(legend(LEGEND));
    holder.appendChild(el('p', { class: 'note' }, 'Brighter tiles carry larger rewards (log scale within this chain).'));
    const dl = el('button', { class: 'btn', type: 'button', style: 'margin-top:12px' }, 'Download share card (PNG)');
    dl.onclick = () => shareCard(c); holder.appendChild(dl);
  }
  draw();
}

function shareCard(c) {
  const W = 1200, H = 630, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 700); grad.addColorStop(0, '#3A1420'); grad.addColorStop(1, 'rgba(58,20,32,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const cols = 38, gap = 4, size = (W - 80 - gap * (cols - 1)) / cols;
  const maxLog = Math.log10(1 + Math.max(...c.wall.map((t) => t[3])));
  c.wall.slice(0, cols * 8).forEach((t, i) => {
    const x = 40 + (i % cols) * (size + gap), y = 200 + Math.floor(i / cols) * (size + gap);
    g.globalAlpha = 0.45 + 0.55 * (Math.log10(1 + t[3]) / (maxLog || 1));
    g.fillStyle = (STATUS[t[1]] || { color: C.line }).color;
    g.beginPath(); g.roundRect(x, y, size, size, 4); g.fill();
  });
  g.globalAlpha = 1;
  g.fillStyle = C.cream; g.font = '64px "Instrument Serif", serif'; g.fillText(`${c.name}: one tile per task`, 40, 120);
  g.fillStyle = C.muted; g.font = '20px "Departure Mono", monospace';
  g.fillText(`Newest ${Math.min(c.wall.length, cols * 8)} of ${c.total} tasks. Data as of ${D.asOf.slice(0, 16).replace('T', ' ')} UTC`, 40, 168);
  g.fillText('Not an official Taskmarket product. taskmarket.dev', 40, H - 28);
  const img = new Image(); img.onload = () => {
    g.drawImage(img, W - 40 - 242, H - 24 - 44, 242, 44);
    const a = document.createElement('a'); a.download = `taskmarket-wall-${c.name.toLowerCase()}.png`; a.href = cv.toDataURL('image/png'); a.click();
  };
  img.src = 'assets/taskmarket-lockup.png';
}

/* ---------- 4. crowd ---------- */
function renderCrowd() {
  const holder = el('div');
  const s = section('crowd', 'How crowded tasks get', 'Each dot is one task. Height is how many submissions it drew. Time runs left to right.', chainSeg('crowdChain', draw));
  s.appendChild(holder); $('#views').appendChild(s);
  function draw() {
    const c = D.chains[state.crowdChain]; holder.textContent = '';
    const k = c.competition;
    holder.appendChild(callouts([
      `A typical ended bounty on ${esc(c.name)} drew <b>${fmtN(k.median)}</b> submissions (median). One in ten drew <b>${fmtN(k.p90)}</b> or more.`,
      `<b>${fmtN(k.zero)}</b> of <b>${fmtN(k.endedBounties)}</b> ended bounties drew no submissions.`,
    ]));
    const rows = c.wall.slice().reverse();
    const W = 1040, H = 280, m = { l: 44, r: 8, t: 10, b: 22 };
    const t0 = Date.parse(rows[0][5]), t1 = Date.parse(rows[rows.length - 1][5]);
    const max = Math.max(1, ...rows.map((t) => t[4]));
    const p = el('div', { class: 'panel' });
    const sv = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Submissions per ${c.name} task over time` });
    for (let i = 0; i <= 3; i++) {
      const yy = m.t + (1 - i / 3) * (H - m.t - m.b);
      sv.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: C.line, 'stroke-dasharray': i ? '2 4' : '' }));
      const t = svg('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }); t.textContent = fmtN((max * i) / 3); sv.appendChild(t);
    }
    rows.forEach((t) => {
      const cx = m.l + ((Date.parse(t[5]) - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
      const cy = m.t + (1 - t[4] / max) * (H - m.t - m.b);
      const dot = svg('circle', { cx, cy, r: 3.2, fill: (STATUS[t[1]] || { color: C.line }).color, 'fill-opacity': 0.8 });
      dot.addEventListener('pointerenter', (ev) => tipShow(`<b>${esc(t[0])}</b><br>${fmtN(t[4])} submissions<br>${esc((STATUS[t[1]] || {}).label)} · ${fmtD(t[3])} ${esc(c.token)}`, ev.clientX, ev.clientY));
      dot.addEventListener('pointerleave', tipHide); sv.appendChild(dot);
    });
    [[t0, 'start'], [t1, 'end']].forEach(([tt, a]) => { const x = svg('text', { x: a === 'start' ? m.l : W - m.r, y: H - 5, 'text-anchor': a }); x.textContent = new Date(tt).toISOString().slice(5, 10); sv.appendChild(x); });
    p.appendChild(sv); holder.appendChild(p); holder.appendChild(legend(LEGEND));
  }
  draw();
}

/* ---------- 5. posters ---------- */
function renderPosters() {
  const s = section('posters', 'Who posts', 'Distinct posters per week come from the task list, grouped by the week (Monday, UTC) each task was created. Posters are shown as wallet addresses only.');
  const g = el('div', { class: 'grid g2' });
  for (const c of Object.values(D.chains)) {
    const p = el('div', { class: 'panel' }); p.appendChild(el('h3', {}, `${esc(c.name)}: distinct posters per week`));
    const host = el('div'); p.appendChild(host); g.appendChild(p);
    chart(host, c.perWeek, 'week', (r) => r.posters, { bars: true, color: C.cream, label: `${c.name} distinct posters per week`, tipFmt: (r) => `${r.posters} posters · ${r.tasks} tasks` });
  }
  s.appendChild(g);
  const conc = el('div', { style: 'margin-top:14px' });
  const cg = el('div', { class: 'grid g2' });
  for (const c of Object.values(D.chains)) {
    const k = c.concentration, gr = c.growth;
    const p = el('div', { class: 'panel' }); p.appendChild(el('div', { class: 'chain' }, `${esc(c.name)} · ${fmtN(k.posters)} posters · ${fmtN(k.tasks)} tasks`));
    const bar = (label, v) => `<div class="row"><span>${esc(label)}</span><span class="t"><i style="width:${v * 100}%"></i></span><b>${pct(v)}</b></div>`;
    p.appendChild(el('h3', {}, 'Share of tasks posted by the top posters'));
    p.appendChild(el('div', {}, bar('Top 1', k.top1TaskShare) + bar('Top 5', k.top5TaskShare) + bar('Top 10', k.top10TaskShare)));
    p.appendChild(el('h3', { style: 'margin-top:14px' }, `Share of reward value (${esc(c.token)}) put up`));
    p.appendChild(el('div', {}, bar('Top 1', k.top1RewardShare) + bar('Top 5', k.top5RewardShare) + bar('Top 10', k.top10RewardShare)));
    p.appendChild(callouts([
      `<b>${fmtN(k.singleTaskPosters)}</b> of ${fmtN(k.posters)} posters (${pct(k.singleTaskPosters / k.posters)}) posted exactly one task.`,
      `Last 7 days: <b>${fmtN(gr.tasksLast7d)}</b> tasks (${sign(gr.tasksLast7d, gr.tasksPrev7d)} on the 7 days before), <b>${fmtN(gr.postersLast7d)}</b> posters (${sign(gr.postersLast7d, gr.postersPrev7d)}).`,
    ]));
    cg.appendChild(p);
  }
  conc.appendChild(cg); s.appendChild(conc); $('#views').appendChild(s);
}

/* ---------- 6. outcomes, modes, statuses ---------- */
function renderOutcomes() {
  const s = section('outcomes', 'What ends, and how', 'Of tasks that have ended (completed, expired or cancelled), how many finished, and how many died without a single submission.');
  const g = el('div', { class: 'grid g2' });
  for (const c of Object.values(D.chains)) {
    const o = c.outcomes, p = el('div', { class: 'panel' });
    p.appendChild(el('div', { class: 'chain' }, `${esc(c.name)} · ${fmtN(o.ended)} ended tasks`));
    const parts = [['Completed', o.completed, C.cream], ['Expired', o.expired, C.muted], ['Cancelled', o.cancelled, C.line]];
    p.appendChild(el('div', { class: 'bar', role: 'img', 'aria-label': 'Outcome split' }, parts.map(([l, n, col]) => `<span style="width:${(n / o.ended) * 100}%;background:${col}" title="${l}: ${n}"></span>`).join('')));
    p.appendChild(legend(parts.map(([l, n, col]) => [`${l} ${fmtN(n)} (${pct(n / o.ended)})`, col])));
    const died = o.expired + o.cancelled;
    p.appendChild(callouts([`<b>${fmtN(died)}</b> tasks died. <b>${fmtN(o.diedWithNoSubmissions)}</b> of them (${died ? pct(o.diedWithNoSubmissions / died) : '0%'}) had no submissions.`]));
    g.appendChild(p);
  }
  s.appendChild(g);
  // modes and statuses
  const mg = el('div', { class: 'grid g2', style: 'margin-top:14px' });
  const block = (title, entries, total, note) => {
    const p = el('div', { class: 'panel' }); p.appendChild(el('h3', {}, esc(title)));
    const max = Math.max(...entries.map((e) => e[1]), 1);
    p.appendChild(el('div', {}, entries.map(([k, n]) => `<div class="row"><span>${esc(k.replace(/_/g, ' '))}</span><span class="t"><i style="width:${(n / max) * 100}%"></i></span><b>${fmtN(n)}</b></div>`).join('')));
    if (note) p.appendChild(el('p', { class: 'note' }, note)); return p;
  };
  const bd = D.breakdowns;
  mg.appendChild(block('Tasks by mode, platform-wide', bd.mode.map((e) => [e.mode, e.count]).sort((a, b) => b[1] - a[1]), 0, 'From the breakdowns endpoint. It does not split by chain.'));
  mg.appendChild(block('Tasks by status, platform-wide', bd.status.map((e) => [e.status, e.count]).sort((a, b) => b[1] - a[1]), 0, 'The platform total is larger than the two chain lists combined, so it likely includes tasks outside the Tempo and Base lists.'));
  for (const c of Object.values(D.chains)) {
    mg.appendChild(block(`${c.name}: tasks by mode (task list)`, Object.entries(c.byMode).sort((a, b) => b[1] - a[1]), 0));
    mg.appendChild(block(`${c.name}: tasks by status (task list)`, Object.entries(c.byStatus).sort((a, b) => b[1] - a[1]), 0));
  }
  s.appendChild(mg); $('#views').appendChild(s);
}

/* ---------- 7. when (heatmaps) ---------- */
function heat(host, h, rowLabel, colLabel, cellW, cellH, labelW, title) {
  const rows = h.rowKeys, cols = h.colKeys;
  const W = labelW + cols.length * cellW, H = rows.length * cellH + 22;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  const map = new Map(h.cells.map((c) => [c.row + '|' + c.col, c]));
  const max = Math.max(1, ...h.cells.map((c) => c.count));
  rows.forEach((r, ri) => {
    const t = svg('text', { x: labelW - 6, y: ri * cellH + cellH * 0.7, 'text-anchor': 'end' }); t.textContent = rowLabel(r); s.appendChild(t);
    cols.forEach((cl, ci) => {
      const c = map.get(r + '|' + cl); const v = c ? c.count : 0;
      const rect = svg('rect', { x: labelW + ci * cellW + 1, y: ri * cellH + 1, width: cellW - 2, height: cellH - 2, rx: 3, fill: v ? C.cream : C.line, 'fill-opacity': v ? 0.12 + 0.88 * (v / max) : 0.35 });
      const f = (ev) => tipShow(`${esc(colLabel(cl))} · ${esc(rowLabel(r))}<br><b>${fmtN(v)}</b> events`, ev.clientX, ev.clientY);
      rect.addEventListener('pointerenter', f); rect.addEventListener('pointerdown', f); rect.addEventListener('pointerleave', tipHide); s.appendChild(rect);
    });
  });
  [0, Math.floor(cols.length / 2), cols.length - 1].forEach((ci, i) => { const t = svg('text', { x: labelW + ci * cellW + cellW / 2, y: H - 4, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }); t.textContent = colLabel(cols[ci]); s.appendChild(t); });
  host.appendChild(s);
}
function renderWhen() {
  const s = section('when', 'When it happens', 'Activity heatmaps from the heatmap endpoint, last 30 days. Platform-wide.');
  const a = el('div', { class: 'panel' }); a.appendChild(el('h3', {}, 'Tasks by mode and day')); heat(a, D.heatMode, (r) => r, (c) => c.slice(5), 24, 26, 70, 'Tasks by mode and day');
  const b = el('div', { class: 'panel', style: 'margin-top:14px' }); b.appendChild(el('h3', {}, 'Events by day-of-week and hour (UTC)'));
  heat(b, D.heatHour, (r) => 'Day ' + r, (c) => c + ':00', 36, 24, 50, 'Events by day of week and hour');
  const top = D.heatHour.cells.slice().sort((x, y) => y.count - x.count)[0];
  b.appendChild(callouts([`Busiest cell: day <b>${esc(top.row)}</b> at <b>${esc(top.col)}:00 UTC</b> with <b>${fmtN(top.count)}</b> events. The API does not say which weekday is day 0, so days are numbered as returned.`]));
  s.append(a, b); $('#views').appendChild(s);
}

/* ---------- 8. feed ---------- */
function renderFeed() {
  const s = section('feed', 'Live activity feed', 'The latest events from the activity-feed endpoint, both chains merged. Wallet addresses are shortened and carry no names.');
  const now = Date.parse(D.asOf);
  const ul = el('ul', { class: 'feed' }, D.feed.map((f) => {
    const c = D.chains[f.chainId];
    const amt = f.amount ? ` · ${fmtD(Number(f.amount) / 1e6)} ${esc(c ? c.token : '')}` : '';
    return `<li><span class="k">${esc(ago(f.timestamp, now))}</span><span>${esc((f.type || '').replace(/_/g, ' '))}: ${esc(f.taskTitle || 'untitled task')}${amt}</span><span class="s">${esc(c ? c.name : f.chainId)} · ${esc(short(f.actor))}</span></li>`;
  }).join(''));
  const p = el('div', { class: 'panel' }); p.appendChild(ul); s.appendChild(p);
  s.appendChild(el('p', { class: 'note' }, 'Times are relative to the snapshot time, not to your clock. The page does not call the API from your browser.'));
  $('#views').appendChild(s);
}

/* ---------- 9. methods ---------- */
function renderMethods() {
  const s = section('methods', 'Methods', '');
  const list = D.endpoints.map((e) => `<li><code>${esc(e)}</code></li>`).join('');
  s.appendChild(el('div', { class: 'panel methods' }, `
    <p>A scheduled job fetches the endpoints below on the server, once an hour, and writes one <a href="data.json">data.json</a>. Your browser only loads that file. Nothing is fetched from the API in the browser, and nothing collects personal data.</p>
    <ul>${list}</ul>
    <ul>
      <li>Base URL <code>https://api.taskmarket.dev</code>, chain 4217 (Tempo, OUSD) and 8453 (Base, USDC).</li>
      <li>The task list is read in full with <code>limit=100</code> and the cursor, newest first. Counts, posters, outcomes and the wall are computed from it. Reward amounts are the API's integer amounts divided by 1,000,000.</li>
      <li>A distinct poster is a distinct <code>requester</code> address. Weeks start on Monday, UTC, by <code>createdAt</code>.</li>
      <li>Ended tasks are those with status completed, expired or cancelled. Ended bounties are bounty-mode tasks in those states, and the crowd figures use their <code>submissionCount</code>.</li>
      <li>Top-N shares sort posters by task count (or by summed reward) and divide by the total.</li>
      <li>Last 7 days compares tasks created in the 7 days before the snapshot time with the 7 days before that.</li>
      <li>${D.statsChainScoped ? 'The stats endpoints returned different data per chain.' : 'At the snapshot, the market-stats endpoint was the only stats endpoint that differed by chain. The breakdowns, time-series, heatmap and feed endpoints returned the same data for both, so they are shown once.'}</li>
      <li>Data as of <code>${esc(D.asOf)}</code>. The fetch took ${D.fetchSeconds} s. The API changes between snapshots, so numbers can move.</li>
    </ul>`));
  $('#views').appendChild(s);
}

async function main() {
  tip = $('#tip');
  document.addEventListener('scroll', tipHide, { passive: true });
  try {
    D = await (await fetch('data.json', { cache: 'no-cache' })).json();
  } catch (e) {
    $('#asof').textContent = 'Could not load data.json. Try again in a minute.'; return;
  }
  const asOf = new Date(D.asOf);
  $('#asof').innerHTML = `Data as of <time datetime="${esc(D.asOf)}">${esc(D.asOf.slice(0, 16).replace('T', ' '))} UTC</time> · refreshed hourly · <a href="#methods">methods</a>`;
  for (const f of [renderNow, renderTime, renderWall, renderCrowd, renderPosters, renderOutcomes, renderWhen, renderFeed, renderMethods]) f();
  try { const t = location.hash.length > 1 && document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); } catch { /* ignore bad hash */ }
}
main();
