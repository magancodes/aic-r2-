'use strict';

/**
 * Stage-1/2 HITL ticket engine: Accept / Defer / Dismiss with reason codes,
 * an ack SLA, and an audit trail. The twin proposes; a human always closes
 * the loop. No verb here ever reaches a station or actuator — see
 * ui/app.js, where "accept" only ever calls a supervisor-facing render fn.
 */
(function () {
  const REASON_CODES = {
    defer: ['already_handled', 'waiting_window'],
    dismiss: ['mix_shift', 'dressing_cycle', 'mapped_wrong', 'dark_guess', 'copilot_misread'],
  };

  // Real wall-clock SLA (not simulated line-time, which runs ~40x faster
  // than the demo clock and would time out a ticket before anyone could
  // click). 45s gives a person time to read and act; shop SLA is 3 min.
  const SLA_MS = 45000;

  function createHitl(onChange) {
    let tickets = [];
    const audit = [];
    let seq = 1;

    function log(entry) {
      audit.push(Object.assign({ ts: new Date().toISOString() }, entry));
    }

    function open(type, station, text, opts) {
      opts = opts || {};
      const t = {
        id: 'T' + String(seq++).padStart(4, '0'),
        type,
        station,
        text,
        state: 'proposed',
        openedAt: opts.t || 0,
        slaDeadline: Date.now() + SLA_MS,
        acted: false,
        slaMissed: false,
        bodyIds: opts.bodyIds || [],
        evidenceTool: opts.evidenceTool || null,
        rolls: opts.rolls || null,
        ms: opts.ms || null,
        reasonCode: null,
      };
      tickets.unshift(t);
      tickets = tickets.slice(0, 40);
      log({
        ticket_id: t.id, type, station, state: 'proposed', verb: 'open',
        reason_code: null, actor_role: 'twin', evidence_tool: t.evidenceTool,
        rolls: t.rolls, ms: t.ms, grade: null,
      });
      if (onChange) onChange(tickets);
      return t;
    }

    function verb(ticketId, verbName, reasonCode, actorRole) {
      const t = tickets.find((x) => x.id === ticketId);
      if (!t || t.acted) return null;
      t.state = verbName === 'accept' ? 'accepted' : verbName === 'defer' ? 'deferred' : 'dismissed';
      t.acted = true;
      t.reasonCode = reasonCode || null;
      log({
        ticket_id: t.id, type: t.type, station: t.station, state: t.state,
        verb: verbName, reason_code: reasonCode || null, actor_role: actorRole || 'supervisor',
        evidence_tool: t.evidenceTool, rolls: t.rolls, ms: t.ms, grade: null,
      });
      if (onChange) onChange(tickets);
      return t;
    }

    function grade(ticketId, gradeCode) {
      const prior = audit.slice().reverse().find((a) => a.ticket_id === ticketId);
      log({
        ticket_id: ticketId, type: prior ? prior.type : null, station: prior ? prior.station : null,
        state: 'graded', verb: 'grade', reason_code: null, actor_role: 'qc',
        evidence_tool: null, rolls: null, ms: null, grade: gradeCode,
      });
    }

    /**
     * Sweep for unacked tickets past SLA. Never auto-accepts — a missed
     * ticket just gets a banner; a human can still Accept/Defer/Dismiss it
     * late, and the miss stays on the audit trail either way.
     */
    function sweepSla(nowMs) {
      let missed = 0;
      tickets.forEach((t) => {
        if (!t.acted && t.state === 'proposed' && nowMs > t.slaDeadline) {
          t.state = 'sla_timeout';
          t.slaMissed = true;
          missed++;
        }
      });
      if (missed && onChange) onChange(tickets);
      return missed;
    }

    function missedCount() {
      return tickets.filter((t) => t.slaMissed).length;
    }

    function exportAudit() {
      return JSON.stringify(audit, null, 2);
    }

    return {
      open, verb, grade, sweepSla, missedCount, exportAudit,
      list: () => tickets,
      auditLog: () => audit,
    };
  }

  window.Hitl = { createHitl, REASON_CODES, SLA_MS };
})();
