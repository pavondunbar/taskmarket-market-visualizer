// Fetches Taskmarket public API data on the server and writes public/data.json.
// Run hourly by .github/workflows/refresh.yml. No dependencies (Node 20+).
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.taskmarket.dev';
const CHAINS = [
  { id: 4217, name: 'Tempo', token: 'OUSD' },
  { id: 8453, name: 'Base', token: 'USDC' },
];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data.json');

async function get(path, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw err;
}

// Monday (UTC) of the week containing an ISO timestamp, as YYYY-MM-DD.
function weekOf(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
const dayOf = (iso) => iso.slice(0, 10);
const sum = (a) => a.reduce((x, y) => x + y, 0);
function share(sortedDesc, n, total) {
  return total ? sum(sortedDesc.slice(0, n)) / total : 0;
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

async function allTasks(chainId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const q = `/api/tasks?chainId=${chainId}&sort=newest&limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const j = await get(q);
    out.push(...j.tasks);
    if (!j.hasMore || !j.nextCursor) return out;
    cursor = j.nextCursor;
  }
  throw new Error('pagination did not terminate');
}

function analyse(tasks, nowMs) {
  const byStatus = {}, byMode = {};
  const posterTasks = new Map(), posterReward = new Map();
  const weeks = new Map();
  const days = new Map();
  for (const t of tasks) {
    const reward = Number(t.reward) / 1e6;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byMode[t.mode] = (byMode[t.mode] || 0) + 1;
    posterTasks.set(t.requester, (posterTasks.get(t.requester) || 0) + 1);
    posterReward.set(t.requester, (posterReward.get(t.requester) || 0) + reward);
    const w = weekOf(t.createdAt);
    const row = weeks.get(w) || { week: w, tasks: 0, reward: 0, posters: new Set() };
    row.tasks++; row.reward += reward; row.posters.add(t.requester);
    weeks.set(w, row);
    const d = dayOf(t.createdAt);
    const dr = days.get(d) || { day: d, tasks: 0, reward: 0 };
    dr.tasks++; dr.reward += reward;
    days.set(d, dr);
  }
  const perWeek = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
    .map((r) => ({ week: r.week, tasks: r.tasks, reward: r.reward, posters: r.posters.size }));
  const tcounts = [...posterTasks.values()].sort((a, b) => b - a);
  const rcounts = [...posterReward.values()].sort((a, b) => b - a);
  const totalReward = sum(rcounts);
  const concentration = {
    posters: posterTasks.size,
    tasks: tasks.length,
    totalReward,
    singleTaskPosters: tcounts.filter((c) => c === 1).length,
    top1TaskShare: share(tcounts, 1, tasks.length),
    top5TaskShare: share(tcounts, 5, tasks.length),
    top10TaskShare: share(tcounts, 10, tasks.length),
    top1RewardShare: share(rcounts, 1, totalReward),
    top5RewardShare: share(rcounts, 5, totalReward),
    top10RewardShare: share(rcounts, 10, totalReward),
  };
  // Outcomes among tasks that have reached an end state.
  const ended = tasks.filter((t) => ['completed', 'expired', 'cancelled'].includes(t.status));
  const died = ended.filter((t) => t.status !== 'completed');
  const outcomes = {
    ended: ended.length,
    completed: ended.length - died.length,
    expired: ended.filter((t) => t.status === 'expired').length,
    cancelled: ended.filter((t) => t.status === 'cancelled').length,
    diedWithNoSubmissions: died.filter((t) => !t.submissionCount).length,
  };
  // Competition on bounties that have ended.
  const subs = tasks.filter((t) => t.mode === 'bounty' && ['completed', 'expired', 'cancelled'].includes(t.status))
    .map((t) => t.submissionCount || 0).sort((a, b) => a - b);
  const competition = {
    endedBounties: subs.length,
    median: quantile(subs, 0.5),
    p90: quantile(subs, 0.9),
    mean: subs.length ? sum(subs) / subs.length : 0,
    zero: subs.filter((n) => n === 0).length,
  };
  // Week-over-week, using rolling 7-day windows ending at the snapshot time.
  const DAY = 864e5;
  const win = (from, to) => tasks.filter((t) => { const m = Date.parse(t.createdAt); return m >= nowMs - from * DAY && m < nowMs - to * DAY; });
  const cur = win(7, 0), prev = win(14, 7);
  const growth = {
    tasksLast7d: cur.length, tasksPrev7d: prev.length,
    postersLast7d: new Set(cur.map((t) => t.requester)).size,
    postersPrev7d: new Set(prev.map((t) => t.requester)).size,
    rewardLast7d: sum(cur.map((t) => Number(t.reward) / 1e6)),
    rewardPrev7d: sum(prev.map((t) => Number(t.reward) / 1e6)),
  };
  // Compact per-task rows for the wall: [code, status, mode, reward, submissions, createdAt, awards]
  const wall = tasks.slice(0, 900).map((t) => [t.referenceCode, t.status, t.mode, Number(t.reward) / 1e6, t.submissionCount || 0, t.createdAt, t.awardCount || 0]);
  return { total: tasks.length, byStatus, byMode, perWeek, perDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), concentration, outcomes, competition, growth, wall };
}

const feedKey = (i) => [i.type, i.timestamp, i.taskId, i.actor].join('|');

async function main() {
  const t0 = Date.now();
  const endpoints = [];
  const note = (p) => { endpoints.push(p); return p; };

  const [market, breakdowns, tasksByChain, feeds] = await Promise.all([
    Promise.all(CHAINS.map((c) => get(note(`/api/market/stats?chainId=${c.id}`)))),
    Promise.all(CHAINS.map((c) => get(note(`/api/stats/breakdowns?chainId=${c.id}`)))),
    Promise.all(CHAINS.map((c) => allTasks(c.id))),
    Promise.all(CHAINS.map((c) => get(note(`/api/stats/activity-feed?chainId=${c.id}&limit=50`)))),
  ]);
  const asOfMs = Date.now();

  const series = {};
  for (const [range, bucket] of [['7d', 'day'], ['30d', 'day'], ['90d', 'day'], ['all', 'week']]) {
    const p = `/api/stats/platform-time-series?chainId=4217&range=${range}&bucket=${bucket}`;
    series[range] = { bucket, rows: await get(note(p)) };
  }
  // Check whether the stats endpoints depend on chainId at all.
  const [s7a, s7b] = await Promise.all(CHAINS.map((c) => get(`/api/stats/platform-time-series?chainId=${c.id}&range=7d&bucket=day`)));
  const statsChainScoped = JSON.stringify(s7a) !== JSON.stringify(s7b) || JSON.stringify(breakdowns[0]) !== JSON.stringify(breakdowns[1]);

  const heatMode = await get(note('/api/stats/activity-heatmap?chainId=4217&range=30d&dimension=mode'));
  const heatHour = await get(note('/api/stats/activity-heatmap?chainId=4217&range=30d&dimension=hourOfWeek'));

  const seen = new Set();
  const feed = feeds.flatMap((f) => f.items || []).filter((i) => {
    const k = feedKey(i); if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 40)
    .map(({ type, timestamp, taskTitle, chainId, actor, actorType, amount, rating }) => ({ type, timestamp, taskTitle, chainId, actor, actorType, amount, rating }));

  const chains = {};
  CHAINS.forEach((c, i) => {
    chains[c.id] = { ...c, market: market[i], listCount: tasksByChain[i].length, ...analyse(tasksByChain[i], asOfMs) };
  });

  const data = {
    asOf: new Date(asOfMs).toISOString(),
    fetchSeconds: Math.round((asOfMs - t0) / 1000),
    statsChainScoped,
    chains,
    breakdowns: breakdowns[0],
    series,
    heatMode, heatHour,
    feed,
    endpoints: [...new Set(endpoints.map((e) => e.split('?')[0]).concat('/api/tasks'))],
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log(`wrote ${OUT} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB) in ${data.fetchSeconds}s; stats chain-scoped: ${statsChainScoped}`);
  for (const c of CHAINS) console.log(c.name, 'tasks listed:', chains[c.id].listCount);
}

main().catch((e) => { console.error(e); process.exit(1); });
