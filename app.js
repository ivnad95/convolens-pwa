/* ConvoLens — installable, dependency-free accessibility PWA prototype.
 * Browser speech recognition is optional and may rely on a third-party service.
 * Speaker labels are MANUAL; no diarisation or music separation is claimed.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const storeKey = 'convolens_saved_v1';
  const settingsKey = 'convolens_settings_v1';
  const defaultSettings = { language: 'en-GB', fontSize: 'regular', vibrate: false, engine: 'browser', serverUrl: '', serverDiarization: false };
  const safeJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  let settings = { ...defaultSettings, ...safeJSON(settingsKey, {}) };
  let saved = safeJSON(storeKey, []);
  if (!Array.isArray(saved)) saved = [];
  let entries = [];
  let listening = false;
  let recognition = null;
  let recognitionEnabled = false;
  let permanentRecognitionError = false;
  let recognitionRestarts = 0;
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let audioData = null;
  let rafId = null;
  let startTime = null;
  let timerId = null;
  let speakerTargetId = null;
  let pendingInstall = null;
  let toastTimer = null;
  let audioLevel = 0;
  let micError = false;
  let ws = null;
  let pcmNode = null;
  let pcmSource = null;
  let pcmSilence = null;
  let serverLineStart = 0;
  let serverLineCount = 0;
  let serverStopRequested = false;
  const $canvas = $('waveCanvas');
  const canvasContext = $canvas.getContext('2d');

  function formatTime(date = new Date()) { return date.toLocaleTimeString(settings.language, { hour: '2-digit', minute: '2-digit' }); }
  function stamp(date = new Date()) { return date.toLocaleString(settings.language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function toast(message) {
    const item = $('toast');
    item.textContent = message; item.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { item.hidden = true; }, 3400);
  }
  function notice(message, type = '') {
    $('noticeText').textContent = message;
    $('notice').className = 'notice' + (type ? ' ' + type : '');
  }
  function setStatus(message, active) {
    $('sessionStatus').textContent = message;
    $('sessionPill').classList.toggle('live', !!active);
    $('micChip').textContent = active ? 'Mic active' : 'Mic off';
    $('micChip').classList.toggle('live', !!active);
  }
  function duration() {
    if (!startTime) return 'Your captions will appear here';
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const sec = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${sec} · ${entries.length} caption${entries.length === 1 ? '' : 's'}`;
  }
  function updateMeta() { $('sessionMeta').textContent = duration(); }
  function navigate(page, updateHash = true) {
    if (!['listen', 'reply', 'saved', 'settings'].includes(page)) page = 'listen';
    document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== `page-${page}`; });
    document.querySelectorAll('[data-page]').forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (page === 'saved') renderSaved();
    if (updateHash && window.location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    if (page === 'listen') requestAnimationFrame(refreshWave);
    else if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1), false));
  function applySettings() {
    document.documentElement.style.setProperty('--caption-size', ({ regular: '20px', large: '26px', extra: '34px' })[settings.fontSize] || '20px');
    $('languageSelect').value = settings.language;
    $('fontSizeSelect').value = settings.fontSize;
    $('vibrationToggle').checked = !!settings.vibrate;
    $('captionEngineSelect').value = settings.engine;
    $('serverUrl').value = settings.serverUrl || '';
    $('diarizationToggle').checked = !!settings.serverDiarization;
    $('serverConfig').hidden = settings.engine !== 'server';
    updateEngineBadge();
    try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* private browsing */ }
  }
  $('languageSelect').addEventListener('change', e => { settings.language = e.target.value; applySettings(); if (recognition) recognition.lang = settings.language; toast('Caption language updated'); });
  $('fontSizeSelect').addEventListener('change', e => { settings.fontSize = e.target.value; applySettings(); });
  $('vibrationToggle').addEventListener('change', e => { settings.vibrate = e.target.checked; applySettings(); });
  $('captionEngineSelect').addEventListener('change', e => { if (listening) { e.target.value = settings.engine; return toast('Stop listening before changing the caption engine'); } settings.engine = e.target.value; applySettings(); });
  $('serverUrl').addEventListener('change', e => { settings.serverUrl = e.target.value.trim(); applySettings(); });
  $('serverUrl').addEventListener('input', e => { settings.serverUrl = e.target.value.trim(); });
  $('diarizationToggle').addEventListener('change', e => { settings.serverDiarization = e.target.checked; applySettings(); });
  function updateEngineBadge() {
    const available = settings.engine === 'server' ? !!settings.serverUrl : !!Recognition;
    $('captionAvailability').textContent = settings.engine === 'server' ? (available ? 'AI server configured; connection not yet tested' : 'Enter a WhisperLiveKit server address in Preferences') : (available ? 'Browser speech recognition available' : 'Not supported by this browser; use an AI server');
    $('captionBadge').textContent = available ? (settings.engine === 'server' ? 'Configured' : 'Available') : 'Limited';
    $('captionBadge').className = 'feature-status' + (available ? '' : ' missing');
  }
  function updateEmpty() { $('emptyState').hidden = entries.length > 0; $('saveButton').disabled = entries.length === 0; $('copyButton').disabled = entries.length === 0; }
  function isAtLatest() {
    const viewport = $('transcriptViewport');
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 40;
  }
  function updateLatestButton() { $('latestButton').hidden = isAtLatest(); }
  function followCaptions(follow) {
    const viewport = $('transcriptViewport');
    if (follow) viewport.scrollTop = viewport.scrollHeight;
    updateLatestButton();
  }
  $('transcriptViewport').addEventListener('scroll', updateLatestButton);
  $('latestButton').addEventListener('click', () => followCaptions(true));
  function addCaption(text, options = {}) {
    const clean = (text || '').trim(); if (!clean) return;
    if (!options.fromServer && entries.length > 0 && entries[entries.length - 1].text === clean && Date.now() - entries[entries.length - 1].created < 1700) return;
    const follow = isAtLatest();
    const caption = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), created: Date.now(), text: clean, speaker: options.speaker || '', automatic: !!options.automatic };
    entries.push(caption);
    const row = document.createElement('div'); row.className = 'message'; row.dataset.id = caption.id;
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = caption.speaker ? caption.speaker.charAt(0).toUpperCase() : '?';
    const copy = document.createElement('div'); copy.className = 'message-copy';
    const head = document.createElement('div'); head.className = 'message-head';
    const speaker = document.createElement('button'); speaker.type = 'button'; speaker.className = 'speaker-name';
    speaker.textContent = caption.speaker ? caption.speaker + ' · Edit' : 'Speaker unknown · Edit'; speaker.title = 'Assign a name to this caption';
    speaker.addEventListener('click', () => { speakerTargetId = caption.id; $('speakerName').value = caption.speaker; $('speakerDialog').showModal(); $('speakerName').focus(); });
    const time = document.createElement('span'); time.className = 'message-time'; time.textContent = formatTime(new Date(caption.created));
    const body = document.createElement('div'); body.className = 'message-body'; body.textContent = clean;
    head.append(speaker, time); copy.append(head, body); row.append(avatar, copy); $('messages').append(row);
    updateEmpty(); updateMeta();
    if (!options.deferFollow) followCaptions(follow);
    if (settings.vibrate && navigator.vibrate) navigator.vibrate(30);
  }
  $('speakerForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('speakerName').value.trim().slice(0, 32);
    const caption = entries.find(item => item.id === speakerTargetId);
    if (!caption || !name) return;
    caption.speaker = name; caption.automatic = false;
    const row = [...$('messages').children].find(element => element.dataset.id === caption.id);
    if (row) { row.querySelector('.speaker-name').textContent = name + ' · Edit'; row.querySelector('.avatar').textContent = name.charAt(0).toUpperCase(); }
    $('speakerDialog').close();
    toast('Speaker label updated');
  });
  function transcriptText(items = entries) { return items.map(item => `[${formatTime(new Date(item.created))}] ${item.speaker || 'Unknown speaker'}: ${item.text}`).join('\n'); }
  async function copyText(text) {
    try { if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable'); await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch { toast('Copy unavailable. Use a supported HTTPS browser.'); }
  }
  $('copyButton').addEventListener('click', () => { if (entries.length) copyText(transcriptText()); });
  $('saveButton').addEventListener('click', () => {
    if (!entries.length) return toast('Nothing to save yet');
    const item = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), savedAt: Date.now(), entries: entries.map(({ id, created, text, speaker }) => ({ id, created, text, speaker })) };
    const next = [item, ...saved];
    try { localStorage.setItem(storeKey, JSON.stringify(next)); saved = next; toast('Conversation saved on this device'); updateSavedCount(); }
    catch { toast('Local storage unavailable or full. Try copying the transcript.'); }
  });
  $('clearButton').addEventListener('click', () => {
    if (entries.length && !confirm('Clear the current conversation? Unsaved captions will be lost.')) return;
    entries = []; serverLineStart = 0; serverLineCount = 0; $('messages').replaceChildren(); $('interim').hidden = true; updateEmpty(); updateMeta(); updateLatestButton(); toast('Current conversation cleared');
  });
  function updateSavedCount() { $('savedCount').textContent = saved.length; }
  function renderSaved() {
    const root = $('savedList'); root.replaceChildren(); updateSavedCount();
    if (!saved.length) {
      const empty = document.createElement('div'); empty.className = 'saved-empty';
      const head = document.createElement('h2'); head.textContent = 'Your conversations, your choice.';
      const sub = document.createElement('p'); sub.textContent = 'Save a live conversation to find it here later, on this device only.';
      empty.append(head, sub); root.append(empty); return;
    }
    saved.forEach(item => {
      const card = document.createElement('article'); card.className = 'saved-card';
      const top = document.createElement('div'); top.className = 'saved-top';
      const h = document.createElement('strong'); h.textContent = 'Conversation · ' + (item.entries?.length || 0) + ' captions';
      const date = document.createElement('small'); date.textContent = stamp(new Date(item.savedAt)); top.append(h, date);
      const summary = document.createElement('p'); summary.className = 'saved-summary'; summary.textContent = item.entries?.[0]?.text?.slice(0, 125) || '';
      const details = document.createElement('details'); details.style.marginBottom = '13px';
      const dsummary = document.createElement('summary'); dsummary.textContent = 'Read transcript'; dsummary.style.cursor = 'pointer'; dsummary.style.color = '#4266ec';
      const pre = document.createElement('pre'); pre.style.cssText = 'font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;color:#53627d;font-size:13px;background:#f6f8ff;border-radius:10px;padding:14px'; pre.textContent = transcriptText(item.entries || []); details.append(dsummary, pre);
      const actions = document.createElement('div'); actions.className = 'saved-actions';
      const copy = document.createElement('button'); copy.className = 'tiny-button'; copy.textContent = 'Copy'; copy.addEventListener('click', () => copyText(transcriptText(item.entries || [])));
      const download = document.createElement('button'); download.className = 'tiny-button'; download.textContent = 'Download .txt'; download.addEventListener('click', () => downloadText(transcriptText(item.entries || []), `convolens-${new Date(item.savedAt).toISOString().slice(0,10)}.txt`));
      const remove = document.createElement('button'); remove.className = 'tiny-button danger'; remove.textContent = 'Delete'; remove.addEventListener('click', () => {
        if (!confirm('Permanently delete this saved conversation from this device?')) return;
        const next = saved.filter(record => record.id !== item.id);
        try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { toast('Unable to update local storage'); return; }
        saved = next; renderSaved(); toast('Saved conversation deleted');
      });
      actions.append(copy, download, remove); card.append(top, summary, details, actions); root.append(card);
    });
  }
  function downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  $('deleteAllButton').addEventListener('click', () => {
    if (!saved.length) return toast('No saved conversations to delete');
    if (!confirm('Permanently delete ALL saved conversations on this device?')) return;
    try { localStorage.removeItem(storeKey); saved = []; updateSavedCount(); toast('All saved conversations deleted'); }
    catch { toast('Storage could not be cleared'); }
  });

  function resizeCanvas() {
    const rect = $canvas.getBoundingClientRect(); if (!rect.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    $canvas.width = Math.round(rect.width * dpr); $canvas.height = Math.round(rect.height * dpr);
  }
  function refreshWave() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (document.visibilityState !== 'visible' || $('page-listen').hidden) return;
    resizeCanvas(); drawWave();
  }
  function drawWave() {
    rafId = null;
    const width = $canvas.width, height = $canvas.height;
    if (!width || !height) return;
    canvasContext.clearRect(0, 0, width, height);
    canvasContext.strokeStyle = '#dbe4ff'; canvasContext.lineWidth = 1.3;
    canvasContext.beginPath(); canvasContext.moveTo(0, height / 2); canvasContext.lineTo(width, height / 2); canvasContext.stroke();
    canvasContext.beginPath(); canvasContext.strokeStyle = '#607ee9'; canvasContext.lineWidth = Math.max(1.5, width / 230); canvasContext.lineJoin = 'round';
    if (analyser && audioData) analyser.getByteTimeDomainData(audioData);
    const n = audioData?.length || 128;
    for (let x = 0; x < width; x += Math.max(2, Math.round(width / 140))) {
      const index = Math.floor(x / width * (n - 1));
      const sample = (analyser && audioData) ? ((audioData[index] - 128) / 128) : (Math.sin(x / width * Math.PI * 9) * .028);
      const y = height / 2 + sample * height * .40;
      if (x === 0) canvasContext.moveTo(x, y); else canvasContext.lineTo(x, y);
    }
    canvasContext.stroke();
    if (analyser && audioData) {
      let sum = 0; for (const v of audioData) { const point = (v - 128) / 128; sum += point * point; }
      const rms = Math.sqrt(sum / audioData.length);
      const db = 20 * Math.log10(Math.max(rms, .00001));
      const target = Math.max(0, Math.min(100, (db + 65) / 65 * 100));
      audioLevel = audioLevel * .76 + target * .24;
      $('signalFill').style.width = audioLevel.toFixed(1) + '%';
      $('signalMeter').setAttribute('aria-valuenow', String(Math.round(audioLevel)));
      $('signalText').textContent = db < -57 ? 'Very quiet' : db < -37 ? 'Quiet' : db < -18 ? 'Moderate' : 'Strong';
    }
    if (analyser && document.visibilityState === 'visible' && !$('page-listen').hidden) rafId = requestAnimationFrame(drawWave);
  }
  async function openMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires a secure HTTPS page and supported browser.');
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser does not support microphone visualisation.');
    // Initialise while the Start button's user gesture is active (especially important on iOS).
    audioContext = new AC();
    const resuming = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
    stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await resuming;
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .76;
    audioData = new Uint8Array(analyser.fftSize); source.connect(analyser);
    refreshWave();
    stream.getAudioTracks().forEach(track => { track.addEventListener('ended', () => { if (listening) { notice('The microphone was disconnected. Start a new session to reconnect.', 'warn'); stopListening(); } }); });
  }
  function isValidServerUrl(raw) {
    try {
      const endpoint = new URL(raw);
      return (endpoint.protocol === 'wss:' || (endpoint.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) && endpoint.pathname.endsWith('/asr');
    } catch { return false; }
  }
  function updateServerLines(lines) {
    if (!Array.isArray(lines)) return;
    // WhisperLiveKit full mode resends all committed lines. Reconcile them by position.
    const follow = isAtLatest();
    const children = $('messages').children;
    const actual = lines.filter(line => line && typeof line.text === 'string' && line.text.trim());
    if (actual.length < serverLineCount) {
      const toRemove = serverLineCount - actual.length;
      entries.splice(serverLineStart + actual.length, toRemove);
      for (let i = 0; i < toRemove; i++) children[serverLineStart + actual.length]?.remove();
    }
    actual.forEach((line, index) => {
      const pos = serverLineStart + index;
      const predicted = settings.serverDiarization && Number(line.speaker) > 0 ? `Speaker ${line.speaker}` : '';
      const existing = entries[pos];
      if (!existing) addCaption(line.text, { speaker: predicted, automatic: !!predicted, fromServer: true, deferFollow: true });
      else {
        let changed = false;
        if (existing.text !== line.text) { existing.text = line.text; changed = true; }
        if (existing.automatic && existing.speaker !== predicted) { existing.speaker = predicted; changed = true; }
        if (changed) {
          const row = children[pos];
          if (row) {
            row.querySelector('.message-body').textContent = existing.text;
            row.querySelector('.speaker-name').textContent = existing.speaker ? `${existing.speaker} · Edit` : 'Speaker unknown · Edit';
            row.querySelector('.avatar').textContent = existing.speaker ? existing.speaker.charAt(0).toUpperCase() : '?';
          }
        }
      }
    });
    serverLineCount = actual.length;
    updateEmpty(); updateMeta(); followCaptions(follow);
  }
  function handleServerMessage(event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === 'config') {
      if (payload.useAudioWorklet !== true) {
        permanentRecognitionError = true;
        notice('The server must be started with --pcm-input. Check your server settings and restart.', 'error');
        try { ws?.close(); } catch {} return;
      }
      notice('AI transcription connected. Your microphone audio is streamed to your configured server.');
      return;
    }
    if (payload.status === 'error' || payload.error) {
      notice('AI server reported an error: ' + (payload.error || 'speech processing failed'), 'error'); return;
    }
    if (payload.type === 'ready_to_stop') { try { ws?.close(); } catch {} return; }
    const follow = isAtLatest();
    if (Array.isArray(payload.lines)) updateServerLines(payload.lines);
    const interim = payload.buffer_transcription || payload.buffer_diarization || '';
    $('interimText').textContent = interim;
    $('interim').hidden = !interim;
    followCaptions(follow);
  }
  async function initialiseServerRecognition() {
    if (!isValidServerUrl(settings.serverUrl)) {
      notice('Enter a valid secure wss://…/asr endpoint in Preferences first. ws:// is only allowed on localhost.', 'error'); return false;
    }
    if (!stream || !audioContext) { notice('No microphone is available for AI streaming.', 'error'); return false; }
    serverLineStart = entries.length;
    serverLineCount = 0;
    serverStopRequested = false;
    try {
      const url = new URL(settings.serverUrl);
      url.searchParams.set('mode', 'full');
      url.searchParams.set('language', settings.language.split('-')[0]);
      ws = new WebSocket(url.toString());
      ws.binaryType = 'arraybuffer';
      ws.onmessage = handleServerMessage;
      ws.onerror = () => notice('Could not connect to the AI server. Confirm the address, TLS certificate and server status.', 'warn');
      ws.onclose = () => { if (listening && settings.engine === 'server') { permanentRecognitionError = true; notice('AI server connection closed. Stop and restart after checking the server.', 'warn'); } };
      ws.onopen = async () => {
        if (!listening) { ws.close(); return; }
        try {
          if (!audioContext.audioWorklet) throw Error('AudioWorklet unsupported in this browser');
          await audioContext.audioWorklet.addModule('./pcm-worklet.js');
          if (!listening || ws.readyState !== WebSocket.OPEN) return;
          pcmSource = audioContext.createMediaStreamSource(stream);
          pcmNode = new AudioWorkletNode(audioContext, 'convolens-pcm');
          pcmSilence = audioContext.createGain(); pcmSilence.gain.value = 0;
          pcmNode.port.onmessage = e => {
            if (ws?.readyState === WebSocket.OPEN && !serverStopRequested) {
              if (ws.bufferedAmount < 512000) ws.send(e.data); else notice('AI server is falling behind; some audio may be dropped.', 'warn');
            }
          };
          pcmSource.connect(pcmNode); pcmNode.connect(pcmSilence); pcmSilence.connect(audioContext.destination);
        } catch (error) { notice('AI audio streaming could not start: ' + error.message, 'error'); ws?.close(); }
      };
      return true;
    } catch (error) { notice('The AI server endpoint is invalid: ' + error.message, 'error'); return false; }
  }
  function stopServerStreaming() {
    serverStopRequested = true;
    try { pcmSource?.disconnect(); pcmNode?.disconnect(); pcmSilence?.disconnect(); } catch {}
    pcmSource = null; pcmNode = null; pcmSilence = null;
    const current = ws; ws = null;
    if (current?.readyState === WebSocket.OPEN) {
      try { current.send(new ArrayBuffer(0)); } catch {}
      setTimeout(() => { if (current.readyState === WebSocket.OPEN) current.close(); }, 10000);
    } else if (current && current.readyState === WebSocket.CONNECTING) { try { current.close(); } catch {} }
  }
  function initialiseRecognition() {
    if (!Recognition) return false;
    recognition = new Recognition(); recognition.lang = settings.language; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onstart = () => { recognitionEnabled = true; recognitionRestarts = 0; if (listening) notice('Live captions are active. Tap a speaker label to identify them manually.'); };
    recognition.onresult = event => {
      const follow = isAtLatest();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]; const phrase = result[0]?.transcript?.trim();
        if (!phrase) continue;
        if (result.isFinal) addCaption(phrase); else interim += phrase + ' ';
      }
      $('interim').hidden = !interim;
      $('interimText').textContent = interim;
      followCaptions(follow);
    };
    recognition.onerror = event => {
      const reason = event.error || 'unknown';
      if (reason === 'no-speech' || reason === 'aborted') return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(reason)) permanentRecognitionError = true;
      const messages = { 'not-allowed': 'Speech recognition permission was denied.', 'service-not-allowed': 'Speech recognition service is not permitted.', 'network': 'Speech service needs a working network connection.', 'language-not-supported': 'This speech language is unavailable in this browser.', 'audio-capture': 'The browser speech service cannot access the microphone.' };
      notice((messages[reason] || 'Speech recognition encountered an error.') + ' The microphone meter may still work.', 'warn');
      $('captionAvailability').textContent = 'Speech service unavailable in this session'; $('captionBadge').textContent = 'Limited'; $('captionBadge').className = 'feature-status missing';
    };
    recognition.onend = () => {
      recognitionEnabled = false;
      $('interim').hidden = true;
      if (listening && !permanentRecognitionError && recognitionRestarts < 8) {
        recognitionRestarts++;
        setTimeout(() => {
          if (!listening || permanentRecognitionError) return;
          try { recognition.start(); } catch { /* session might be recovering */ }
        }, 350);
      } else if (listening && recognitionRestarts >= 8) {
        permanentRecognitionError = true;
        notice('Speech recognition stopped repeatedly. Stop and restart the session to try again.', 'warn');
      }
    };
    try { recognition.start(); return true; }
    catch (error) {
      permanentRecognitionError = true;
      notice('The browser could not start its speech service. Microphone metering may still work.', 'warn'); return false;
    }
  }
  function setListeningUI(active) {
    $('listenLabel').textContent = active ? 'Stop listening' : 'Start listening';
    $('listenButton').classList.toggle('listening', active);
    setStatus(active ? 'Listening now' : 'Ready to listen', active);
  }
  async function startListening() {
    if (listening) return;
    listening = true; permanentRecognitionError = false; recognitionRestarts = 0; recognitionEnabled = false; micError = false;
    setListeningUI(true); $('listenButton').disabled = true;
    if (!startTime) startTime = Date.now();
    updateMeta(); if (timerId) clearInterval(timerId); timerId = setInterval(updateMeta, 1000);
    try { await openMicrophone(); }
    catch (error) { micError = true; notice(error?.message || 'Microphone access denied. Allow microphone access in your browser.', 'warn'); }
    if (!listening) return;
    if (settings.engine === 'server') await initialiseServerRecognition();
    else if (Recognition) initialiseRecognition();
    else {
      notice(micError ? 'This browser has no available microphone or speech recognition support.' : 'This browser has no built-in speech recognition. The microphone meter is available; choose AI server in Preferences for captions.', 'warn');
    }
    if (micError && ((settings.engine === 'browser' && (!Recognition || permanentRecognitionError)) || settings.engine === 'server')) { stopListening(); }
    $('listenButton').disabled = false;
  }
  function stopListening() {
    listening = false;
    stopServerStreaming(); recognitionEnabled = false;
    clearInterval(timerId); timerId = null;
    if (recognition) { try { recognition.stop(); } catch { /* already stopped */ } recognition = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    analyser = null; audioData = null; audioLevel = 0;
    refreshWave();
    $('signalFill').style.width = '0%'; $('signalMeter').setAttribute('aria-valuenow', '0'); $('signalText').textContent = 'Not active';
    $('interim').hidden = true; setListeningUI(false); $('listenButton').disabled = false;
    updateMeta();
  }
  $('listenButton').addEventListener('click', () => { if (listening) { stopListening(); notice('Listening stopped. Save or copy your captions to keep them.'); } else startListening(); });

  $('speakButton').addEventListener('click', () => {
    const text = $('replyText').value.trim(); if (!text) return toast('Type a message first');
    if (!window.speechSynthesis) return toast('Text-to-speech is not supported in this browser');
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = settings.language; utterance.rate = .95; speechSynthesis.speak(utterance);
  });
  $('stopSpeakButton').addEventListener('click', () => { if (window.speechSynthesis) speechSynthesis.cancel(); });
  $('showReplyButton').addEventListener('click', () => { const text = $('replyText').value.trim(); if (!text) return toast('Type a message first'); $('fullReplyText').textContent = text; $('fullscreenReply').showModal(); });
  $('howButton').addEventListener('click', () => $('infoDialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));

  function installed() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  $('installButton').addEventListener('click', async () => {
    if (installed()) return toast('ConvoLens is already running as an installed app');
    if (pendingInstall) { const prompt = pendingInstall; pendingInstall = null; try { await prompt.prompt(); await prompt.userChoice; } catch { showInstallInstructions(); } return; }
    showInstallInstructions();
  });
  function showInstallInstructions() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const root = $('installHelp'); root.replaceChildren();
    const p = document.createElement('p');
    p.textContent = ios ? 'On iPhone: open this website in Safari, tap the Share button or Page Menu, choose Add to Home Screen, turn on Open as Web App, and tap Add.' : 'On Android: open this website in Chrome, tap the three-dot menu, then select Install app or Add to Home screen. Other browsers may present different options.';
    const note = document.createElement('p'); note.textContent = 'For installation and microphone access, the website must be hosted over HTTPS. Your app opens directly from the Home Screen.';
    root.append(p, note); $('installDialog').showModal();
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); pendingInstall = event; });
  window.addEventListener('appinstalled', () => { pendingInstall = null; toast('ConvoLens installed'); });

  document.addEventListener('visibilitychange', () => {
    refreshWave();
    if (document.visibilityState === 'visible' && listening && stream?.getAudioTracks().some(track => track.readyState !== 'live' || track.muted)) {
      notice('The operating system may have suspended the microphone while the app was in the background. Restart listening if audio stops.', 'warn');
    }
  });
  window.addEventListener('resize', refreshWave);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* optional offline shell */ }));
  }
  applySettings(); updateEmpty(); updateSavedCount(); navigate(location.hash.slice(1) || 'listen', false);
})();
