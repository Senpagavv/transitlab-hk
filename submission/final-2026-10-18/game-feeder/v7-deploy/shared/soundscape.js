/* TransitLab soundscape: a small offline Web Audio layer for ambient motion and station feedback. */
(function (root) {
  'use strict';

  var AudioCtor = root.AudioContext || root.webkitAudioContext;
  var ctx = null, master = null, music = null, ambientTimer = null, ambientStarted = false;
  // Set this to '/feeder/shared/ambient.mp3' after uploading your own track.
  // Leave empty to keep the built-in generated soundscape.
  var TRACK_URL = '';
  var track = null;
  var toggleButton = null;
  var enabled = true;
  try { enabled = root.localStorage.getItem('tl-sound-enabled') !== '0'; } catch (e) {}

  function ensureAudio() {
    if (!enabled || !AudioCtor) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtor();
        master = ctx.createGain();
        master.gain.value = 0.14;
        master.connect(ctx.destination);
        music = ctx.createGain();
        music.gain.value = 0.48;
        music.connect(master);
      } catch (e) {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  function tone(freq, seconds, delay, type, volume) {
    var audio = ensureAudio();
    if (!audio || !music) return;
    var start = audio.currentTime + (delay || 0);
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume || 0.025), start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.08, seconds || 0.2));
    osc.connect(gain);
    gain.connect(music);
    osc.start(start);
    osc.stop(start + Math.max(0.1, seconds || 0.2) + 0.03);
  }

  function startAmbient() {
    if (ambientStarted || !enabled) return;
    if (TRACK_URL) {
      if (!track) {
        track = new Audio(TRACK_URL);
        track.loop = true;
        track.preload = 'auto';
        track.volume = 0.28;
      }
      ambientStarted = true;
      var promise = track.play();
      if (promise && promise.catch) promise.catch(function () { ambientStarted = false; });
      return;
    }
    if (!ensureAudio()) return;
    ambientStarted = true;
    var notes = [196, 246.94, 293.66, 246.94, 220, 261.63, 329.63, 261.63];
    var index = 0;
    function tick() {
      if (!ambientStarted || !enabled || !ensureAudio()) return;
      tone(notes[index % notes.length], 1.45, 0, 'sine', 0.035);
      tone(notes[(index + 2) % notes.length] / 2, 1.9, 0.12, 'triangle', 0.015);
      index += 1;
      ambientTimer = root.setTimeout(tick, 2200);
    }
    tick();
  }

  function stopAmbient() {
    ambientStarted = false;
    if (ambientTimer) root.clearTimeout(ambientTimer);
    ambientTimer = null;
    if (track) { track.pause(); track.currentTime = 0; }
  }

  function stationChime() {
    if (!enabled || !ensureAudio()) return;
    tone(523.25, 0.11, 0, 'sine', 0.08);
    tone(659.25, 0.14, 0.07, 'sine', 0.06);
    tone(783.99, 0.2, 0.14, 'sine', 0.045);
  }

  function selectChime() {
    if (!enabled || !ensureAudio()) return;
    tone(392, 0.1, 0, 'triangle', 0.035);
    tone(523.25, 0.14, 0.08, 'triangle', 0.025);
  }

  function updateToggle() {
    if (!toggleButton) return;
    toggleButton.textContent = enabled ? '♫' : '🔇';
    toggleButton.setAttribute('aria-pressed', String(enabled));
    toggleButton.title = enabled ? '关闭音乐 / Mute' : '打开音乐 / Sound on';
    toggleButton.setAttribute('aria-label', toggleButton.title);
  }

  function setEnabled(value) {
    enabled = !!value;
    try { root.localStorage.setItem('tl-sound-enabled', enabled ? '1' : '0'); } catch (e) {}
    if (enabled) {
      if (master) master.gain.setTargetAtTime(0.14, ctx.currentTime, 0.04);
      startAmbient();
    } else {
      stopAmbient();
      if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    }
    updateToggle();
  }

  function unlock() {
    if (!enabled) return;
    if (ensureAudio()) startAmbient();
  }

  function addToggle() {
    var topbar = document.getElementById('topbar');
    if (!topbar || document.getElementById('soundToggle')) return;
    toggleButton = document.createElement('button');
    toggleButton.id = 'soundToggle';
    toggleButton.type = 'button';
    toggleButton.className = 'btn btn-sm sound-toggle';
    toggleButton.addEventListener('click', function () { setEnabled(!enabled); });
    var theme = document.getElementById('thPaper');
    var themeGroup = theme && theme.parentElement;
    if (themeGroup && themeGroup.parentElement === topbar) topbar.insertBefore(toggleButton, themeGroup);
    else topbar.appendChild(toggleButton);
    updateToggle();
  }

  document.addEventListener('pointerdown', unlock, { capture: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, once: true });
  document.addEventListener('click', function (event) {
    var station = event.target && event.target.closest && event.target.closest('.hm,.station-button,[data-select],[data-station],.station-dot');
    if (station) stationChime();
  }, true);
  document.addEventListener('DOMContentLoaded', addToggle);

  root.TL_AUDIO = {
    start: unlock,
    station: stationChime,
    select: selectChime,
    toggle: setEnabled,
    get enabled() { return enabled; }
  };
})(window);
