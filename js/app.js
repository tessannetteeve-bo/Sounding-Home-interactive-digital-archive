/* ============================================================
   SOUND HOUSE
   Drag up to three archive sounds into the house. Vertical
   position sets volume, horizontal position sets reverb amount.
   Everything runs client-side with the Web Audio API.
   ============================================================ */

(() => {
  const MAX_SOUNDS = 3;
  const RECORD_SECONDS = 20;

  const archiveListEl = document.getElementById('archiveList');
  const houseWrap = document.getElementById('houseWrap');
  const dropzone = document.getElementById('dropzone');
  const slotStatus = document.getElementById('slotStatus');
  const mixReadout = document.getElementById('mixReadout');
  const descriptionEl = document.getElementById('description');
  const downloadBtn = document.getElementById('downloadBtn');
  const statusLine = document.getElementById('statusLine');
  const tapPrompt = document.getElementById('tapPrompt');
  const tapPromptBtn = document.getElementById('tapPromptBtn');

  /** @type {AudioContext} */
  let ctx = null;
  let masterGain = null;
  let convolver = null;

  /** archive entries loaded from archive.json: {id,title,file,buffer?,_loadPromise?} */
  let archive = [];

  /** placed sounds: {uid, archiveId, title, buffer, x, y, nodes, el, state: 'loading'|'ready'|'failed'} */
  const placed = [];

  let uidCounter = 0;

  // ---------- helpers ----------
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const volumeFromY = (y) => lerp(0.05, 1.0, y);   // top = quiet, bottom = loud
  const wetFromX = (x) => lerp(1.0, 0.0, x);        // left = echo, right = dry

  function setStatus(msg) { statusLine.textContent = msg; }

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(ctx.destination);
      convolver = ctx.createConvolver();
      convolver.buffer = createImpulseResponse(ctx, 2.6, 3.2);
      convolver.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function createImpulseResponse(context, duration, decay) {
    const rate = context.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const impulse = context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  // ---------- load archive ----------
  async function loadArchive() {
    setStatus('loading archive…');
    const res = await fetch('sounds/archive.json');
    const manifest = await res.json();
    archive = manifest;
    renderArchiveList();
    setStatus('');
    applyDeepLinkIfPresent();
  }

  // ---------- fetch + decode a single sound, only when it's actually needed ----------
  function loadSoundBuffer(entry) {
    if (entry.buffer) return Promise.resolve(entry.buffer);
    if (!entry._loadPromise) {
      ensureContext();
      entry._loadPromise = (async () => {
        const res = await fetch(`sounds/${entry.file}`);
        if (!res.ok) throw new Error(`could not fetch sounds/${entry.file} (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        entry.buffer = buffer;
        return buffer;
      })().catch((err) => {
        entry._loadPromise = null; // allow a retry on the next drag
        throw err;
      });
    }
    return entry._loadPromise;
  }

  // ---------- direct links: ?sound=id&vol=0-100&reverb=0-100 ----------
  function whenHouseImageReady(cb) {
    const img = document.querySelector('img.house');
    if (img.complete) cb();
    else img.addEventListener('load', cb, { once: true });
  }

  function applyDeepLinkIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const soundId = params.get('sound');
    if (!soundId) return;

    const entry = archive.find((a) => a.id === soundId);
    if (!entry) {
      setStatus(`no archive sound found for "${soundId}"`);
      return;
    }

    const volParam = params.has('vol') ? Number(params.get('vol')) : 50;
    const reverbParam = params.has('reverb') ? Number(params.get('reverb')) : 50;
    const y = clamp01((Number.isFinite(volParam) ? volParam : 50) / 100);
    const x = clamp01(1 - (Number.isFinite(reverbParam) ? reverbParam : 50) / 100);

    whenHouseImageReady(() => {
      addPlacedSound(entry, x, y);
      // autoplay is blocked without a user gesture in most browsers —
      // if the context is still silent, show one tap-to-listen prompt.
      if (!ctx || ctx.state !== 'running') {
        tapPrompt.hidden = false;
        setStatus(`${entry.title} is placed and waiting — tap to listen`);
      }
    });
  }

  tapPromptBtn.addEventListener('click', () => {
    ensureContext();
    tapPrompt.hidden = true;
    setStatus(placed.length ? `${placed[0].title} is playing — drag it to shape the mix` : '');
  });

  function tapeIconSVG() {
    return `<svg width="22" height="16" viewBox="0 0 30 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="28" height="20" rx="2" stroke="#000" stroke-width="1.6"/>
      <circle cx="9" cy="11" r="4.2" stroke="#000" stroke-width="1.4"/>
      <circle cx="21" cy="11" r="4.2" stroke="#000" stroke-width="1.4"/>
      <path d="M9 11h12" stroke="#000" stroke-width="1"/>
    </svg>`;
  }

  function renderArchiveList() {
    archiveListEl.innerHTML = '';
    archive.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'tape-card';
      card.dataset.archiveId = entry.id;
      card.innerHTML = `${tapeIconSVG()}<span class="label"><b>${entry.title}</b>${entry.file}</span>`;
      card.addEventListener('pointerdown', (e) => onArchivePointerDown(e, entry, card));
      archiveListEl.appendChild(card);
    });
    refreshArchiveDisabledState();
  }

  function refreshArchiveDisabledState() {
    const full = placed.length >= MAX_SOUNDS;
    [...archiveListEl.children].forEach((card) => card.classList.toggle('disabled', full));
  }

  // ---------- dragging a new sound in from the archive ----------
  function onArchivePointerDown(e, entry, card) {
    if (placed.length >= MAX_SOUNDS) return;
    e.preventDefault();
    ensureContext(); // unlock audio as early as possible, right on the user gesture
    card.classList.add('dragging-source');

    const ghost = document.createElement('div');
    ghost.className = 'ghost-pin';
    document.body.appendChild(ghost);
    moveGhost(ghost, e.clientX, e.clientY);

    function onMove(ev) { moveGhost(ghost, ev.clientX, ev.clientY); }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      ghost.remove();
      card.classList.remove('dragging-source');

      const rect = dropzone.getBoundingClientRect();
      if (
        ev.clientX >= rect.left && ev.clientX <= rect.right &&
        ev.clientY >= rect.top && ev.clientY <= rect.bottom
      ) {
        const x = clamp01((ev.clientX - rect.left) / rect.width);
        const y = clamp01((ev.clientY - rect.top) / rect.height);
        addPlacedSound(entry, x, y);
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function moveGhost(ghost, x, y) {
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
  }

  // ---------- placed sound lifecycle ----------
  async function addPlacedSound(entry, x, y) {
    ensureContext();

    const sound = {
      uid: ++uidCounter,
      archiveId: entry.id,
      title: entry.title,
      buffer: null,
      x, y,
      nodes: null,
      el: null,
      state: 'loading',
    };

    sound.el = createPinElement(sound);
    houseWrap.appendChild(sound.el);
    updatePinDOM(sound);
    setPinState(sound, 'loading');

    placed.push(sound);
    refreshArchiveDisabledState();
    refreshUI();
    setStatus(`loading ${entry.title}…`);

    try {
      const buffer = await loadSoundBuffer(entry);
      if (!placed.includes(sound)) return; // removed while it was loading

      sound.buffer = buffer;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const volume = ctx.createGain();
      const dry = ctx.createGain();
      const wetSend = ctx.createGain();

      source.connect(volume);
      volume.connect(dry);
      volume.connect(wetSend);
      dry.connect(masterGain);
      wetSend.connect(convolver);

      source.start(0);

      sound.nodes = { source, volume, dry, wetSend };
      applyPosition(sound);
      setPinState(sound, 'ready');
      refreshMixReadout();
      setStatus(`${entry.title} is playing — drag it to shape the mix`);
    } catch (err) {
      console.error(err);
      if (!placed.includes(sound)) return;
      setPinState(sound, 'failed');
      refreshMixReadout();
      setStatus(`couldn't load ${entry.title} — check your connection and try again`);
    }
  }

  function removePlacedSound(sound) {
    if (sound.nodes) {
      try { sound.nodes.source.stop(); } catch (err) { /* already stopped */ }
      sound.nodes.source.disconnect();
      sound.nodes.volume.disconnect();
      sound.nodes.dry.disconnect();
      sound.nodes.wetSend.disconnect();
    }
    sound.el.remove();

    const idx = placed.indexOf(sound);
    if (idx >= 0) placed.splice(idx, 1);

    refreshArchiveDisabledState();
    refreshUI();
    setStatus(placed.length ? 'sound removed' : '');
  }

  function applyPosition(sound) {
    if (!sound.nodes) return; // not loaded yet — position is stored and applied once it connects
    const vol = volumeFromY(sound.y);
    const wet = wetFromX(sound.x);
    sound.nodes.volume.gain.setTargetAtTime(vol, ctx.currentTime, 0.02);
    sound.nodes.dry.gain.setTargetAtTime(1 - wet, ctx.currentTime, 0.02);
    sound.nodes.wetSend.gain.setTargetAtTime(wet, ctx.currentTime, 0.02);
  }

  function setPinState(sound, state) {
    sound.state = state;
    sound.el.classList.toggle('is-loading', state === 'loading');
    sound.el.classList.toggle('is-failed', state === 'failed');
    const tag = sound.el.querySelector('.pin-tag');
    if (state === 'loading') tag.textContent = `${sound.title} · loading…`;
    else if (state === 'failed') tag.textContent = `${sound.title} · failed to load`;
    else tag.textContent = sound.title;
  }

  // ---------- pin element + dragging existing pins ----------
  function createPinElement(sound) {
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.innerHTML = `<span class="pin-tag">${sound.title}</span><span class="pin-remove" title="remove">x</span>`;

    pin.querySelector('.pin-remove').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      removePlacedSound(sound);
    });

    pin.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('pin-remove')) return;
      e.preventDefault();
      const rect = dropzone.getBoundingClientRect();

      function onMove(ev) {
        sound.x = clamp01((ev.clientX - rect.left) / rect.width);
        sound.y = clamp01((ev.clientY - rect.top) / rect.height);
        updatePinDOM(sound);
        applyPosition(sound);
        refreshMixReadout();
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    return pin;
  }

  function updatePinDOM(sound) {
    const wrapRect = houseWrap.getBoundingClientRect();
    const zoneRect = dropzone.getBoundingClientRect();
    const left = (zoneRect.left - wrapRect.left) + sound.x * zoneRect.width;
    const top = (zoneRect.top - wrapRect.top) + sound.y * zoneRect.height;
    sound.el.style.left = left + 'px';
    sound.el.style.top = top + 'px';
  }

  window.addEventListener('resize', () => placed.forEach(updatePinDOM));

  // ---------- UI readouts ----------
  function refreshUI() {
    slotStatus.textContent = `${placed.length} / ${MAX_SOUNDS} sounds placed`;
    downloadBtn.disabled = placed.length === 0;
    refreshMixReadout();
  }

  function refreshMixReadout() {
    if (!placed.length) { mixReadout.innerHTML = ''; return; }
    let rows = placed.map((s) => {
      const vol = Math.round(volumeFromY(s.y) * 100);
      const rev = Math.round(wetFromX(s.x) * 100);
      const note = s.state === 'loading' ? ' (loading…)' : s.state === 'failed' ? ' (failed)' : '';
      return `<tr><td>${s.title}${note}</td><td>vol ${vol}%</td><td>reverb ${rev}%</td></tr>`;
    }).join('');
    mixReadout.innerHTML = `<table><thead><tr><th>sound</th><th>volume</th><th>reverb</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- render 20s WAV mix + JSON notes, bundled as one .zip ----------
  downloadBtn.addEventListener('click', async () => {
    const readySounds = placed.filter((s) => s.state === 'ready' && s.buffer);
    if (!readySounds.length) {
      const anyLoading = placed.some((s) => s.state === 'loading');
      setStatus(!placed.length ? ''
        : anyLoading ? 'still loading — wait for sounds to finish before downloading'
        : 'no sounds loaded successfully — try removing and re-adding them');
      return;
    }
    downloadBtn.disabled = true;
    downloadBtn.classList.add('recording');
    setStatus('rendering 20-second mix…');

    try {
      const sampleRate = ctx ? ctx.sampleRate : 44100;
      const offline = new OfflineAudioContext(2, sampleRate * RECORD_SECONDS, sampleRate);

      const offlineMaster = offline.createGain();
      offlineMaster.gain.value = 0.9;
      offlineMaster.connect(offline.destination);

      const offlineConvolver = offline.createConvolver();
      offlineConvolver.buffer = createImpulseResponse(offline, 2.6, 3.2);
      offlineConvolver.connect(offlineMaster);

      readySounds.forEach((s) => {
        const src = offline.createBufferSource();
        src.buffer = s.buffer;
        src.loop = true;

        const vol = offline.createGain();
        const dry = offline.createGain();
        const wetSend = offline.createGain();

        const volVal = volumeFromY(s.y);
        const wetVal = wetFromX(s.x);
        vol.gain.value = volVal;
        dry.gain.value = 1 - wetVal;
        wetSend.gain.value = wetVal;

        src.connect(vol);
        vol.connect(dry);
        vol.connect(wetSend);
        dry.connect(offlineMaster);
        wetSend.connect(offlineConvolver);

        src.start(0);
      });

      const rendered = await offline.startRendering();
      const wavBlob = audioBufferToWav(rendered);
      const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());

      const notes = {
        title: 'Sounding Home field notes',
        generated: new Date().toISOString(),
        description: descriptionEl.value.trim(),
        duration_seconds: RECORD_SECONDS,
        sounds: readySounds.map((s) => ({
          id: s.archiveId,
          title: s.title,
          position: { x: round3(s.x), y: round3(s.y) },
          volume: round3(volumeFromY(s.y)),
          reverb: round3(wetFromX(s.x)),
        })),
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(notes, null, 2));

      const stamp = timestamp();
      const zipBlob = createZip([
        { name: `soundhouse-mix-${stamp}.wav`, data: wavBytes },
        { name: `soundhouse-notes-${stamp}.json`, data: jsonBytes },
      ]);

      downloadBlob(zipBlob, `soundhouse-${stamp}.zip`);
      const skippedLoading = placed.filter((s) => s.state === 'loading').length;
      const skippedFailed = placed.filter((s) => s.state === 'failed').length;
      const skipParts = [];
      if (skippedLoading) skipParts.push(`${skippedLoading} still loading`);
      if (skippedFailed) skipParts.push(`${skippedFailed} failed to load`);
      setStatus(skipParts.length
        ? `mix + field notes downloaded (${skipParts.join(', ')} — left out)`
        : 'mix + field notes downloaded as a .zip');
    } catch (err) {
      console.error(err);
      setStatus('something went wrong building the download — check the console');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('recording');
    }
  });

  // ---------- utils ----------
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  loadArchive();
})();
