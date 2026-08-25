'use strict';

/** Seeded mulberry32 — same contract as lib/rng.js */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    normal(mu, sd) {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    bernoulli: (p) => next() < p,
  };
}

const DARK = new Set([
  'S03', 'S10', 'S13', 'S14', 'S15', 'S20', 'S21', 'S23', 'S26', 'S32', 'S33', 'S39',
]);

function padId(i) {
  return 'S' + String(i + 1).padStart(2, '0');
}

function stdTime(i) {
  const id = i + 1;
  if (id === 22) return 53;
  if (id === 19 || id === 28) return 51;
  if (id === 7 || id === 11 || id === 25) return 50;
  if (id === 2 || id === 8 || id === 16 || id === 30 || id === 35) return 49;
  if (id === 1 || id === 40) return 46;
  if ([4, 5, 9, 12, 17, 18, 24, 27, 31, 36, 37].includes(id)) return 47;
  return 48;
}

const state = {
  persona: 'supervisor',
  running: false,
  t: 0,
  tick: 0,
  drift: 8,
  coverage: 70,
  buffer: 4,
  bn: 'S22',
  history: [],
  alerts: [],
  oee: [],
  forecast: [],
  results: null,
  rng: makeRng(20260822),
};

function instrumented(id) {
  if (DARK.has(id)) return false;
  // coverage slider dims some otherwise-instrumented stations
  const n = parseInt(id.slice(1), 10);
  const keep = Math.round((state.coverage / 100) * 28);
  const order = [];
  for (let i = 1; i <= 40; i++) {
    const sid = padId(i - 1);
    if (!DARK.has(sid)) order.push(sid);
  }
  return order.indexOf(id) < keep;
}

function buildLine() {
  const el = document.getElementById('line');
  el.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const id = padId(i);
    const d = document.createElement('div');
    d.className = 'st' + (instrumented(id) ? '' : ' dark');
    d.dataset.id = id;
    d.title = id + (instrumented(id) ? '' : ' (dark)');
    el.appendChild(d);
  }
}

function setPersona(name) {
  state.persona = name;
  document.querySelectorAll('.persona').forEach((btn) => {
    const on = btn.dataset.persona === name;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const show = (panel.dataset.show || '').split(/\s+/);
    panel.hidden = !show.includes(name);
  });
}

function paintStations(busyId, warnIds) {
  document.querySelectorAll('.st').forEach((el) => {
    const id = el.dataset.id;
    el.classList.toggle('busy', id === busyId || state.rng.bernoulli(0.15));
    el.classList.toggle('bn', id === state.bn);
    el.classList.toggle('warn', warnIds.has(id));
    el.classList.toggle('dark', !instrumented(id));
  });
}

function updateForecast() {
  // Softmax-ish probs from std times + drift toward S07 when drift high
  const scores = [];
  for (let i = 0; i < 40; i++) {
    const id = padId(i);
    let s = stdTime(i);
    if (id === 'S07') s += state.drift * 0.35;
    if (id === 'S22') s += 2.2;
    if (id === 'S28') s += 1.4;
    if (id === 'S19') s += 1.1;
    if (!instrumented(id)) s *= 0.92;
    scores.push({ id, s });
  }
  const max = Math.max(...scores.map((x) => x.s));
  const exps = scores.map((x) => ({ id: x.id, v: Math.exp((x.s - max) / 2.2) }));
  const sum = exps.reduce((a, b) => a + b.v, 0);
  state.forecast = exps
    .map((x) => ({ id: x.id, p: x.v / sum }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 6);

  const host = document.getElementById('forecast-bars');
  host.innerHTML = '';
  for (const row of state.forecast) {
    const div = document.createElement('div');
    div.className = 'bar-row';
    div.innerHTML = `<span>${row.id}</span><div class="bar-track"><div class="bar-fill" style="width:${(row.p * 100).toFixed(1)}%"></div></div><span>${(row.p * 100).toFixed(0)}%</span>`;
    host.appendChild(div);
  }
  state.bn = state.forecast[0].id;
}

function maybeAlert() {
  if (state.drift < 4) return;
  if (!state.rng.bernoulli(0.08 + state.drift / 200)) return;
  const gun = Math.floor(state.rng.next() * 4);
  const score = 0.55 + state.rng.next() * 0.4;
  state.alerts.unshift({
    t: state.t,
    text: `[mockup] S07 gun ${gun}  score ${score.toFixed(2)}  DR drift down`,
  });
  state.alerts = state.alerts.slice(0, 8);
  const ul = document.getElementById('alerts');
  ul.innerHTML = state.alerts.map((a) => `<li>${fmtT(a.t)}  ${a.text}</li>`).join('');
  document.getElementById('action').textContent =
    'Recommended: dress tip on S07 gun 0 — projected escape window ' +
    Math.max(8, 44 - state.drift).toFixed(0) +
    ' units';
}

function fmtT(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateMigrate() {
  const ids = ['S19', 'S22', 'S28', 'S07'];
  state.history.push(state.bn);
  if (state.history.length > 24) state.history.shift();
  const host = document.getElementById('migrate');
  host.innerHTML = state.history
    .map((id) => `<span class="chip ${ids.includes(id) ? 'on' : ''}">${id}</span>`)
    .join('');
}

function updateVOI() {
  const base = (state.results && state.results.day6_virtual && state.results.day6_virtual.voiTop5) || [
    { station: 'S14', voi: 3.2 },
    { station: 'S21', voi: 2.7 },
    { station: 'S33', voi: 2.1 },
    { station: 'S15', voi: 1.8 },
    { station: 'S03', voi: 1.4 },
  ];
  const ol = document.getElementById('voi');
  ol.innerHTML = base
    .slice(0, 5)
    .map((r, i) => `<li>${r.station} — Δvar ${(r.voi || (3 - i * 0.4)).toFixed(2)}  (instrument next)</li>`)
    .join('');
}

function updateCalib() {
  const v = state.results && state.results.day6_virtual;
  const el = document.getElementById('calib');
  const sub = document.getElementById('calib-sub');
  if (v) {
    el.textContent = v.overallPct.toFixed(1) + '%';
    sub.textContent = v.sentence || '80% band coverage of dark CT';
  } else {
    el.textContent = '—';
    sub.textContent = 'Run calibrate_virtual.js to populate';
  }
}

function drawPayback(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(232,196,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(40, h - 30);
  ctx.lineTo(w - 10, h - 30);
  ctx.moveTo(40, 10);
  ctx.lineTo(40, h - 30);
  ctx.stroke();
  const far = (state.results && state.results.day5_detectors && state.results.day5_detectors.operating.far) || 0.02;
  const lead = (state.results && state.results.day4_leadtime && state.results.day4_leadtime.medianMin) || 12;
  ctx.strokeStyle = '#9d00f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const months = i;
    const salvage = Math.max(0, 1 - far * 8) * (lead / 12) * months * 0.045;
    const x = 40 + (months / 36) * (w - 60);
    const y = h - 30 - Math.min(h - 50, salvage * (h - 50));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#a890c0';
  ctx.font = '12px "IBM Plex Mono"';
  ctx.fillText('months →', w - 90, h - 10);
  ctx.fillText('cumulative payback', 50, 24);
}

function drawOee(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (state.oee.length < 2) return;
  ctx.strokeStyle = '#9d00f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  state.oee.forEach((v, i) => {
    const x = (i / Math.max(1, state.oee.length - 1)) * (w - 20) + 10;
    const y = h - 20 - v * (h - 40);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function tick() {
  if (!state.running) return;
  state.tick += 1;
  state.t += 15 + state.buffer; // abstract seconds
  updateForecast();
  const warn = new Set(state.alerts.slice(0, 3).map(() => 'S07'));
  paintStations(state.bn, warn);
  document.getElementById('bn-now').textContent = state.bn;
  document.getElementById('bn-sub').textContent =
    'P(bn) ' + ((state.forecast[0] && state.forecast[0].p * 100) || 0).toFixed(0) +
    '% · buffer ' + state.buffer + ' · t=' + fmtT(state.t);
  maybeAlert();
  updateMigrate();
  const util = 0.78 + 0.08 * Math.sin(state.tick / 17) - state.drift * 0.002;
  state.oee.push(Math.max(0.55, Math.min(0.95, util)));
  if (state.oee.length > 48) state.oee.shift();
  const oee = document.getElementById('oee');
  if (oee && !oee.closest('.panel').hidden) drawOee(oee.getContext('2d'));
  const pay = document.getElementById('payback');
  if (pay && !pay.closest('.panel').hidden) drawPayback(pay.getContext('2d'));
  requestAnimationFrame(() => setTimeout(tick, 420));
}

async function loadResults() {
  const snip = document.getElementById('results-snip');
  try {
    const res = await fetch('../results.json');
    if (!res.ok) throw new Error('missing');
    state.results = await res.json();
    snip.textContent = JSON.stringify(
      {
        day2: state.results.day2,
        day4_leadtime: state.results.day4_leadtime,
        day5_detectors: state.results.day5_detectors,
        day6_virtual: state.results.day6_virtual,
        day7_apm: state.results.day7_apm,
      },
      null,
      2
    );
  } catch (_) {
    snip.textContent = 'results.json not reachable from file:// — open via a static server or after run_all.sh';
  }
  updateCalib();
  updateVOI();
  drawPayback(document.getElementById('payback').getContext('2d'));
}

function bind() {
  document.querySelectorAll('.persona').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPersona(btn.dataset.persona);
      drawPayback(document.getElementById('payback').getContext('2d'));
      drawOee(document.getElementById('oee').getContext('2d'));
    });
  });
  const bindRange = (id, key, fmt) => {
    const el = document.getElementById(id);
    const out = document.getElementById(id + '-out');
    const sync = () => {
      state[key] = Number(el.value);
      out.textContent = fmt(state[key]);
      buildLine();
      updateForecast();
    };
    el.addEventListener('input', sync);
    sync();
  };
  bindRange('drift', 'drift', (v) => String(v));
  bindRange('coverage', 'coverage', (v) => v + '%');
  bindRange('buffer', 'buffer', (v) => String(v));

  document.getElementById('btn-run').addEventListener('click', () => {
    if (state.running) return;
    state.running = true;
    tick();
  });
  document.getElementById('btn-pause').addEventListener('click', () => {
    state.running = false;
  });
}

buildLine();
setPersona('supervisor');
bind();
updateForecast();
paintStations('S22', new Set());
loadResults();
