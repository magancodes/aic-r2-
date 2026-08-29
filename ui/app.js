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
  lastBnTicketStation: null,
  history: [],
  alerts: [],
  oee: [],
  forecast: [],
  results: null,
  faFrozen: false,
  lastAsk: null,
  rng: makeRng(20260822),
};

function instrumented(id) {
  if (DARK.has(id)) return false;
  const order = [];
  for (let i = 1; i <= 40; i++) {
    const sid = padId(i - 1);
    if (!DARK.has(sid)) order.push(sid);
  }
  const keep = Math.round((state.coverage / 100) * 28);
  return order.indexOf(id) < keep;
}

// --- HITL ticket engine (Stage 1/2 Accept/Defer/Dismiss) --------------------
const hitl = window.Hitl.createHitl(() => {
  renderTicketList('bn-ticket', hitl.list().filter((t) => t.type === 'bottleneck_act_now'));
  renderTicketList('tickets', hitl.list().filter((t) => t.type.startsWith('weld_') || t.type === 'copilot_promoted'));
  document.getElementById('audit-count').textContent = hitl.auditLog().length + ' entries';
});

function renderTicketList(hostId, tickets) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = tickets
    .slice(0, hostId === 'bn-ticket' ? 1 : 6)
    .map(renderTicket)
    .join('') || '<li class="ticket empty">No open tickets.</li>';
}

function renderTicket(t) {
  const stateLabel = t.state.replace(/_/g, ' ') + (t.slaMissed && !t.acted ? ' · SLA missed' : '');
  if (t.acted) {
    return `
      <li class="ticket ${t.state}" data-id="${t.id}">
        <div class="ticket-head"><span class="ticket-id">${t.id}</span><span class="ticket-station">${t.station}</span><span class="ticket-state">${stateLabel}</span></div>
        <p class="ticket-text">${t.text}</p>
        ${t.reasonCode ? `<p class="ticket-verdict">reason: ${t.reasonCode}</p>` : ''}
      </li>`;
  }
  const rows = window.Hitl.REASON_CODES;
  return `
    <li class="ticket ${t.state}" data-id="${t.id}">
      <div class="ticket-head"><span class="ticket-id">${t.id}</span><span class="ticket-station">${t.station}</span><span class="ticket-state">${stateLabel}</span></div>
      <p class="ticket-text">${t.text}</p>
      <div class="ticket-verbs">
        <button type="button" class="btn tiny accept" data-verb="accept">Accept</button>
        <button type="button" class="btn tiny ghost" data-verb="defer">Defer</button>
        <button type="button" class="btn tiny ghost bad" data-verb="dismiss">Dismiss</button>
      </div>
      <div class="ticket-reasons" hidden>
        ${Object.entries(rows).map(([v, codes]) => codes.map((c) => `<button type="button" class="chip reason" data-verb-final="${v}" data-reason="${c}" hidden data-forverb="${v}">${c}</button>`).join('')).join('')}
      </div>
    </li>`;
}

function bindTicketDelegation(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.addEventListener('click', (e) => {
    const li = e.target.closest('.ticket');
    if (!li) return;
    const id = li.dataset.id;
    const verbBtn = e.target.closest('[data-verb]');
    if (verbBtn) {
      const verb = verbBtn.dataset.verb;
      if (verb === 'accept') {
        hitl.verb(id, 'accept', null, state.persona);
        return;
      }
      // Reveal only this verb's reason chips.
      li.querySelectorAll('.ticket-reasons .chip').forEach((c) => {
        c.hidden = c.dataset.forverb !== verb;
      });
      li.querySelector('.ticket-reasons').hidden = false;
      li.querySelector('.ticket-verbs').style.opacity = '0.4';
      return;
    }
    const reasonBtn = e.target.closest('[data-reason]');
    if (reasonBtn) {
      hitl.verb(id, reasonBtn.dataset.verbFinal, reasonBtn.dataset.reason, state.persona);
    }
  });
}

// --- Maintenance-window tracker (Stage 0/3) --------------------------------
const windowTracker = window.makeWindowTracker(renderWindows);

function renderWindows(windows) {
  const host = document.getElementById('windows');
  if (!host) return;
  host.innerHTML = windows
    .map(
      (w) => `
      <li class="window-row">
        <span class="chip win ${w.state}">${w.id} · ${w.station} · ${w.state.replace(/_/g, ' ')}</span>
        ${w.state !== 'retired' ? `<button type="button" class="btn tiny ghost adv" data-win="${w.id}">Advance</button>` : ''}
      </li>`
    )
    .join('') || '<li class="sub">No windows queued.</li>';
}

function bindWindowDelegation() {
  const host = document.getElementById('windows');
  if (!host) return;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-win]');
    if (!btn) return;
    windowTracker.advance(btn.dataset.win);
  });
}

function bindVoiQueue() {
  const host = document.getElementById('voi');
  if (!host) return;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-queue]');
    if (!btn) return;
    windowTracker.propose(btn.dataset.queue, 'next_sensor');
  });
}

// --- Copilot (Stage 4 Ask) ---------------------------------------------------
const copilot = window.makeCopilot(state, { padId, stdTime, instrumented });

function bindAsk() {
  const form = document.getElementById('ask-form');
  const input = document.getElementById('ask-input');
  const out = document.getElementById('ask-answer');
  const evidenceEl = document.getElementById('ask-evidence');
  const textEl = document.getElementById('ask-text');
  const promote = document.getElementById('ask-promote');

  function ask(text) {
    const res = copilot.parseIntent(text);
    out.hidden = false;
    if (res.clarify) {
      evidenceEl.textContent = '';
      textEl.textContent = 'Not sure which station or percentage you mean — try "what if S04 runs 15% slower?"';
      promote.hidden = true;
      state.lastAsk = null;
      return;
    }
    evidenceEl.textContent = `▸ twin: ${res.tool} · ${res.rolls} rolls · ${res.ms} ms`;
    textEl.textContent = res.text;
    state.lastAsk = res;
    promote.hidden = !['run_forecast', 'weld_status', 'recommend_sensor', 'what_if'].includes(res.tool);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    ask(input.value.trim());
  });
  document.querySelectorAll('.preset[data-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.q;
      ask(btn.dataset.q);
    });
  });
  promote.addEventListener('click', () => {
    if (!state.lastAsk) return;
    const t = hitl.open(
      'copilot_promoted',
      state.bn || 'S22',
      state.lastAsk.text,
      { t: state.t, evidenceTool: state.lastAsk.tool, rolls: state.lastAsk.rolls, ms: state.lastAsk.ms }
    );
    promote.hidden = true;
    promote.textContent = 'Promoted → ' + t.id;
    setTimeout(() => { promote.textContent = 'Promote to ticket'; }, 2200);
  });
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
  const top = state.forecast[0];
  state.bn = top.id;

  // Stage-1 act_now ticket: open when the top constraint changes station,
  // never re-fire for the same station (Defer/Dismiss already suppress repeats).
  if (top.id !== state.lastBnTicketStation) {
    state.lastBnTicketStation = top.id;
    hitl.open(
      'bottleneck_act_now',
      top.id,
      `Bottleneck act_now: ${top.id} is the constraint in ${(top.p * 100).toFixed(0)}% of rollouts. Advisory: pre-stage the downstream buffer or shift one operator to ${top.id}.`,
      { t: state.t, evidenceTool: 'run_forecast', rolls: 240, ms: 6 }
    );
  }
}

function maybeAlert() {
  if (state.drift < 4) return;
  if (!state.rng.bernoulli(0.08 + state.drift / 200)) return;
  const gun = Math.floor(state.rng.next() * 4);
  const score = 0.55 + state.rng.next() * 0.4;
  const confirmed = score >= 0.75;
  state.alerts.unshift({ t: state.t, text: `S07 gun ${gun} · score ${score.toFixed(2)}` });
  state.alerts = state.alerts.slice(0, 20);
  hitl.open(
    confirmed ? 'weld_confirmed' : 'weld_suspicious',
    'S07',
    confirmed
      ? `Weld confirmed (autoencoder): S07 gun ${gun} reconstruction error ${score.toFixed(2)}. Babysit every flagged body ID until S12/S34 inspect.`
      : `Weld suspicious (isolation forest): S07 gun ${gun} score ${score.toFixed(2)}. Watch — glance at tips, don't tear the line down.`,
    { t: state.t, evidenceTool: 'weld_status', rolls: 1, ms: 3, bodyIds: [`A-${4180 + state.tick}`] }
  );
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
    .map(
      (r, i) =>
        `<li>${r.station} — Δvar ${(r.voi || (3 - i * 0.4)).toFixed(2)} <button type="button" class="btn tiny ghost" data-queue="${r.station}">Queue window</button></li>`
    )
    .join('');
}

function updateFreeze() {
  const op = state.results && state.results.day5_detectors && state.results.day5_detectors.operational;
  const faPctEl = document.getElementById('fa-pct');
  const faSubEl = document.getElementById('fa-sub');
  if (op) {
    const fa = (1 - op.operationalPrecision) * 100;
    faPctEl.textContent = fa.toFixed(1) + '%';
    faSubEl.textContent = fa > 25
      ? `above the 25% freeze threshold with ${op.scrapCaught + op.earlyWarning + op.falseAlarm} graded this run`
      : `below the 25% freeze threshold (${op.falseAlarm} genuine false alarms)`;
  } else {
    faPctEl.textContent = '—';
    faSubEl.textContent = 'Run harness/score_detectors.js to populate';
  }
}

function bindFreeze() {
  const btn = document.getElementById('freeze-toggle');
  const stateEl = document.getElementById('freeze-state');
  btn.addEventListener('click', () => {
    state.faFrozen = !state.faFrozen;
    stateEl.textContent = state.faFrozen
      ? 'Frozen: autoencoder confirm muted until retune window closes. Isolation-forest watch still runs.'
      : 'Not frozen.';
    btn.classList.toggle('is-active', state.faFrozen);
  });
}

function bindAuditExport() {
  document.getElementById('audit-export').addEventListener('click', () => {
    const blob = new Blob([hitl.exportAudit()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hitl-audit-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
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
  state.t += 15 + state.buffer;
  updateForecast();
  const warn = new Set(state.alerts.slice(0, 3).map(() => 'S07'));
  paintStations(state.bn, warn);
  document.getElementById('bn-now').textContent = state.bn;
  document.getElementById('bn-sub').textContent =
    'P(bn) ' + ((state.forecast[0] && state.forecast[0].p * 100) || 0).toFixed(0) +
    '% · buffer ' + state.buffer + ' · t=' + fmtT(state.t);
  maybeAlert();
  updateMigrate();
  hitl.sweepSla(Date.now());
  const missedEl = document.getElementById('missed-sla');
  if (missedEl) missedEl.textContent = hitl.missedCount() + ' missed SLA this shift';
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
  updateFreeze();
  drawPayback(document.getElementById('payback').getContext('2d'));
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

  bindTicketDelegation('bn-ticket');
  bindTicketDelegation('tickets');
  bindWindowDelegation();
  bindVoiQueue();
  bindAsk();
  bindFreeze();
  bindAuditExport();
}

buildLine();
setPersona('supervisor');
bind();
updateForecast();
paintStations('S22', new Set());
loadResults();
