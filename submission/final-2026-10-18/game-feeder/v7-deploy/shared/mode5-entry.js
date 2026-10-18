/* TransitLab mode 05 entry sequence: splash screen -> upward gesture -> account dialog. */
(function (root, doc) {
  'use strict';
  function init() {
    var cover = doc.getElementById('mode5Entry');
    if (!cover) return;
    var waiting = true, startY = null, started = false;
    var body = doc.body;
    function accountDialog() {
      // auth.js is loaded before this module; wait once if the DOMContentLoaded
      // handlers have not run yet. This keeps the entry page compatible with
      // the normal account button and auth state machine.
      if (root.TL_AUTH && typeof root.TL_AUTH.open === 'function') {
        root.TL_AUTH.open('login');
      } else {
        root.setTimeout(accountDialog, 40);
      }
    }
    function enter() {
      if (!waiting || started) return;
      started = true; waiting = false;
      body.classList.remove('mode5-entry-locked');
      body.classList.add('mode5-entry-started');
      cover.setAttribute('aria-hidden', 'true');
      cover.classList.add('is-leaving');
      root.setTimeout(function () {
        cover.hidden = true;
        accountDialog();
      }, 360);
    }
    function wheel(e) {
      if (waiting && e.deltaY < -18) { e.preventDefault(); enter(); }
    }
    function touchStart(e) {
      if (waiting && e.touches && e.touches.length) startY = e.touches[0].clientY;
    }
    function touchEnd(e) {
      if (!waiting || startY === null) return;
      var endY = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientY : startY;
      var delta = startY - endY; startY = null;
      if (delta > 36) { e.preventDefault(); enter(); }
    }
    function key(e) {
      if (waiting && (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Enter')) {
        e.preventDefault(); enter();
      }
    }
    root.addEventListener('wheel', wheel, {capture:true, passive:false});
    root.addEventListener('touchstart', touchStart, {capture:true, passive:true});
    root.addEventListener('touchend', touchEnd, {capture:true, passive:false});
    root.addEventListener('keydown', key, {capture:true});
    body.classList.add('mode5-entry-locked');
    // Keep the login modal usable after the gesture, while allowing the user
    // to close it if the account service is unavailable.
    root.TL_MODE5_ENTRY = { enter: enter, waiting: function () { return waiting; } };
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
