'use strict';
importScripts('engine.js');
let prepared = null, activePlan = null, state = null, runId = 0;
function sendError(e) { postMessage({ type: 'error', message: e && e.message ? e.message : String(e), runId }); }
self.onmessage = function (event) {
  const m = event.data || {};
  try {
    if (m.type === 'init' || m.type === 'period') {
      runId = m.runId || runId + 1;
      prepared = SandboxEngine.prepare(m.base, m.demand);
      activePlan = m.plan || SandboxEngine.emptyPlan();
      state = SandboxEngine.createState(prepared, activePlan);
      postMessage({ type: 'ready', runId, period: m.demand.period || 'am' });
      return;
    }
    if (!prepared) throw new Error('worker has not received model data');
    if (m.type === 'set-plan') {
      runId = m.runId || runId + 1; activePlan = m.plan; state = SandboxEngine.createState(prepared, activePlan);
      const preview = SandboxEngine.step(prepared, activePlan, state);
      postMessage({ type: 'preview', runId, metrics: preview.metrics, round: preview.row, validation: SandboxEngine.validatePlan(prepared.base, activePlan) });
      return;
    }
    if (m.type === 'preview') {
      const preview = SandboxEngine.step(prepared, activePlan, SandboxEngine.createState(prepared, activePlan));
      postMessage({ type: 'preview', runId, metrics: preview.metrics, round: preview.row, validation: SandboxEngine.validatePlan(prepared.base, activePlan) });
      return;
    }
    if (m.type === 'step') {
      runId = m.runId || runId + 1;
      const start = performance.now();
      const result = SandboxEngine.step(prepared, activePlan, state); state = result.state;
      const elapsedMs = performance.now() - start;
      postMessage({ type: 'step', elapsedMs, runId, metrics: result.metrics, row: result.row, rows: state.rows, stable: state.stable, validation: SandboxEngine.validatePlan(prepared.base, activePlan) });
      return;
    }
    if (m.type === 'stable') {
      runId = m.runId || runId + 1;
      const start = performance.now(), rows = []; let count = 0;
      while (!state.stable && count < 30) {
        const result = SandboxEngine.step(prepared, activePlan, state); state = result.state; rows.push(result.row); count++;
        postMessage({ type: 'progress', runId, round: state.round, metrics: result.metrics, row: result.row, rows: state.rows });
      }
      const elapsedMs = performance.now() - start;
      postMessage({ type: 'stable', elapsedMs, roundsRun: count, roundMs: count ? elapsedMs / count : 0, runId, metrics: state.last, rows, allRows: state.rows, stable: state.stable, validation: SandboxEngine.validatePlan(prepared.base, activePlan) });
    }
  } catch (e) { sendError(e); }
};
