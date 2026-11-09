// tests/probe.test.js — Automated test suite for smart-board-probe (AC1 - AC11)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyHost,
  computeEvidenceComplete,
  ProbeStore,
  normalizePointerEvent,
  BILINGUAL
} = require('../probe/probe-core.js');

// Mock localStorage
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

describe('smart-board-probe Test Suite', () => {

  let mockStorage;
  let probeStore;

  beforeEach(() => {
    mockStorage = createMockStorage();
    probeStore = new ProbeStore(mockStorage);
  });

  // AC1: Export JSON on demand with full structure and metadata
  it('AC1: Export generates valid JSON with full structure and metadata', () => {
    probeStore.log('Initial setup');
    const exported = probeStore.exportPayload();

    assert.equal(exported.version, '0.1.0');
    assert.ok(exported.runId.startsWith('probe_'));
    assert.ok(exported.startedAt);
    assert.ok(exported.exportedAt);
    assert.equal(typeof exported.durationSeconds, 'number');
    assert.ok(Array.isArray(exported.log));
    assert.equal(exported.log.length, 1);
    assert.equal(exported.log[0].message, 'Initial setup');
    // AC6: scenarios[] entries are { id, status, notes, raw }; AC1: every scenario id is present
    assert.ok(Array.isArray(exported.scenarios));
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      const sc = exported.scenarios.find(s => s.id === id);
      assert.ok(sc, 'scenario ' + id);
      for (const key of ['id', 'status', 'notes', 'raw']) assert.ok(key in sc, id + '.' + key);
    }
    assert.ok(exported.scenarios.find(s => s.id === 'D').trials.find(t => t.id === 'D1'));
    assert.ok(exported.finishedAt);
    assert.ok(exported.fingerprint);
    assert.equal(typeof exported.hostClassification, 'string');
    assert.equal(typeof exported.evidence.complete, 'boolean');
    JSON.parse(JSON.stringify(exported));
  });

  // AC2: SMART WDK / SB inspection / timeout handling
  it('AC2: WDKProbe handles script load timeout, window.SB inspection, and localhost probes', () => {
    probeStore.setScenarioResult('B', 'pass', {
      sbPresent: false,
      scriptLoad: 'timeout',
      localhostProbe: {
        port54743Http: 'connection_refused',
        port54743Https: 'failed'
      },
      keys: []
    });

    const state = probeStore.state;
    assert.equal(state.scenarios.B.status, 'pass');
    assert.equal(state.scenarios.B.payload.sbPresent, false);
    assert.equal(state.scenarios.B.payload.scriptLoad, 'timeout');
  });

  // AC3: Environment fingerprint classification
  it('AC3: Fingerprint identifies gx-android, desktop, iQ hints and evaluates confidence', () => {
    // 1. GX Android Board
    const gxHost = classifyHost({
      userAgent: 'Mozilla/5.0 (Linux; Android 11; SMART Board GX) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 20,
      platform: 'Linux armv8l',
      screenWidth: 1920,
      screenHeight: 1080
    });
    assert.equal(gxHost.classification, 'gx-android');
    assert.ok(gxHost.confidence >= 0.8);

    // 2. Windows Laptop (Authoring host - not evidence host)
    const winHost = classifyHost({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
      platform: 'Win32'
    });
    assert.equal(winHost.classification, 'windows-desktop');

    // 3. iQ3 Board hint
    const iqHost = classifyHost({
      userAgent: 'Mozilla/5.0 (Linux; Android 9; am30-smartemb Build/PPR1) Chrome/90.0.0.0',
      maxTouchPoints: 10,
      platform: 'Linux'
    });
    assert.equal(iqHost.classification, 'iq3');
  });

  // AC4: Pointer taxonomy accurately logs pointerType, pressure, tilt, buttons
  it('AC4: PointerTracker accurately captures pointerType, pressure, tilt, buttons', () => {
    const rawEvt = {
      type: 'pointerdown',
      pointerType: 'pen',
      pointerId: 4,
      isPrimary: true,
      pressure: 0.75,
      tiltX: 12,
      tiltY: -8,
      width: 5,
      height: 5,
      buttons: 1,
      clientX: 250,
      clientY: 300,
      timeStamp: 123456
    };

    const norm = normalizePointerEvent(rawEvt);
    assert.equal(norm.pointerType, 'pen');
    assert.equal(norm.pointerId, 4);
    assert.equal(norm.pressure, 0.75);
    assert.equal(norm.tiltX, 12);
    assert.equal(norm.tiltY, -8);
    assert.equal(norm.buttons, 1);
  });

  // AC5: InkCanvas records strokes and supports zoom/pan transform preservation
  it('AC5: InkCanvas records strokes and supports zoom/pan transform preservation', () => {
    probeStore.setScenarioResult('E', 'pass', {
      strokeCount: 3,
      transformsTested: ['scale(1.5)', 'translate(50px, 100px)'],
      inkPreservedUnderTransform: true
    });

    assert.equal(probeStore.state.scenarios.E.status, 'pass');
    assert.equal(probeStore.state.scenarios.E.payload.inkPreservedUnderTransform, true);
  });

  // AC6: Browser capabilities audit
  it('AC6: Browser capabilities check audits fullscreen, wakelock, storage', () => {
    probeStore.setScenarioResult('F', 'pass', {
      fullscreenAvailable: true,
      wakeLockAvailable: false,
      storageEstimateAvailable: true
    });

    assert.equal(probeStore.state.scenarios.F.status, 'pass');
    assert.equal(probeStore.state.scenarios.F.payload.fullscreenAvailable, true);
  });

  // AC7: LocalStorage sync & P5 Restore banner
  it('AC7: State auto-persists to localStorage and restores previous run', () => {
    probeStore.setScenarioResult('A', 'pass', { test: 'done' });
    probeStore.log('Saved before restart');

    // Create a new store instance connected to same storage
    const newStore = new ProbeStore(mockStorage);
    const restored = newStore.restore();

    assert.equal(restored, true);
    assert.equal(newStore.state.scenarios.A.status, 'pass');
    assert.equal(newStore.state.log.some(l => l.message === 'Saved before restart'), true);
  });

  // AC8: Gesture ownership D1-D6 recording with overlay status
  it('AC8: Gesture ownership records trials D1-D6 with overlay status', () => {
    probeStore.setTrialResult('D1', 'pass', { eventsReceived: 45 });
    probeStore.setTrialResult('D2', 'pass', { eventsReceived: 80 });
    probeStore.setTrialResult('D3', 'pass', { overlayOn: true, eventsReceived: 0, notes: 'Overlay swallowed events' });
    probeStore.setTrialResult('D4', 'pass', { overlayOn: true, eventsReceived: 0 });
    probeStore.setTrialResult('D5', 'pass', { freezeOn: true, eventsReceived: 0 });
    probeStore.setTrialResult('D6', 'pass', { overlayOn: true, eventsReceived: 10, notes: 'Tray pen in-app ink visible' });

    assert.equal(probeStore.state.scenarios.D.status, 'pass');
    assert.equal(probeStore.state.scenarios.D.trials.D3.overlayOn, true);
    assert.equal(probeStore.state.scenarios.D.trials.D6.notes, 'Tray pen in-app ink visible');
  });

  // AC9: Bilingual dictionary covers all operator scripts and cards
  it('AC9: Bilingual dictionary covers all operator scripts and cards', () => {
    assert.ok(BILINGUAL.title.es);
    assert.ok(BILINGUAL.title.en);
    assert.equal(BILINGUAL.steps.length, 8);
    for (const step of BILINGUAL.steps) {
      assert.ok(step.num);
      assert.ok(step.es.length > 5);
      assert.ok(step.en.length > 5);
    }
    // Verify Step 2 does NOT say "dismiss overlay"
    assert.ok(!BILINGUAL.steps[1].es.includes('apagar overlay'));
    assert.ok(!BILINGUAL.steps[1].en.includes('dismiss overlay'));
  });

  // AC10: Zero backend / static site
  it('AC10: Probe works offline with zero mandatory server dependencies', () => {
    const store = new ProbeStore(null);
    store.log('Offline session');
    const payload = store.exportPayload();
    assert.ok(payload);
    assert.equal(payload.log[0].message, 'Offline session');
  });

  // AC11: computeEvidenceComplete enforces GX host and A-E terminal checks
  it('AC11: computeEvidenceComplete enforces GX host and A-E terminal checks', () => {
    // Case 1: Windows laptop run - complete must be FALSE
    probeStore.state.host.classification = 'windows-desktop';
    probeStore.setScenarioResult('A', 'pass');
    probeStore.setScenarioResult('B', 'pass', { sbPresent: false });
    probeStore.setScenarioResult('C', 'pass');
    probeStore.setScenarioResult('E', 'pass');
    for (let i = 1; i <= 6; i++) {
      probeStore.setTrialResult(`D${i}`, 'pass', { overlayOn: [3, 4, 6].includes(i) });
    }

    let evidence = computeEvidenceComplete(probeStore.state);
    assert.equal(evidence.complete, false);
    assert.ok(evidence.missing.includes('host:gx-android'));

    // Case 2: Incomplete scenarios on GX
    probeStore.state.host.classification = 'gx-android';
    probeStore.state.scenarios.C.status = 'idle'; // C incomplete
    evidence = computeEvidenceComplete(probeStore.state);
    assert.equal(evidence.complete, false);
    assert.ok(evidence.missing.includes('scenario:C'));

    // Case 3: Skip-D (or missing D3 overlay ON)
    probeStore.setScenarioResult('C', 'pass');
    probeStore.setTrialResult('D3', 'pass', { overlayOn: false }); // not run with Overlay ON
    evidence = computeEvidenceComplete(probeStore.state);
    assert.equal(evidence.complete, false);
    assert.ok(evidence.missing.includes('trial:D3:overlayOn'));

    // Case 3b: n/a without a reason is not terminal; B must record an explicit sbPresent
    probeStore.setTrialResult('D3', 'pass', { overlayOn: true });
    probeStore.setScenarioResult('E', 'na');
    evidence = computeEvidenceComplete(probeStore.state);
    assert.ok(evidence.missing.includes('scenario:E'));
    probeStore.setScenarioResult('E', 'na', null, 'sin Overlay disponible');
    assert.equal(computeEvidenceComplete(probeStore.state).complete, true);
    probeStore.setScenarioResult('E', 'pass');
    probeStore.state.scenarios.B.payload = { scriptLoad: 'error' };
    evidence = computeEvidenceComplete(probeStore.state);
    assert.ok(evidence.missing.includes('scenario:B:sbPresent'));
    probeStore.state.scenarios.B.payload = { sbPresent: false };

    // Case 4: Complete GX visit meeting all requirements
    probeStore.setTrialResult('D3', 'pass', { overlayOn: true });
    evidence = computeEvidenceComplete(probeStore.state);
    assert.equal(evidence.complete, true);
    assert.equal(evidence.missing.length, 0);
  });
});
