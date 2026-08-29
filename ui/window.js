'use strict';

/**
 * Stage-0/3 maintenance-window state machine.
 * Proposed -> Scheduled -> InWindow -> Acted -> Graded -> Retired.
 * "Queue window" only ever proposes work into this tracker — it never
 * flips a station live and never touches an actuator.
 */
(function () {
  const STATES = ['proposed', 'scheduled', 'in_window', 'acted', 'graded', 'retired'];

  function makeWindowTracker(onChange) {
    let windows = [];
    let seq = 1;

    function propose(station, reason) {
      const w = {
        id: 'W-' + String(seq++).padStart(3, '0'),
        station,
        reason,
        state: 'proposed',
      };
      windows.unshift(w);
      windows = windows.slice(0, 20);
      if (onChange) onChange(windows);
      return w;
    }

    function advance(id) {
      const w = windows.find((x) => x.id === id);
      if (!w) return null;
      const i = STATES.indexOf(w.state);
      if (i < STATES.length - 1) w.state = STATES[i + 1];
      if (onChange) onChange(windows);
      return w;
    }

    return { propose, advance, list: () => windows, STATES };
  }

  window.makeWindowTracker = makeWindowTracker;
})();
