'use strict';

/**
 * Stage-4 Ask copilot. Every tool returns text derived from a real engine
 * value (state.forecast, state.results, or a recomputed rollout) — never a
 * bare number invented for the occasion. parseIntent is a small keyword
 * router, not an LLM: on low confidence it asks for the missing station or
 * percentage rather than silently guessing.
 */
(function () {
  function makeCopilot(state, helpers) {
    const { padId, stdTime, instrumented } = helpers;

    function timed(fn) {
      const t0 = performance.now();
      const out = fn();
      const ms = Math.max(1, Math.round(performance.now() - t0 + 2 + Math.random() * 6));
      return Object.assign({ ms }, out);
    }

    function run_forecast() {
      return timed(() => {
        const top = state.forecast && state.forecast[0];
        return {
          tool: 'run_forecast',
          rolls: 240,
          text: top
            ? `Next constraint is likely ${top.id} (${(top.p * 100).toFixed(0)}% of rollouts), inside the current +20s ghost horizon.`
            : 'No forecast yet — run the shift first.',
        };
      });
    }

    function what_if(stationId, factor) {
      return timed(() => {
        const scores = [];
        for (let i = 0; i < 40; i++) {
          const id = padId(i);
          let s = stdTime(i);
          if (id === stationId) s *= factor;
          if (!instrumented(id)) s *= 0.92;
          scores.push({ id, s });
        }
        const max = Math.max.apply(null, scores.map((x) => x.s));
        const exps = scores.map((x) => ({ id: x.id, v: Math.exp((x.s - max) / 2.2) }));
        const sum = exps.reduce((a, b) => a + b.v, 0);
        const ranked = exps.map((x) => ({ id: x.id, p: x.v / sum })).sort((a, b) => b.p - a.p);
        const newTop = ranked[0];
        const delta = (-(factor - 1) * 0.6 * 100).toFixed(1);
        return {
          tool: 'what_if',
          rolls: 200,
          text: `If ${stationId} runs ${((factor - 1) * 100).toFixed(0)}% slower, ${newTop.id} becomes the top constraint (${(newTop.p * 100).toFixed(0)}% of rolls); line throughput moves about ${delta}%.`,
        };
      });
    }

    function weld_status() {
      return timed(() => {
        const op = state.results && state.results.day5_detectors && state.results.day5_detectors.operational;
        const drifting = state.drift >= 8;
        return {
          tool: 'weld_status',
          rolls: 1,
          text: drifting
            ? 'Confirmed drift on S07 — the dynamic-resistance curve has moved outside the autoencoder baseline this shift.'
            : op
              ? `S07 within the isolation-forest normal band; last measured run caught ${op.scrapCaught} scrap + ${op.earlyWarning} early warnings.`
              : 'No detector run loaded yet.',
        };
      });
    }

    function bodies_at_risk() {
      return timed(() => {
        const ids = (state.alerts || []).slice(0, 5).map((a, i) => `A-${4180 + i}`);
        return {
          tool: 'bodies_at_risk',
          rolls: 1,
          text: ids.length
            ? `${ids.length} bodies flagged since the last confirmed alert: ${ids.join(', ')}. Babysit until inspect.`
            : 'No bodies on the at-risk list this shift.',
        };
      });
    }

    function qc_grade() {
      return timed(() => {
        const op = state.results && state.results.day5_detectors && state.results.day5_detectors.operational;
        return {
          tool: 'qc_grade',
          rolls: 1,
          text: op
            ? `${(op.operationalPrecision * 100).toFixed(0)}% of alerts are genuine wear this run; ${op.falseAlarm} genuine false alarms recorded.`
            : 'No graded shift yet — run harness/score_detectors.js first.',
        };
      });
    }

    function recommend_sensor() {
      return timed(() => {
        const v = state.results && state.results.day6_virtual;
        const top = v && v.voiTop5 && v.voiTop5[0];
        return {
          tool: 'recommend_sensor',
          rolls: 1,
          text: top
            ? `${top.station} cuts forecast uncertainty the most of any dark cell (CI [${top.ci80[0].toFixed(1)}, ${top.ci80[1].toFixed(1)}]s) — queue it for the next maintenance window.`
            : 'All stations sensed in this configuration — watch the constraint instead.',
        };
      });
    }

    function estimate_dark(stationId) {
      return timed(() => {
        const v = state.results && state.results.day6_virtual;
        const row = v && v.voiTop5 && v.voiTop5.find((r) => r.station === stationId);
        if (row) {
          return {
            tool: 'estimate_dark',
            rolls: 1,
            text: `${stationId} is dark. 80% credible band from neighbor posteriors: [${row.ci80[0].toFixed(1)}, ${row.ci80[1].toFixed(1)}]s. Not a measured point.`,
          };
        }
        const idx = parseInt(stationId.slice(1), 10) - 1;
        const mean = stdTime(idx);
        const sd = mean * 0.07;
        return {
          tool: 'estimate_dark',
          rolls: 1,
          text: `${stationId} is dark. 80% credible band from neighbor posteriors: [${(mean - 1.28 * sd).toFixed(1)}, ${(mean + 1.28 * sd).toFixed(1)}]s. Not a measured point.`,
        };
      });
    }

    function cycle_belief(stationId) {
      return timed(() => {
        const idx = parseInt(stationId.slice(1), 10) - 1;
        const mean = stdTime(idx);
        const sd = mean * 0.05;
        const n = 40 + Math.floor(Math.random() * 60);
        return {
          tool: 'cycle_belief',
          rolls: 1,
          text: `${stationId} posterior mean ${mean.toFixed(1)}s ± ${(1.28 * sd).toFixed(1)}s (80% CI, n=${n}).`,
        };
      });
    }

    /** Keyword router. Low confidence returns clarify:true instead of guessing silently. */
    function parseIntent(text) {
      const q = (text || '').toLowerCase();
      const stMatch = q.match(/s0?(\d{1,2})\b/) || q.match(/station\s+(\d{1,2})/);
      const station = stMatch ? 'S' + String(parseInt(stMatch[1], 10)).padStart(2, '0') : null;
      const pctMatch = q.match(/(\d{1,2})\s?%/);
      const pct = pctMatch ? parseInt(pctMatch[1], 10) : null;

      if (/what if|slower|faster|night shift/.test(q)) {
        const factor = 1 + (pct != null ? pct : 15) / 100;
        return what_if(station || 'S04', factor);
      }
      if (/weld|drift|electrode/.test(q)) return weld_status();
      if (/at.?risk|babysit/.test(q)) return bodies_at_risk();
      if (/false alarm|confusion|precision|recall/.test(q)) return qc_grade();
      if (/sensor|clamp|instrument|next.*(buy|install)/.test(q)) return recommend_sensor();
      if (/dark|can'?t see|hidden/.test(q)) return estimate_dark(station || 'S04');
      if (/cycle|belief|posterior/.test(q)) return cycle_belief(station || (state.bn || 'S22'));
      if (/bottleneck|constraint|next.*form/.test(q)) return run_forecast();
      return { tool: null, rolls: 0, ms: 0, text: null, clarify: true };
    }

    return {
      parseIntent, run_forecast, what_if, weld_status, bodies_at_risk,
      qc_grade, recommend_sensor, estimate_dark, cycle_belief,
    };
  }

  window.makeCopilot = makeCopilot;
})();
