'use strict';

/**
 * Twin ingest — sees ONLY the event stream and the line layout.
 * Merges consecutive work with no intervening wait into ONE active period (Roser).
 */

class Ingest {
  constructor(layout) {
    this.layout = layout;
    this.activePeriods = new Map(); // stationId -> [{start, end, n}]
    this.cycles = new Map();
    this.welds = new Map();
    this.rejects = [];
    this.faults = [];
    this._open = new Map(); // stationId -> {start, unit}
    this._lastEnd = new Map(); // stationId -> t of last end (for merge)
  }

  push(ev) {
    const s = ev.s;
    if (ev.e === 'start') {
      this._open.set(s, { start: ev.t, unit: ev.u });
    } else if (ev.e === 'end') {
      const open = this._open.get(s);
      const start = open ? open.start : ev.t;
      const unit = open ? open.unit : ev.u;
      this._open.delete(s);

      if (!this.cycles.has(s)) this.cycles.set(s, []);
      this.cycles.get(s).push({ start, end: ev.t, unit });

      // Active period merge: consecutive work with no intervening wait is ONE period.
      // "No wait" = next start equals previous end (within epsilon) OR start arrives
      // with no gap after last end. We merge when this end continues an open period
      // whose last segment ended at `start` (i.e. start === previous end).
      if (!this.activePeriods.has(s)) this.activePeriods.set(s, []);
      const periods = this.activePeriods.get(s);
      const gapTol = 1e-6;
      if (periods.length > 0) {
        const last = periods[periods.length - 1];
        // If this cycle started exactly when the previous active period ended, merge.
        if (Math.abs(start - last.end) <= gapTol) {
          last.end = ev.t;
          last.n += 1;
        } else {
          periods.push({ start, end: ev.t, n: 1 });
        }
      } else {
        periods.push({ start, end: ev.t, n: 1 });
      }
      this._lastEnd.set(s, ev.t);
    } else if (ev.e === 'weld') {
      if (!this.welds.has(s)) this.welds.set(s, []);
      this.welds.get(s).push({ t: ev.t, unit: ev.u, spot: ev.spot, dr: ev.dr });
    } else if (ev.e === 'reject') {
      this.rejects.push({ t: ev.t, unit: ev.u, kind: ev.kind, at: s });
    } else if (ev.e === 'fault') {
      this.faults.push({ t: ev.t, s });
    }
    return this;
  }

  pushAll(events) {
    for (const ev of events) this.push(ev);
    return this;
  }

  cycleTimes(id, sinceT = 0) {
    const rows = this.cycles.get(id) || [];
    return rows
      .filter((c) => c.start >= sinceT)
      .map((c) => c.end - c.start);
  }

  observedStations() {
    return this.layout.stations.filter((s) => s.instrumented).map((s) => s.id);
  }

  darkStations() {
    return this.layout.dark.slice();
  }

  utilisation(fromT, toT) {
    const span = toT - fromT;
    const out = [];
    for (const id of this.observedStations()) {
      const cycles = this.cycles.get(id) || [];
      let busy = 0;
      for (const c of cycles) {
        const a = Math.max(c.start, fromT);
        const b = Math.min(c.end, toT);
        if (b > a) busy += b - a;
      }
      out.push({ station: id, pct: span > 0 ? (100 * busy) / span : 0, busy, span });
    }
    return out.sort((a, b) => b.pct - a.pct);
  }
}

module.exports = { Ingest };
