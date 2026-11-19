// probe/probe-core.js — Core domain logic and state management for smart-board-probe
// Can be used in both browser and Node.js environments

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProbeCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const TERMINAL = ['pass', 'fail', 'na'];
  const TRIAL_IDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
  const OVERLAY_ON_TRIALS = ['D3', 'D4', 'D6'];

  // Single source for every operator-facing string that is data (script, scenario names, statuses).
  // Spanish first, English second (AC9). Step 2 never tells the operator to dismiss Overlay (closed D12).
  const BILINGUAL = {
    title: { es: 'Sonda SMART Board GX', en: 'SMART Board GX probe' },
    subtitle: { es: 'Instrumento de campo', en: 'Field instrument' },
    exportJson: { es: 'Exportar JSON', en: 'Export JSON' },
    copyLog: { es: 'Copiar registro', en: 'Copy log' },
    restoreTitle: {
      es: 'Hay una visita anterior sin exportar en este navegador.',
      en: 'There is a previous visit in this browser that was not exported.'
    },
    restoreAction: { es: 'Restaurar', en: 'Restore' },
    dismissAction: { es: 'Descartar', en: 'Discard' },
    evidenceComplete: { es: 'Evidencia completa', en: 'Evidence complete' },
    hostClass: { es: 'Clasificación del host', en: 'Host classification' },
    status: {
      idle: { es: 'Pendiente', en: 'Idle' },
      running: { es: 'En curso', en: 'Running' },
      pass: { es: 'Superado', en: 'Pass' },
      fail: { es: 'Fallido', en: 'Fail' },
      na: { es: 'No aplica', en: 'N/A' }
    },
    scenarios: [
      { id: 'A', es: 'Entorno', en: 'Environment', required: true },
      { id: 'B', es: 'WDK y puertos', en: 'WDK and ports', required: true, warnEs: 'No saltar B', warnEn: 'Do not skip B' },
      { id: 'C', es: 'Punteros', en: 'Pointers', required: true },
      { id: 'D', es: 'Gestos y Overlay', en: 'Gestures and Overlay', required: true },
      { id: 'E', es: 'Tinta y zoom', en: 'Ink and zoom', required: true },
      { id: 'H', es: 'Overlay sigue al contenido', en: 'Overlay follows content', required: false, beforeF: true },
      { id: 'F', es: 'Capacidades de Chrome', en: 'Chrome capabilities', required: false },
      { id: 'G', es: 'Almacenamiento y exportar', en: 'Storage and export', required: false },
      { id: 'G2', es: 'Enviar resultados', en: 'Send results', required: false, card: false },
      { id: 'iframe', es: 'A y B en iframe', en: 'A and B in an iframe', required: false, optional: true },
      { id: 'file', es: 'A y B desde file://', en: 'A and B from file://', required: false, optional: true }
    ],
    steps: [
      { num: 1, targets: ['A'],
        es: 'Abre esta página en el Chrome del tablero, no en un portátil.',
        en: 'Open this page in the board’s Chrome, not on a laptop.' },
      { num: '1b', targets: ['G2'],
        es: 'Toca Enviar resultados y haz la prueba de envío (resumen vacío); anota qué canales ofrece la página. Si ninguno funciona, planea Exportar JSON y Copiar JSON (paso 9).',
        en: 'Tap Send results and run the test send (empty summary); note which channels the page offers. If none works, plan for Export JSON and Copy JSON (step 9).' },
      { num: 2, targets: ['A'],
        es: 'Anota si Overlay o Freeze están ON u OFF. No hace falta apagarlos para empezar: los ensayos D los piden ON y OFF.',
        en: 'Note whether Overlay or Freeze is ON or OFF. You do not need to turn them off to start: D trials need both ON and OFF.' },
      { num: 3, targets: ['A', 'B'],
        es: 'Ejecuta A y luego B. No saltes B aunque parezca vacío.',
        en: 'Run A, then B. Do not skip B even if it looks empty.' },
      { num: 4, targets: ['C'],
        es: 'C: dedo, luego lápiz de bandeja, luego dos dedos.',
        en: 'C: finger, then tray pen, then two fingers.' },
      { num: 5, targets: ['D'],
        es: 'D: ensayos 1 a 6. Marca Overlay o Freeze como se indica.',
        en: 'D: trials 1 to 6. Tick Overlay or Freeze as instructed.' },
      { num: 6, targets: ['E'],
        es: 'E: tinta propia con zoom y tinta de Overlay.',
        en: 'E: our own ink with zoom, and Overlay ink.' },
      { num: 7, targets: ['H'],
        es: 'H: Overlay ON y lápiz de bandeja. Marca con el lápiz, mueve el contenido con el dedo (H1a, H1b, H2, H3) y responde H4 y H5. Si hay tiempo, H6: Compartir desde Overlay hacia la sonda.',
        en: 'H: Overlay ON and the tray pen. Write a mark with the pen, move the content with a finger (H1a, H1b, H2, H3) and answer H4 and H5. If time, H6: Share from Overlay to the probe.' },
      { num: 8, targets: ['F'],
        es: 'F: comprobaciones de Chrome.',
        en: 'F: Chrome checks.' },
      { num: 9, targets: ['G', 'G2'],
        es: 'Exporta el JSON y luego Enviar resultados (Compartir → tu correo o Drive; o Correo con resumen). Copia el registro. Deja la pestaña abierta hasta que el archivo esté en Descargas y el envío diga «entregado» (compartir, correo) o «enviado» (solo relay), o tengas el resumen en tu bandeja. Marca «Llegó» cuando lo veas.',
        en: 'Export the JSON, then Send results (Share → your email or Drive; or Email summary). Copy the log. Leave the tab open until the file is in Downloads and the send reads “handed” (share, email) or “sent” (relay only), or the summary is in your inbox. Tick “Arrived” once you have seen it.' }
    ],
    channels: {
      share: { es: 'Compartir archivo', en: 'Share file' },
      mailto: { es: 'Correo con resumen', en: 'Email summary' },
      relay: { es: 'Relay (opcional)', en: 'Relay (optional)' }
    },
    // Only the relay may say "sent": share and mailto only hand the result to another app (spec v0.4).
    outcome: {
      shared: { es: 'entregado a la app — comprueba que llegó', en: 'handed to the app — check it arrived' },
      cancelled: { es: 'cancelado', en: 'cancelled' },
      opened: { es: 'correo abierto — pulsa Enviar allí', en: 'mail app opened — press Send there' },
      sent: { es: 'enviado', en: 'sent' },
      failed: { es: 'falló', en: 'failed' },
      error: { es: 'error', en: 'error' }
    },
    relayFailure: {
      'wrong-code': { es: 'Rechazado: ¿código de visita incorrecto?', en: 'Rejected: wrong visit code?' },
      'too-large': { es: 'Demasiado grande para el relay', en: 'Too large for the relay' },
      'bad-format': { es: 'El relay rechazó el formato', en: 'The relay rejected the format' },
      'relay-5xx': { es: 'El relay falló (5xx) — prueba más tarde', en: 'Relay error (5xx) — try later' },
      timeout: { es: 'Sin respuesta en 15 s', en: 'No answer in 15 s' },
      network: { es: 'Sin conexión o esta red bloquea el servidor', en: 'No connection, or this network blocks the host' },
      cancelled: { es: 'cancelado', en: 'cancelled' }
    }
  };

  function classifyHost(info) {
    const ua = (info.userAgent || '').toLowerCase();
    const maxTouchPoints = Number(info.maxTouchPoints || 0);
    const platform = (info.platform || '').toLowerCase();

    // iQ 3 hint: UA signature. iQ 4 hint: related-apps API returned a com.smarttech.iq.* app.
    if (/am30|smartemb/.test(ua)) {
      return {
        classification: 'iq3',
        confidence: 0.9,
        reason: 'Matched iQ 3 signature in UA'
      };
    }
    if (info.isIqAppDetected) {
      return {
        classification: 'iq4',
        confidence: 0.8,
        reason: 'getInstalledRelatedApps returned a com.smarttech.iq app'
      };
    }

    // Check for GX Android
    const isAndroid = /android/.test(ua);
    const isChrome = /chrome/.test(ua) && !/edg/.test(ua);
    const hasTouch = maxTouchPoints > 0;

    if (isAndroid && isChrome && hasTouch) {
      const isLargeScreen = info.screenWidth >= 1280 || info.screenHeight >= 720;
      return {
        classification: 'gx-android',
        confidence: isLargeScreen ? 0.85 : 0.65,
        reason: 'Android Chrome with multi-touch surface'
      };
    }

    if (/win/.test(platform) || /windows/.test(ua)) {
      return {
        classification: 'windows-desktop',
        confidence: 0.95,
        reason: 'Windows desktop environment'
      };
    }

    return {
      classification: 'other',
      confidence: 0.5,
      reason: 'Standard browser environment without GX markers'
    };
  }

  function hasReason(text) {
    return typeof text === 'string' && text.trim().length > 0;
  }

  // Terminal = pass | fail | na, and na only counts with a reason (idle skip-without-reason is not terminal).
  function isTerminal(item) {
    if (!item || !TERMINAL.includes(item.status)) return false;
    return item.status !== 'na' || hasReason(item.notes);
  }

  function computeEvidenceComplete(runData) {
    const missing = [];
    const reasons = [];
    const scenarios = runData.scenarios || {};

    // Rule 1: GX board host (classification gx-android, or operator notes record the GX model)
    const hostClass = runData.host && runData.host.classification;
    const gxModel = runData.operator && runData.operator.gxModel;
    const gxByNotes = typeof gxModel === 'string' && /sbid-?gx|\bgx\b/i.test(gxModel);
    if (hostClass !== 'gx-android' && !gxByNotes) {
      missing.push('host:gx-android');
      reasons.push(`Host classified as '${hostClass}', not 'gx-android', and no GX model in operator notes`);
    }

    // Rule 2: A, B, C, E must be terminal
    for (const scId of ['A', 'B', 'C', 'E']) {
      const sc = scenarios[scId];
      if (!isTerminal(sc)) {
        missing.push(`scenario:${scId}`);
        const why = sc && sc.status === 'na' ? 'n/a without a reason' : (sc ? sc.status : 'missing');
        reasons.push(`Scenario ${scId} is '${why}', must be terminal (pass, fail or n/a with a reason)`);
      }
    }

    // Rule 4: B records an explicit sbPresent (true or false)
    const scB = scenarios.B;
    if (isTerminal(scB) && !(scB.payload && typeof scB.payload.sbPresent === 'boolean')) {
      missing.push('scenario:B:sbPresent');
      reasons.push('Scenario B did not record an explicit sbPresent (true or false)');
    }

    // Rule 3: every D trial terminal, and D3, D4, D6 performed with Overlay ON
    const scD = scenarios.D;
    if (!scD || !TERMINAL.includes(scD.status)) {
      missing.push('scenario:D');
      reasons.push('Scenario D overall is not terminal');
    }

    const trials = (scD && scD.trials) || {};
    for (const tId of TRIAL_IDS) {
      if (!isTerminal(trials[tId])) {
        missing.push(`trial:${tId}`);
        reasons.push(`Trial ${tId} is not terminal`);
      }
    }

    for (const tId of OVERLAY_ON_TRIALS) {
      const tr = trials[tId];
      if (tr && tr.overlayOn !== true) {
        missing.push(`trial:${tId}:overlayOn`);
        reasons.push(`Trial ${tId} must be performed with Overlay ON`);
      }
    }

    const complete = missing.length === 0;
    return {
      complete,
      missing,
      reasons
    };
  }

  /* ------------------------------------------------------------------ scenario H: Overlay follows content (spec v0.4 AC12–AC18) */

  const H_IDS = ['H1a', 'H1b', 'H2', 'H3'];
  const H_MECH_IDS = ['H1a', 'H1b', 'H3'];
  const H_VERDICTS = {
    H1a: ['follows', 'stays', 'partial', 'n/a'],
    H1b: ['follows', 'stays', 'partial', 'n/a'],
    H2: ['scales', 'stays', 'partial', 'n/a'],
    H3: ['follows', 'stays', 'partial', 'n/a']
  };
  const H5_IDS = ['H5a', 'H5b', 'H5c', 'H5d', 'H5e', 'H5f', 'H5g'];
  const H5_ANSWERS = ['yes', 'no', 'unknown'];
  const H5_AUTO_NOTE = 'n/a: H5e = no';
  const TIMELINE_CAP = 2000;
  const SIGNAL_BEFORE_MS = 2000;
  const SIGNAL_AFTER_MS = 1000;

  function emptyHTrial() {
    return { verdict: null, overlayOn: false, notes: '', timeline: [], truncated: false, recalled: false };
  }

  function newOverlayFollow() {
    const trials = {};
    for (const id of H_IDS) trials[id] = emptyHTrial();
    const h5 = {};
    for (const id of H5_IDS) h5[id] = { answer: null, note: '' };
    return { trials, taps: [], h4: '', h5 };
  }

  // A trial is terminal once it holds a verdict; n/a only counts with a reason (same rule as D).
  function isHTrialTerminal(trial) {
    if (!trial || typeof trial.verdict !== 'string') return false;
    if (trial.verdict === 'n/a') return hasReason(trial.notes);
    return trial.verdict === 'follows' || trial.verdict === 'stays' || trial.verdict === 'partial' || trial.verdict === 'scales';
  }

  function isGxHost(state) {
    const cls = state.host && state.host.classification;
    const model = state.operator && state.operator.gxModel;
    return cls === 'gx-android' || (typeof model === 'string' && /sbid-?gx|\bgx\b/i.test(model));
  }

  // overlayFollow.complete: H1a, H1b, H3 terminal with "Overlay was ON" ticked, on a GX host. Never touches evidence.complete.
  function isHComplete(state) {
    const trials = (state.overlayFollow && state.overlayFollow.trials) || {};
    return isGxHost(state) && H_MECH_IDS.every((id) => isHTrialTerminal(trials[id]) && trials[id].overlayOn === true);
  }

  // Literal AC15 (tech-plan D-A1): missing or n/a → inconclusive; H3 follows → image-track; any H1 follows and H3 stays →
  // os-scroll; all stay → host-only; anything else (including any partial) → mixed. H2 refines zoom only and is ignored here.
  function computeOverlayMechanism(trials) {
    const t = trials || {};
    const [a, b, c] = H_MECH_IDS.map((id) => (t[id] && t[id].verdict) || null);
    const known = (v) => v === 'follows' || v === 'stays' || v === 'partial';
    if (!known(a) || !known(b) || !known(c)) return 'inconclusive';
    if (c === 'follows') return 'image-track';
    if ((a === 'follows' || b === 'follows') && c === 'stays') return 'os-scroll';
    if (a === 'stays' && b === 'stays' && c === 'stays') return 'host-only';
    return 'mixed';
  }

  // AC13: the verdict stays refused until "Overlay was ON" is ticked; n/a is always possible with a reason.
  function validateTrialVerdict(id, verdict, opts) {
    const o = opts || {};
    if (!H_VERDICTS[id]) return { ok: false, error: 'unknown-trial' };
    if (!H_VERDICTS[id].includes(verdict)) return { ok: false, error: 'bad-verdict' };
    if (verdict === 'n/a') return hasReason(o.notes) ? { ok: true } : { ok: false, error: 'na-needs-reason' };
    if (o.overlayOn !== true) return { ok: false, error: 'overlay-not-on' };
    return { ok: true };
  }

  // AC14: one reusable recorder per trial. Counts stay exact (pointer kinds are counted per pointerType). Stored entries are
  // capped; pointermove is sampled (1 in 2) and may use at most half the cap so a long drag cannot starve the scroll /
  // visibility / viewport events. Anything dropped past a cap flips `truncated`.
  function createTrialRecorder(opts) {
    const cap = opts && Number.isFinite(opts.cap) && opts.cap > 0 ? opts.cap : TIMELINE_CAP;
    const moveCap = Math.max(1, Math.floor(cap / 2));
    const entries = [];
    const counts = {};
    const lastTop = {};
    let truncated = false;
    let moves = 0;
    let storedMoves = 0;
    return {
      add(evt) {
        const e = Object.assign({}, evt);
        const kind = e.kind;
        if (kind === 'scroll') {
          const prev = lastTop[e.target] || 0;
          e.delta = e.scrollTop - prev;
          lastTop[e.target] = e.scrollTop;
        }
        if (typeof kind === 'string' && kind.startsWith('pointer')) {
          const pt = e.pointerType || 'unknown';
          counts[kind] = counts[kind] || {};
          counts[kind][pt] = (counts[kind][pt] || 0) + 1;
        } else {
          counts[kind] = (counts[kind] || 0) + 1;
        }
        if (kind === 'pointermove') {
          moves++;
          if (moves % 2 === 0) return;
          if (storedMoves >= moveCap || entries.length >= cap) { truncated = true; return; }
          storedMoves++;
        } else if (entries.length >= cap) {
          truncated = true;
          return;
        }
        entries.push(e);
      },
      snapshot() {
        return { entries: entries.slice(), counts: JSON.parse(JSON.stringify(counts)), truncated };
      }
    };
  }

  function totalEvents(counts) {
    let n = 0;
    for (const v of Object.values(counts || {})) n += typeof v === 'number' ? v : totalEvents(v);
    return n;
  }

  // The stored trial: { verdict, overlayOn, notes, timeline } plus `truncated` and `recalled` (no page events between Start
  // and Stop: the verdict was given from memory after Overlay was closed). An empty timeline is data.
  function finalizeTrial(id, result, recorder) {
    if (!H_VERDICTS[id]) throw new Error('unknown trial ' + id);
    const r = result || {};
    const snap = recorder ? recorder.snapshot() : { entries: [], counts: {}, truncated: false };
    return {
      verdict: r.verdict,
      overlayOn: r.overlayOn === true,
      notes: typeof r.notes === 'string' ? r.notes : '',
      timeline: snap.entries,
      truncated: snap.truncated,
      recalled: totalEvents(snap.counts) === 0
    };
  }

  // Page-visible events from 2 s before to 1 s after each "Overlay is open now" tap (spec feedback 3). No taps → [].
  function computeOverlaySignals(taps, entries) {
    const list = Array.isArray(entries) ? entries : [];
    return (Array.isArray(taps) ? taps : []).map((tapAt) => ({
      tapAt,
      events: list.filter((e) => typeof e.t === 'number' && e.t >= tapAt - SIGNAL_BEFORE_MS && e.t <= tapAt + SIGNAL_AFTER_MS)
    }));
  }

  // AC12 / AC18: the three surfaces share the same numbered content; none draws ink; each marks row 008.
  const SURFACES = {
    'S-doc': { id: 'S-doc', trials: ['H1a', 'H2'], scroll: 'document', touchAction: 'auto', overscroll: 'auto', pageZoom: true },
    'S-box': { id: 'S-box', trials: ['H1b'], scroll: 'inner', touchAction: 'auto', overscroll: 'contain', pageZoom: true, heightFraction: 0.7 },
    'S-xform': { id: 'S-xform', trials: ['H3'], scroll: 'transform', touchAction: 'none', overscroll: 'none', pageZoom: false }
  };
  function surfaceSpec(id) {
    if (!SURFACES[id]) return null;
    return Object.assign({ rows: 120, rowHeight: 72, minViewportHeights: 4, ink: false, targetRow: 8 }, SURFACES[id]);
  }
  const SURFACE_FOR_TRIAL = { H1a: 'S-doc', H1b: 'S-box', H2: 'S-doc', H3: 'S-xform' };

  // AC18: the trial dock stays reachable when the visual viewport is zoomed. `tracked` carries what the controller needs to
  // place it on the visible area; the badge is the visible fallback.
  function dockPlacement(vv) {
    const scale = vv && Number.isFinite(vv.scale) ? vv.scale : 1;
    if (Math.abs(scale - 1) < 0.01) return { mode: 'fixed', showZoomBadge: false };
    return {
      mode: 'tracked',
      showZoomBadge: true,
      scale,
      offsetLeft: vv.offsetLeft || 0,
      offsetTop: vv.offsetTop || 0,
      width: vv.width,
      height: vv.height
    };
  }

  // H6 (AC17): metadata only, never the content. PNG and JPEG headers are parsed; anything else reports size and mime.
  function describeSharedFile(bytes, mime) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const out = { mime: String(mime || ''), byteSize: u8.length, width: null, height: null, hasAlpha: null };
    const be32 = (o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
    const be16 = (o) => (u8[o] << 8) | u8[o + 1];
    const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    const isPng = u8.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => u8[i] === b) && tag(12) === 'IHDR';
    if (isPng) {
      out.width = be32(16);
      out.height = be32(20);
      const colorType = u8[25];
      let alpha = colorType === 4 || colorType === 6;
      if (!alpha) {
        // grey / RGB / palette carry transparency in a tRNS chunk that precedes the image data
        for (let off = 33; off + 8 <= u8.length;) {
          const type = tag(off + 4);
          if (type === 'tRNS') { alpha = true; break; }
          if (type === 'IDAT' || type === 'IEND') break;
          off += 12 + be32(off);
        }
      }
      out.hasAlpha = alpha;
    } else if (u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8) {
      for (let off = 2; off + 9 < u8.length;) {
        if (u8[off] !== 0xff) { off++; continue; }
        const marker = u8[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          out.height = be16(off + 5);
          out.width = be16(off + 7);
          break;
        }
        off += 2 + be16(off + 2);
      }
      out.hasAlpha = false;
    }
    return out;
  }

  /* ------------------------------------------------------------------ G2: send results (spec v0.4 AC19–AC24, AC27, AC28) */

  const EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  const TRUNC_LINE = '…truncated; full JSON in Downloads';
  const MAILTO_BODY_MAX = 1500;
  const RELAY_TIMEOUT_MS = 15000;
  const SETTINGS_KEY = 'smart-board-probe:settings';
  const DELIVERY_OUTCOME_OK = {
    share: (o) => o === 'shared' || o === 'cancelled' || /^error: .+/.test(o),
    mailto: (o) => o === 'opened' || /^error: .+/.test(o),
    relay: (o) => o === 'sent' || /^failed: .+/.test(o)
  };
  const DELIVERY_CHANNELS = Object.keys(DELIVERY_OUTCOME_OK);

  const clip = (s, n) => {
    const t = String(s == null ? '' : s);
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function parseHttpsUrl(value) {
    let u;
    try { u = new URL(String(value)); } catch (_) { throw new Error('relay URL must be a valid https URL'); }
    if (u.protocol !== 'https:') throw new Error('relay URL must be https');
    return u;
  }

  // run state of a visit: finished once A–E are terminal, partial once anything moved, else empty
  function computeRunState(list) {
    const items = Array.isArray(list) ? list : [];
    const terminal = (s) => s === 'pass' || s === 'fail' || s === 'na' || s === 'n/a';
    const by = {};
    for (const s of items) by[s.id] = s;
    if (['A', 'B', 'C', 'D', 'E'].every((id) => by[id] && terminal(by[id].status))) return 'finished';
    const touched = items.some((s) => s.status !== 'idle' || (Array.isArray(s.trials) && s.trials.some((t) => t.status !== 'idle')));
    return touched ? 'partial' : 'empty';
  }

  function exportFilename(date, ext) {
    const d = date || new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `probe-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
  }

  function buildShareFile(json, date) {
    return { name: exportFilename(date, 'json') + '.txt', type: 'text/plain', content: json };
  }

  // Pure summary of a run (AC22). The same text feeds the share text, the mailto body and "Copy log (short)". It reads the
  // export only; settings, recipient, relay URL and visit code can never appear in it.
  function buildSummary(x) {
    const p = x || {};
    const ev = p.evidence || {};
    const fp = p.fingerprint || {};
    const list = Array.isArray(p.scenarios) ? p.scenarios : [];
    const by = {};
    for (const s of list) by[s.id] = s;
    const status = (id) => (by[id] && by[id].status) || 'idle';
    const note = (s) => (s && s.notes ? ' — ' + clip(oneLine(s.notes), 70) : '');
    const cls = p.hostClassification || fp.classification || 'other';
    const conf = Number.isFinite(fp.confidence) ? ` (${Math.round(fp.confidence * 100)} %)` : '';
    const date = String(p.finishedAt || p.exportedAt || p.startedAt || '').slice(0, 10);
    const raw = (id) => (by[id] && by[id].raw && typeof by[id].raw === 'object' ? by[id].raw : {});
    const lines = [];
    lines.push(`Probe ${cls}${conf} ${date} complete=${ev.complete === true}`);
    lines.push(`run=${computeRunState(list)} · evidence.complete=${ev.complete === true}`);
    const sb = raw('B').sbPresent;
    lines.push(`sbPresent=${typeof sb === 'boolean' ? sb : 'unknown'}` + (raw('B').scriptLoad ? ` · scriptLoad=${raw('B').scriptLoad}` : ''));
    const op = fp.operator || p.operator || {};
    if (op.gxModel) lines.push(`GX model: ${clip(oneLine(op.gxModel), 60)}`);
    lines.push(`A ${status('A')}${note(by.A)}`);
    lines.push(`B ${status('B')}${note(by.B)}`);
    const types = raw('C').pointerTypesObserved;
    lines.push(`C ${status('C')}${Array.isArray(types) && types.length ? ' · ' + types.join(',') : ''}${note(by.C)}`);
    lines.push(`D ${status('D')}${note(by.D)}`);
    const dTrials = by.D && Array.isArray(by.D.trials) ? by.D.trials : [];
    for (const tid of TRIAL_IDS) {
      const t = dTrials.find((x2) => x2.id === tid) || { status: 'idle' };
      const res = t.result || t.resultOn || t.resultOff;
      lines.push(`  ${tid} ${t.status}${t.overlayOn ? ' · Overlay ON' : ''}${t.freezeOn ? ' · Freeze ON' : ''}${res ? ' · ' + res : ''}${t.notes ? ' — ' + clip(oneLine(t.notes), 50) : ''}`);
    }
    const e = raw('E');
    const eBits = [];
    if (e.step1 && e.step1.verdict) eBits.push(`own ink: ${e.step1.verdict}`);
    if (e.step2 && e.step2.verdict) eBits.push(`Overlay ink: ${e.step2.verdict}`);
    lines.push(`E ${status('E')}${eBits.length ? ' · ' + eBits.join(' · ') : ''}${note(by.E)}`);
    const of = p.overlayFollow;
    if (of && typeof of === 'object') {
      const tr = of.trials || {};
      lines.push(`H ${status('H')} · overlayFollow.mechanism=${of.mechanism || 'inconclusive'} · H complete=${of.complete === true}`);
      lines.push('  ' + H_IDS.map((id) => `${id} ${(tr[id] && tr[id].verdict) || '-'}`).join(' · '));
      const h5 = of.h5 || {};
      const answered = H5_IDS.filter((id) => h5[id] && h5[id].answer);
      if (answered.length) lines.push('  ' + answered.map((id) => `${id} ${h5[id].answer}${h5[id].note ? ' (' + clip(oneLine(h5[id].note), 40) + ')' : ''}`).join(' · '));
      if (of.h4) lines.push('  H4: ' + clip(oneLine(of.h4), 120));
    } else {
      lines.push(`H ${status('H')}`);
    }
    lines.push(`F ${status('F')}${note(by.F)}`);
    lines.push(`G ${status('G')}${note(by.G)}`);
    lines.push(`started ${p.startedAt || '-'} · finished ${p.finishedAt || '-'}`);
    return lines.join('\n');
  }

  function buildMailto(opts) {
    const o = opts || {};
    const to = typeof o.to === 'string' ? o.to : '';
    if (!EMAIL_RE.test(to)) return { error: 'invalid-address' };
    const subject = `Probe ${o.classification} ${o.date} complete=${o.complete === true}`;
    let body = String(o.summary == null ? '' : o.summary);
    let truncated = false;
    if (body.length > MAILTO_BODY_MAX) {
      body = body.slice(0, MAILTO_BODY_MAX - TRUNC_LINE.length - 1) + '\n' + TRUNC_LINE;
      truncated = true;
    }
    return { url: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, truncated };
  }

  // 'shared' | 'cancelled' | 'error: <name>'. Cancel (AbortError) is not an error.
  async function runShare(nav, payload) {
    try {
      await nav.share({ files: [payload.file], text: payload.text, title: payload.title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      return 'error: ' + ((e && e.name) || 'Error');
    }
  }

  // Channels shown on the Send panel: only those this device supports. Never a disabled button, never a state change.
  function offeredChannels(opts) {
    const o = opts || {};
    const nav = o.nav || {};
    const settings = o.settings || {};
    const out = [];
    let canShareFile = false;
    try { canShareFile = typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [o.file] }) === true; } catch (_) { canShareFile = false; }
    if (canShareFile) out.push('share');
    out.push('mailto');
    if (settings.relayUrl && settings.visitCode) out.push('relay');
    return out;
  }

  function channelsLine(list) {
    return `canales ofrecidos / channels offered: ${(list || []).join(', ') || '—'}`;
  }

  // Only the relay may say "sent": share and mailto only hand the result to another app.
  function outcomeWord(channel, outcome) {
    const out = String(outcome == null ? '' : outcome);
    if (BILINGUAL.outcome[out]) return BILINGUAL.outcome[out];
    const m = /^(error|failed): (.*)$/.exec(out);
    if (!m) return { es: out, en: out };
    const base = BILINGUAL.outcome[m[1]];
    const why = channel === 'relay' && BILINGUAL.relayFailure[m[2]];
    return why ? { es: `${base.es}: ${why.es}`, en: `${base.en}: ${why.en}` } : { es: `${base.es}: ${m[2]}`, en: `${base.en}: ${m[2]}` };
  }

  // AC28: P6 gates Export only. A send carries complete=false in its subject and summary instead.
  function needsIncompleteWarning(action, evidence) {
    return action === 'export' && !(evidence && evidence.complete === true);
  }

  function maskCode(code) {
    return code ? '••••••' : '';
  }

  // Device settings live in their own key: Reset of the run keeps them, Forget removes it.
  function createSettings(storage) {
    const blank = () => ({ recipient: '', relayUrl: '', visitCode: '' });
    const str = (v) => (typeof v === 'string' ? v : '');
    function load() {
      try {
        const raw = storage && storage.getItem(SETTINGS_KEY);
        if (!raw) return blank();
        const o = JSON.parse(raw);
        return { recipient: str(o.recipient), relayUrl: str(o.relayUrl), visitCode: str(o.visitCode) };
      } catch (_) {
        return blank();
      }
    }
    function save(partial) {
      if (!storage) throw new Error('storage unavailable');
      const next = load();
      for (const k of ['recipient', 'relayUrl', 'visitCode']) {
        if (partial && typeof partial[k] === 'string') next[k] = partial[k].trim();
      }
      if (next.recipient && !EMAIL_RE.test(next.recipient)) throw new Error('recipient is not a valid address');
      if (next.relayUrl) parseHttpsUrl(next.relayUrl);
      if (next.visitCode.length > 256 || /[\u0000-\u0020\u007f]/.test(next.visitCode)) throw new Error('visit code has spaces or is too long');
      storage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    }
    function forget() {
      try { storage.removeItem(SETTINGS_KEY); } catch (_) { /* nothing to forget */ }
    }
    return { load, save, forget };
  }

  function compactScenario(sc) {
    const out = { id: sc.id, status: sc.status, notes: clip(sc.notes || '', 300) };
    const raw = sc.raw && typeof sc.raw === 'object' ? sc.raw : {};
    if (sc.id === 'D' && Array.isArray(sc.trials)) {
      out.trials = sc.trials.map((t) => ({
        id: t.id, status: t.status, overlayOn: t.overlayOn === true, freezeOn: t.freezeOn === true, eventsReceived: t.eventsReceived || 0,
        result: t.result || t.resultOn || null, notes: clip(t.notes || '', 200)
      }));
    }
    if (sc.id === 'B') { out.sbPresent = raw.sbPresent; out.scriptLoad = raw.scriptLoad; }
    if (sc.id === 'C') { out.pointerTypesObserved = raw.pointerTypesObserved; out.maxSimultaneousPointers = raw.maxSimultaneousPointers; }
    if (sc.id === 'E') {
      out.step1 = { verdict: raw.step1 && raw.step1.verdict, overlayOn: raw.step1 && raw.step1.overlayOn };
      out.step2 = { verdict: raw.step2 && raw.step2.verdict, overlayOn: raw.step2 && raw.step2.overlayOn, note: clip(raw.step2 && raw.step2.note, 200) };
    }
    if (sc.id === 'H6' && Array.isArray(raw.files)) out.files = raw.files;
    return out;
  }

  // AC23: the relay gets status, notes, verdicts, fingerprint and overlayFollow without timelines. Full JSON stays Export/Share.
  function compactRelayPayload(x) {
    const p = x || {};
    const fp = p.fingerprint || {};
    const list = Array.isArray(p.scenarios) ? p.scenarios : [];
    const out = { v: 1, runId: String(p.runId || '') };
    if (typeof p.startedAt === 'string') out.startedAt = p.startedAt;
    if (typeof p.finishedAt === 'string') out.finishedAt = p.finishedAt;
    out.runState = computeRunState(list);
    out.complete = !!(p.evidence && p.evidence.complete === true);
    out.hostClassification = p.hostClassification || fp.classification || 'other';
    out.fingerprint = {
      classification: fp.classification, confidence: fp.confidence, userAgent: clip(fp.userAgent, 300), maxTouchPoints: fp.maxTouchPoints,
      platform: fp.platform, vendor: fp.vendor, screenWidth: fp.screenWidth, screenHeight: fp.screenHeight, dpr: fp.dpr,
      standalone: fp.standalone, protocol: fp.protocol, isSecureContext: fp.isSecureContext,
      operator: fp.operator ? { gxModel: clip(fp.operator.gxModel, 80), browsers: clip(fp.operator.browsers, 80), overlayAtStart: fp.operator.overlayAtStart, freezeAtStart: fp.operator.freezeAtStart } : undefined
    };
    out.scenarios = list.map(compactScenario);
    const of = p.overlayFollow;
    if (of && typeof of === 'object') {
      const trials = {};
      for (const id of H_IDS) {
        const t = (of.trials && of.trials[id]) || {};
        trials[id] = { verdict: t.verdict == null ? null : t.verdict, overlayOn: t.overlayOn === true, notes: clip(t.notes || '', 300), recalled: t.recalled === true, truncated: t.truncated === true, counts: t.counts };
      }
      const h5 = {};
      for (const id of H5_IDS) h5[id] = { answer: (of.h5 && of.h5[id] && of.h5[id].answer) || null, note: clip(of.h5 && of.h5[id] && of.h5[id].note, 200) };
      out.overlayFollow = {
        mechanism: of.mechanism, complete: of.complete === true, trials, h4: clip(of.h4 || '', 1000), h5,
        signals: (of.signals || []).map((s) => ({ tapAt: s.tapAt, count: s.events.length, kinds: Array.from(new Set(s.events.map((ev) => ev.kind))) }))
      };
    }
    // The Worker whitelist caps delivery[] at 50 (worker/relay-core.mjs); keep the newest, or the 51st send would be a 400.
    out.delivery = (Array.isArray(p.delivery) ? p.delivery : []).slice(-50).map((d) => ({ channel: d.channel, at: d.at, outcome: d.outcome, runState: d.runState, confirmed: d.confirmed === true ? true : undefined }));
    out.summary = clip(buildSummary(p), 7900);
    return out;
  }

  // notes are sent as typed: count them for the "no student names" warning
  function notesStats(x) {
    const p = x || {};
    const texts = [];
    for (const s of Array.isArray(p.scenarios) ? p.scenarios : []) {
      if (s.notes) texts.push(s.notes);
      if (Array.isArray(s.trials)) for (const t of s.trials) if (t.notes) texts.push(t.notes);
    }
    const of = p.overlayFollow || {};
    for (const id of H_IDS) if (of.trials && of.trials[id] && of.trials[id].notes) texts.push(of.trials[id].notes);
    if (of.h4) texts.push(of.h4);
    for (const id of H5_IDS) if (of.h5 && of.h5[id] && of.h5[id].note) texts.push(of.h5[id].note);
    return { count: texts.length, chars: texts.reduce((n, t) => n + String(t).length, 0) };
  }

  function buildRelayRequest(opts) {
    const o = opts || {};
    parseHttpsUrl(o.relayUrl);
    return {
      url: o.relayUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Visit-Code': o.visitCode },
        body: JSON.stringify(o.payload),
        mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
      },
      timeoutMs: RELAY_TIMEOUT_MS
    };
  }

  // P9 data: host and size, never the code. `preview` is the compact payload itself (read-only view).
  function describeRelayConfirm(opts) {
    const o = opts || {};
    return {
      host: parseHttpsUrl(o.relayUrl).host,
      bytes: new TextEncoder().encode(JSON.stringify(o.payload)).length,
      preview: JSON.stringify(o.payload, null, 2)
    };
  }

  // One POST, no retry. 'sent' | 'failed: <fixed reason>'; nothing from the response or the error text is echoed.
  async function sendRelay(opts) {
    const o = opts || {};
    const req = buildRelayRequest(o);
    const ctrl = new AbortController();
    const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : req.timeoutMs;
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onCancel = () => { cancelled = true; ctrl.abort(); };
    if (o.signal) {
      if (o.signal.aborted) onCancel();
      else o.signal.addEventListener('abort', onCancel);
    }
    try {
      const res = await o.fetchImpl(req.url, Object.assign({}, req.init, { signal: ctrl.signal }));
      if (res && res.ok) return 'sent';
      const s = res ? res.status : 0;
      if (s === 401) return 'failed: wrong-code';
      if (s === 413) return 'failed: too-large';
      if (s === 400 || s === 415) return 'failed: bad-format';
      if (s >= 500) return 'failed: relay-5xx';
      if (s === 403) return 'failed: origin-refused';
      return 'failed: http-' + s;
    } catch (e) {
      if (cancelled) return 'failed: cancelled';
      if (timedOut || (e && e.name === 'AbortError')) return 'failed: timeout';
      if (e instanceof TypeError || (e && e.name === 'TypeError')) return 'failed: network';
      return 'failed: error';
    } finally {
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', onCancel);
    }
  }

  // OQ12: the private link's #fragment may survive in Chrome history, so it carries the Worker URL and an expiring token.
  // All-or-nothing: no partial import. `cleanedUrl` is the page URL without the fragment (for history.replaceState).
  function importFragment(hash, href) {
    const h = String(hash || '').replace(/^#/, '');
    if (!h) return null;
    const params = new URLSearchParams(h);
    const relayUrl = params.get('relay');
    const visitCode = params.get('code');
    if (!relayUrl || !visitCode) return null;
    try { parseHttpsUrl(relayUrl); } catch (_) { return null; }
    if (visitCode.length > 256 || /[\u0000-\u0020\u007f]/.test(visitCode)) return null;
    return { relayUrl, visitCode, cleanedUrl: String(href || '').replace(/#.*$/, '') };
  }

  function emptyScenario(extra) {
    return Object.assign({ status: 'idle', payload: null, notes: '' }, extra || {});
  }

  // Restored states from an older build may lack newer keys.
  function ensureShape(state) {
    const fresh = ProbeStore.prototype.createInitialState.call({});
    if (!state.operator) state.operator = fresh.operator;
    if (typeof state.activeSeconds !== 'number') state.activeSeconds = 0;
    for (const key of Object.keys(fresh.scenarios)) {
      if (!state.scenarios[key]) state.scenarios[key] = fresh.scenarios[key];
    }
    for (const key of Object.keys(fresh.scenarios.D.trials)) {
      if (!state.scenarios.D.trials[key]) state.scenarios.D.trials[key] = fresh.scenarios.D.trials[key];
    }
    if (!Array.isArray(state.log)) state.log = [];
    if (!state.overlayFollow || typeof state.overlayFollow !== 'object') state.overlayFollow = fresh.overlayFollow;
    const of = state.overlayFollow;
    if (!of.trials || typeof of.trials !== 'object') of.trials = fresh.overlayFollow.trials;
    for (const id of H_IDS) if (!of.trials[id]) of.trials[id] = emptyHTrial();
    if (!Array.isArray(of.taps)) of.taps = [];
    if (typeof of.h4 !== 'string') of.h4 = '';
    if (!of.h5 || typeof of.h5 !== 'object') of.h5 = fresh.overlayFollow.h5;
    for (const id of H5_IDS) if (!of.h5[id]) of.h5[id] = { answer: null, note: '' };
    if (!Array.isArray(state.delivery)) state.delivery = [];
    return state;
  }

  class ProbeStore {
    constructor(storage = null) {
      this.storage = storage;
      this.state = this.createInitialState();
    }

    createInitialState() {
      const now = new Date().toISOString();
      return {
        version: '0.1.0',
        runId: 'probe_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        startedAt: now,
        exportedAt: null,
        durationSeconds: 0,
        activeSeconds: 0,
        host: {
          classification: 'other',
          confidence: 0,
          userAgent: '',
          maxTouchPoints: 0,
          platform: '',
          vendor: '',
          screenWidth: 0,
          screenHeight: 0,
          dpr: 1,
          protocol: 'https:',
          standalone: false,
          isSecureContext: true
        },
        // Operator notes from scenario A / script step 2 (OQ1, OQ3). Overlay and Freeze are honor-system values.
        operator: { overlayAtStart: 'unknown', freezeAtStart: 'unknown', gxModel: '', browsers: '' },
        evidence: {
          complete: false,
          missing: ['all'],
          reasons: ['Initial unrun state']
        },
        scenarios: {
          A: emptyScenario(),
          B: emptyScenario(),
          C: emptyScenario({ eventCount: 0 }),
          D: {
            status: 'idle',
            notes: '',
            trials: {
              D1: { status: 'idle', overlayOn: false, eventsReceived: 0, notes: '' },
              D2: { status: 'idle', overlayOn: false, eventsReceived: 0, notes: '' },
              D3: { status: 'idle', overlayOn: false, eventsReceived: 0, notes: '' },
              D4: { status: 'idle', overlayOn: false, eventsReceived: 0, notes: '' },
              D5: { status: 'idle', overlayOn: false, freezeOn: false, eventsReceived: 0, notes: '' },
              D6: { status: 'idle', overlayOn: false, eventsReceived: 0, notes: '' }
            }
          },
          E: emptyScenario({ strokeCount: 0 }),
          H: emptyScenario(),
          H6: emptyScenario(),
          F: emptyScenario(),
          G: emptyScenario(),
          iframe: emptyScenario(),
          file: emptyScenario()
        },
        log: [],
        overlayFollow: newOverlayFollow(),
        delivery: []
      };
    }

    log(message, level = 'info') {
      const entry = {
        ts: new Date().toISOString(),
        level,
        message
      };
      this.state.log.push(entry);
      this.persist();
      return entry;
    }

    setScenarioResult(scenarioId, status, payload = null, notes = '') {
      if (this.state.scenarios[scenarioId]) {
        this.state.scenarios[scenarioId].status = status;
        if (payload !== null) this.state.scenarios[scenarioId].payload = payload;
        if (notes) this.state.scenarios[scenarioId].notes = notes;
      }
      this.updateEvidence();
      this.persist();
    }

    setTrialResult(trialId, status, details = {}) {
      if (this.state.scenarios.D && this.state.scenarios.D.trials[trialId]) {
        Object.assign(this.state.scenarios.D.trials[trialId], {
          status,
          ...details
        });
      }
      // D is finished when every trial is terminal; all-n/a is n/a, anything else is a completed run.
      const trials = Object.values(this.state.scenarios.D.trials);
      const allDone = trials.every(t => TERMINAL.includes(t.status));
      if (allDone) {
        this.state.scenarios.D.status = trials.every(t => t.status === 'na') ? 'na' : 'pass';
      }
      this.updateEvidence();
      this.persist();
    }

    runState() {
      return computeRunState(Object.keys(this.state.scenarios).map((id) => {
        const s = this.state.scenarios[id];
        return { id, status: s.status, trials: id === 'D' ? Object.values(s.trials) : undefined };
      }));
    }

    // H: scenario status follows the trials. pass = H1a, H1b, H2, H3 all terminal (H2 may be skipped with a reason).
    // `stays` is a verdict, never a failure. A scenario skipped with a reason (n/a) is left alone until a trial is recorded.
    syncH() {
      const trials = this.state.overlayFollow.trials;
      const h = this.state.scenarios.H;
      if (!H_IDS.some((id) => trials[id].verdict)) {
        if (h.status === 'running' || h.status === 'pass') h.status = 'idle';
        return;
      }
      h.status = H_IDS.every((id) => isHTrialTerminal(trials[id])) ? 'pass' : 'running';
    }

    // Re-running a trial replaces it (last verdict wins). Extra keys (counts, variant) are kept as given.
    setHTrial(id, trial) {
      const t = trial || {};
      const check = validateTrialVerdict(id, t.verdict, { overlayOn: t.overlayOn, notes: t.notes });
      if (!check.ok) throw new Error(`H trial ${id}: ${check.error}`);
      const prev = this.state.overlayFollow.trials[id] || {};
      const next = Object.assign(emptyHTrial(), prev.variant ? { variant: prev.variant } : {}, t);
      next.overlayOn = t.overlayOn === true;
      this.state.overlayFollow.trials[id] = next;
      this.syncH();
      this.persist();
      return next;
    }

    // optional cross-check on any ordinary long site (spec: a variant of H1a, never required)
    setHVariant(site, verdict) {
      const t = this.state.overlayFollow.trials.H1a;
      if (!site && !verdict) delete t.variant;
      else t.variant = { site: String(site || ''), verdict: verdict || null };
      this.persist();
    }

    addOverlayTap(t) {
      this.state.overlayFollow.taps.push(Number(t));
      this.persist();
    }

    setH4(text) {
      this.state.overlayFollow.h4 = String(text == null ? '' : text);
      this.persist();
    }

    // H5e = no makes H5f not applicable: unknown plus an automatic note. Changing H5e away from no releases H5f again.
    setH5(id, answer, note) {
      const h5 = this.state.overlayFollow.h5;
      if (!H5_IDS.includes(id)) throw new Error('unknown H5 row ' + id);
      if (!H5_ANSWERS.includes(answer)) throw new Error('H5 answer must be yes, no or unknown');
      h5[id] = { answer, note: String(note == null ? '' : note) };
      if (id === 'H5e') {
        if (answer === 'no') h5.H5f = { answer: 'unknown', note: H5_AUTO_NOTE };
        else if (h5.H5f && h5.H5f.note === H5_AUTO_NOTE) h5.H5f = { answer: null, note: '' };
      }
      this.persist();
    }

    setH5Note(id, note) {
      const h5 = this.state.overlayFollow.h5;
      if (!H5_IDS.includes(id)) throw new Error('unknown H5 row ' + id);
      h5[id].note = String(note == null ? '' : note);
      this.persist();
    }

    // G2: one entry per send attempt. A send never touches scenarios or evidence.complete.
    addDelivery(d) {
      const channel = d && d.channel;
      const outcome = d && d.outcome;
      if (!DELIVERY_CHANNELS.includes(channel)) throw new Error('unknown channel ' + channel);
      if (typeof outcome !== 'string' || !DELIVERY_OUTCOME_OK[channel](outcome)) throw new Error(`outcome ${outcome} is not valid for ${channel}`);
      const entry = { channel, at: new Date().toISOString(), outcome, runState: this.runState() };
      this.state.delivery.push(entry);
      this.persist();
      return entry;
    }

    // The «Llegó» tick is operator-attested; it is never inferred.
    confirmDelivery(i, on = true) {
      const entry = this.state.delivery[i];
      if (!entry) return;
      if (on) entry.confirmed = true;
      else delete entry.confirmed;
      this.persist();
    }

    updateEvidence() {
      this.state.evidence = computeEvidenceComplete(this.state);
    }

    persist() {
      if (!this.storage) return;
      try {
        this.storage.setItem('smart-board-probe:last', JSON.stringify(this.state));
      } catch (err) {
        // Storage quota or restricted environment
      }
    }

    restore() {
      if (!this.storage) return false;
      try {
        const raw = this.storage.getItem('smart-board-probe:last');
        if (!raw) return false;
        const loaded = JSON.parse(raw);
        if (loaded && loaded.version === '0.1.0') {
          this.state = ensureShape(loaded);
          return true;
        }
      } catch (err) {
        // Invalid json
      }
      return false;
    }

    clearSaved() {
      if (this.storage) {
        try {
          this.storage.removeItem('smart-board-probe:last');
        } catch (_) {}
      }
    }

    // AC1/AC6 export: startedAt, finishedAt, fingerprint, hostClassification, evidence.complete and
    // scenarios[] where each entry is { id, status, notes, raw } (D also carries trials[]).
    exportPayload() {
      const now = new Date();
      const started = new Date(this.state.startedAt);
      const durationSeconds = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));

      this.updateEvidence();
      const snapshot = JSON.parse(JSON.stringify(this.state));
      const outStatus = (s) => (s === 'na' ? 'n/a' : s);

      const scenarios = Object.keys(snapshot.scenarios).map((id) => {
        const sc = snapshot.scenarios[id];
        const entry = { id, status: outStatus(sc.status), notes: sc.notes || '', raw: sc.payload === undefined ? null : sc.payload };
        if (id === 'D') {
          entry.trials = Object.keys(sc.trials).map((tid) => {
            const tr = sc.trials[tid];
            return { id: tid, ...tr, status: outStatus(tr.status) };
          });
        }
        return entry;
      });

      const { scenarios: _drop, ...rest } = snapshot;
      const of = snapshot.overlayFollow;
      const allTimelines = H_IDS.reduce((acc, id) => acc.concat(Array.isArray(of.trials[id] && of.trials[id].timeline) ? of.trials[id].timeline : []), []);
      return {
        ...rest,
        exportedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationSeconds,
        hostClassification: snapshot.host.classification,
        fingerprint: { ...snapshot.host, operator: snapshot.operator },
        scenarios,
        overlayFollow: {
          mechanism: computeOverlayMechanism(of.trials),
          signals: computeOverlaySignals(of.taps, allTimelines),
          complete: isHComplete(snapshot),
          trials: of.trials,
          h4: of.h4,
          h5: of.h5,
          taps: of.taps
        },
        delivery: snapshot.delivery
      };
    }
  }

  // Pointer event taxonomy normalizer
  function normalizePointerEvent(evt) {
    const touch = evt.touches && evt.touches[0] ? evt.touches[0] : (evt.changedTouches && evt.changedTouches[0]) || null;
    return {
      type: evt.type,
      pointerType: evt.pointerType || (touch ? 'touch' : 'mouse'),
      pointerId: evt.pointerId ?? (touch ? touch.identifier : 0),
      isPrimary: Boolean(evt.isPrimary),
      pressure: typeof evt.pressure === 'number' ? evt.pressure : 0,
      tiltX: evt.tiltX || 0,
      tiltY: evt.tiltY || 0,
      width: evt.width || 1,
      height: evt.height || 1,
      buttons: evt.buttons || 0,
      clientX: evt.clientX || (touch ? touch.clientX : 0),
      clientY: evt.clientY || (touch ? touch.clientY : 0),
      timestamp: evt.timeStamp || Date.now()
    };
  }

  return {
    BILINGUAL,
    classifyHost,
    computeEvidenceComplete,
    ProbeStore,
    normalizePointerEvent,
    // H
    H_IDS,
    H5_IDS,
    H_VERDICTS,
    SURFACE_FOR_TRIAL,
    isHTrialTerminal,
    isHComplete,
    computeOverlayMechanism,
    validateTrialVerdict,
    createTrialRecorder,
    finalizeTrial,
    computeOverlaySignals,
    surfaceSpec,
    dockPlacement,
    describeSharedFile,
    // G2
    computeRunState,
    exportFilename,
    buildSummary,
    buildMailto,
    buildShareFile,
    runShare,
    offeredChannels,
    channelsLine,
    outcomeWord,
    needsIncompleteWarning,
    maskCode,
    createSettings,
    compactRelayPayload,
    notesStats,
    buildRelayRequest,
    describeRelayConfirm,
    sendRelay,
    importFragment
  };
});
