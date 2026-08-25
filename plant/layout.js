'use strict';

/**
 * 40-station BODY / PAINT / FINAL line.
 * Cycle times 46–53 s, well balanced. S22 is the designed slowest (53 s).
 * 12 dark stations emit nothing; 28 instrumented.
 */

const DARK = new Set([
  'S03', 'S10', 'S13', 'S14', 'S15', 'S20', 'S21', 'S23', 'S26', 'S32', 'S33', 'S39',
]);

function padId(i) {
  return 'S' + String(i + 1).padStart(2, '0');
}

/** Standard cycle times (seconds). Deterministic layout constants. */
function buildStdTimes() {
  // Base pattern across the line, peaking at S22 = 53 s.
  const times = new Array(40);
  for (let i = 0; i < 40; i++) {
    const id = i + 1;
    let ct = 48;
    if (id === 22) ct = 53;
    else if (id === 19 || id === 28) ct = 51;
    else if (id === 7 || id === 11 || id === 25) ct = 50;
    else if (id === 2 || id === 8 || id === 16 || id === 30 || id === 35) ct = 49;
    else if (id === 1 || id === 40) ct = 46;
    else if ([4, 5, 9, 12, 17, 18, 24, 27, 31, 36, 37].includes(id)) ct = 47;
    else ct = 48;
    times[i] = ct;
  }
  return times;
}

const STD_TIMES = buildStdTimes();

/** Weld stations and spots-per-unit (split across guns). */
const WELD_STATIONS = {
  S02: { spots: 52, guns: 2 },
  S04: { spots: 56, guns: 2 },
  S05: { spots: 60, guns: 3 },
  S06: { spots: 64, guns: 3 },
  S07: { spots: 80, guns: 4 }, // electrode wear demo station
  S08: { spots: 60, guns: 3 },
  S09: { spots: 56, guns: 2 },
  S11: { spots: 72, guns: 3 },
  S12: { spots: 68, guns: 3 },
  S16: { spots: 44, guns: 2 },
  S17: { spots: 48, guns: 2 },
  S18: { spots: 41, guns: 2 },
};

const BOLT_STATIONS = {
  S29: { bolts: 8 },
  S30: { bolts: 10 },
  S31: { bolts: 12 },
  S34: { bolts: 0 }, // audit / reject station (no bolts; inspects)
  S35: { bolts: 6 },
  S36: { bolts: 8 },
};

const AUDIT_STATION = 'S34';

function zoneOf(id) {
  const n = parseInt(id.slice(1), 10);
  if (n <= 15) return 'BODY';
  if (n <= 28) return 'PAINT';
  return 'FINAL';
}

function buildLayout() {
  const stations = [];
  for (let i = 0; i < 40; i++) {
    const id = padId(i);
    const weld = WELD_STATIONS[id] || null;
    const bolt = BOLT_STATIONS[id] || null;
    stations.push({
      id,
      idx: i,
      zone: zoneOf(id),
      stdTime: STD_TIMES[i],
      instrumented: !DARK.has(id),
      weld,
      bolt,
      audit: id === AUDIT_STATION,
    });
  }
  return {
    n: 40,
    stations,
    dark: [...DARK].sort(),
    instrumented: stations.filter((s) => s.instrumented).map((s) => s.id),
    targetTakt: 55,
    bufferCap: 4,
    weldStations: WELD_STATIONS,
    boltStations: BOLT_STATIONS,
    auditStation: AUDIT_STATION,
    stdTime(idOrIdx) {
      if (typeof idOrIdx === 'number') return STD_TIMES[idOrIdx];
      const n = parseInt(String(idOrIdx).replace(/\D/g, ''), 10) - 1;
      return STD_TIMES[n];
    },
    station(id) {
      return stations.find((s) => s.id === id);
    },
  };
}

const LAYOUT = buildLayout();

module.exports = {
  LAYOUT,
  buildLayout,
  DARK,
  WELD_STATIONS,
  BOLT_STATIONS,
  AUDIT_STATION,
  STD_TIMES,
};
