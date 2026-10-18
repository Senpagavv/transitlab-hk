/* Compatibility entry for the user-approved implicit solver now built into engine.js. */
(function(root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.SandboxEngine;
  const api = {step:E.step,runToStable:E.runToStable};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  root.SandboxFeedback=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
