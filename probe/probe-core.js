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
      { id: 'F', es: 'Capacidades de Chrome', en: 'Chrome capabilities', required: false },
      { id: 'G', es: 'Almacenamiento y exportar', en: 'Storage and export', required: false },
      { id: 'iframe', es: 'A y B en iframe', en: 'A and B in an iframe', required: false, optional: true },
      { id: 'file', es: 'A y B desde file://', en: 'A and B from file://', required: false, optional: true }
    ],
    steps: [
      { num: 1, targets: ['A'],
        es: 'Abre esta página en el Chrome del tablero, no en un portátil.',
        en: 'Open this page in the board’s Chrome, not on a laptop.' },
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
      { num: 7, targets: ['F'],
        es: 'F: comprobaciones de Chrome.',
        en: 'F: Chrome checks.' },
      { num: 8, targets: ['G'],
        es: 'Exporta el JSON, copia el registro y deja la pestaña abierta hasta que se guarde en Descargas.',
        en: 'Export the JSON, copy the log, and leave the tab open until it is saved to Downloads.' }
    ]
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
          F: emptyScenario(),
          G: emptyScenario(),
          iframe: emptyScenario(),
          file: emptyScenario()
        },
        log: []
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
      return {
        ...rest,
        exportedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationSeconds,
        hostClassification: snapshot.host.classification,
        fingerprint: { ...snapshot.host, operator: snapshot.operator },
        scenarios
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
    normalizePointerEvent
  };
});
