// probe/app.js — UI controller for smart-board-probe (P0 shell … P6 gate, scenarios A–G + iframe / file://).
// Markup uses the Classroom design system (ds-*) and Lucide icons (ic ic-*); colours come from tokens only.
(function () {
  'use strict';

  const Core = window.ProbeCore;
  const { BILINGUAL, classifyHost, ProbeStore, normalizePointerEvent } = Core;

  const WDK_URL = 'https://api.smarttech.com/lib/smartboard-1.3.11-min.js';
  const LS_PREV = 'smart-board-probe:prev';
  const REQUIRED = ['A', 'B', 'C', 'D', 'E'];
  const TERMINAL = ['pass', 'fail', 'na'];
  const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
  const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend'];
  const MOUSE_EVENTS = ['mousedown', 'mouseup'];
  const ALL_EVENTS = POINTER_EVENTS.concat(TOUCH_EVENTS, MOUSE_EVENTS);

  const store = new ProbeStore(null); // storage is attached once the restore banner is resolved (AC7)
  let ls = null;
  try { ls = window.localStorage; } catch (_) { ls = null; }
  let settings = Core.createSettings(ls); // device settings (recipient, relay URL, visit code): own key, outlive Reset (AC28)

  let activeId = 'A';
  let pendingRestore = null; // { raw, state } | { raw, error: true }
  let paneCleanup = null;
  let rawLog = false;
  let beepMuted = false;
  let modalState = null;

  const el = {
    chips: document.getElementById('head-chips'),
    banner: document.getElementById('restore-banner'),
    rail: document.getElementById('script-rail'),
    list: document.getElementById('scenario-list'),
    pane: document.getElementById('work-pane'),
    log: document.getElementById('live-log'),
    modal: document.getElementById('modal-root'),
    dvh: document.getElementById('dvh-probe'),
    export: document.getElementById('btn-export'),
    reset: document.getElementById('btn-reset'),
    send: document.getElementById('btn-send'),
    shareBanner: document.getElementById('share-banner'),
    importBanner: document.getElementById('import-banner'),
    writerBanner: document.getElementById('writer-banner'),
    surface: document.getElementById('surface-root')
  };

  /* ------------------------------------------------------------------ helpers */

  const acts = Object.create(null); // data-act (click) / data-chg (change|input) handlers, set per pane
  const sc = (id) => store.state.scenarios[id];
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errStr = (e) => (e && e.name ? `${e.name}: ${e.message}` : String(e));
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isTerminalStatus = (s) => TERMINAL.includes(s);
  const meta = (id) => BILINGUAL.scenarios.find((m) => m.id === id);

  // bilingual stack: ES first, EN second (arguments are trusted static markup)
  const bi = (es, en, cls) => `<span class="ds-bi${cls ? ' ' + cls : ''}"><span class="ds-bi__es" lang="es">${es}</span><span class="ds-bi__en" lang="en">${en}</span></span>`;
  const biInline = (es, en) => (es === en ? `<span lang="es">${es}</span>` : `<span lang="es">${es}</span> <span lang="en" class="t-muted">/ ${en}</span>`);
  const ic = (name, size) => `<span class="ic ic-${name} ic--${size || 'md'}" aria-hidden="true"></span>`;
  const L = (es, en) => `${es} / ${en}`;
  const pad2 = (n) => String(n).padStart(2, '0');

  function say(es, en, level) {
    store.log(L(es, en), level || 'info');
    renderLog();
  }

  function safeJson(v, indent) {
    try { return JSON.stringify(v, null, indent); } catch (e) { return String(v); }
  }

  function preview(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'function') return 'function';
    if (typeof v === 'object') { const s = safeJson(v); return s && s.length > 300 ? s.slice(0, 300) + '…' : s; }
    return String(v);
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => reject(Object.assign(new Error('timeout after ' + ms + ' ms'), { name: 'TimeoutError' })), ms);
      promise.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to the textarea route */ }
    try {
      const ta = document.createElement('textarea');
      ta.className = 'probe-offscreen';
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ markup builders */

  const STATUS_UI = {
    idle: { tone: '', icon: 'circle' },
    running: { tone: 'info', icon: 'clock' },
    pass: { tone: 'success', icon: 'circle-check' },
    fail: { tone: 'error', icon: 'circle-alert' },
    na: { tone: '', icon: 'minus' }
  };

  function statusBadge(status) {
    const ui = STATUS_UI[status] || STATUS_UI.idle;
    const word = BILINGUAL.status[status] || BILINGUAL.status.idle;
    return `<span class="ds-badge${ui.tone ? ' ds-badge--' + ui.tone : ''} probe-status--${status}">${ic(ui.icon, 'sm')}<span lang="es">${word.es}</span><span aria-hidden="true">/</span><span lang="en">${word.en}</span></span>`;
  }

  function radio(name, value, checked, disabled, es, en, attrs) {
    return `<label class="ds-radio probe-opt"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} ${attrs || ''}><span class="ds-radio__dot"></span>${bi(es, en)}</label>`;
  }

  function check(name, checked, disabled, es, en, attrs) {
    return `<label class="ds-check probe-opt"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} ${attrs || ''}><span class="ds-check__box">${ic('check', 'sm')}</span>${bi(es, en)}</label>`;
  }

  function btn(act, es, en, opts) {
    const o = opts || {};
    const cls = ['ds-btn', o.variant ? 'ds-btn--' + o.variant : ''].filter(Boolean).join(' ');
    const filled = !o.variant || o.variant === 'danger' || o.variant === 'accent';
    return `<button type="button" class="${cls}" data-act="${act}"${o.attrs ? ' ' + o.attrs : ''}${o.disabled ? ' disabled' : ''}>${o.icon ? ic(o.icon) : ''}${bi(es, en, filled ? 'ds-bi--on-dark' : '')}</button>`;
  }

  function field(label, hint, input) {
    return `<label class="ds-field"><span class="ds-field__label"><span lang="es">${label[0]}</span><span class="en" lang="en">${label[1]}</span></span>${input}${hint ? `<span class="ds-field__hint">${hint}</span>` : ''}</label>`;
  }

  function kv(rows) {
    return `<dl class="probe-kv">${rows.map((r) => `<dt><span lang="es">${r[0]}</span>${r[1] === r[0] ? '' : `<span class="en" lang="en">${r[1]}</span>`}</dt><dd>${r[2]}</dd>`).join('')}</dl>`;
  }

  function dump(value, large) {
    return `<pre class="probe-dump${large ? ' probe-dump--lg' : ''}" tabindex="0">${esc(typeof value === 'string' ? value : safeJson(value, 2))}</pre>`;
  }

  function notice(es, en, icon) {
    return `<div class="ds-banner" role="status">${ic(icon || 'info', 'lg')}<div class="ds-banner__text"><span lang="es">${es}</span><span class="ds-banner__en" lang="en">${en}</span></div></div>`;
  }

  /* ------------------------------------------------------------------ persistence / restore (AC7) */

  function hasProgress(state) {
    if (!state || !state.scenarios) return false;
    const any = Object.values(state.scenarios).some((s) => s && s.status && s.status !== 'idle');
    const trials = state.scenarios.D && state.scenarios.D.trials ? Object.values(state.scenarios.D.trials).some((t) => t.status !== 'idle') : false;
    const o = state.operator || {};
    const of = state.overlayFollow;
    const answered = of ? Boolean(of.h4) || Object.values(of.h5 || {}).some((r) => r && r.answer) : false;
    const sent = Array.isArray(state.delivery) && state.delivery.length > 0;
    return any || trials || answered || sent || Boolean(o.gxModel || o.browsers);
  }

  function parseSaved(raw) {
    const tmp = new ProbeStore({ getItem: () => raw });
    return tmp.restore() ? tmp.state : null;
  }

  function checkForSavedRun() {
    if (!ls) return;
    let raw = null;
    let prev = null;
    try { raw = ls.getItem('smart-board-probe:last'); prev = ls.getItem(LS_PREV); } catch (_) { return; }
    // Move a worthwhile last run aside before the new visit overwrites it; the banner offers it back.
    if (raw) {
      const state = parseSaved(raw);
      if (state && hasProgress(state)) {
        try { ls.setItem(LS_PREV, raw); } catch (_) { /* quota */ }
        pendingRestore = { raw, state };
      } else if (!state) {
        try { ls.setItem(LS_PREV, raw); } catch (_) { /* quota */ }
        pendingRestore = { raw, error: true };
      }
    }
    if (!pendingRestore && prev) {
      const state = parseSaved(prev);
      pendingRestore = state ? { raw: prev, state } : { raw: prev, error: true };
    }
  }

  function renderBanner() {
    if (!pendingRestore) { el.banner.hidden = true; el.banner.innerHTML = ''; return; }
    el.banner.hidden = false;
    if (pendingRestore.error) {
      el.banner.innerHTML = `<div class="ds-banner ds-banner--error" role="alert">${ic('circle-alert', 'lg')}<div class="ds-banner__text"><span lang="es">No se pudo restaurar la visita guardada.</span><span class="ds-banner__en" lang="en">The saved visit could not be restored.</span></div><div class="probe-banner-actions">${btn('restore-discard', 'Descartar', 'Discard', { variant: 'secondary' })}</div></div>`;
      return;
    }
    const s = pendingRestore.state;
    const when = new Date(s.startedAt);
    const stamped = isNaN(when) ? '' : `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
    const done = Object.keys(s.scenarios).filter((k) => isTerminalStatus(s.scenarios[k].status)).join(' ');
    el.banner.innerHTML = `<div class="ds-banner" role="status">${ic('info', 'lg')}<div class="ds-banner__text"><span lang="es">${BILINGUAL.restoreTitle.es} Inicio ${stamped}${done ? ' · terminados: ' + esc(done) : ''}</span><span class="ds-banner__en" lang="en">${BILINGUAL.restoreTitle.en} Started ${stamped}${done ? ' · finished: ' + esc(done) : ''}</span></div><div class="probe-banner-actions">${btn('restore-yes', 'Restaurar', 'Restore', { variant: 'secondary' })}${btn('restore-discard', 'Descartar', 'Discard', { variant: 'secondary' })}</div></div>`;
  }

  function clearPrev() { if (ls) { try { ls.removeItem(LS_PREV); } catch (_) { /* ignore */ } } }

  acts['restore-yes'] = () => {
    if (!pendingRestore || pendingRestore.error) return;
    stopAllActivity();
    store.state = pendingRestore.state;
    pendingRestore = null;
    clearPrev();
    collectBasicFingerprint();
    store.updateEvidence();
    store.persist();
    say('Visita anterior restaurada', 'Previous visit restored');
    renderBanner();
    refresh();
    selectScenario(activeId);
  };
  acts['restore-discard'] = () => {
    pendingRestore = null;
    clearPrev();
    say('Visita anterior descartada', 'Previous visit discarded');
    renderBanner();
  };

  /* ------------------------------------------------------------------ fingerprint (A) */

  function basicInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      vendor: navigator.vendor || '',
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      dpr: window.devicePixelRatio || 1,
      protocol: window.location.protocol,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      isSecureContext: window.isSecureContext
    };
  }

  function collectBasicFingerprint(extra) {
    const info = Object.assign(basicInfo(), extra || {});
    const result = classifyHost(info);
    Object.assign(store.state.host, info, result);
    delete store.state.host.isIqAppDetected;
    store.updateEvidence();
    return result;
  }

  async function probeRelatedApps() {
    if (typeof navigator.getInstalledRelatedApps !== 'function') {
      return { invoked: false, available: false, reason: window.isSecureContext ? 'API not exposed by this browser' : 'not a secure context' };
    }
    try {
      const apps = await withTimeout(navigator.getInstalledRelatedApps(), 4000);
      return { invoked: true, result: apps.map((a) => ({ platform: a.platform, id: a.id, url: a.url, version: a.version })) };
    } catch (e) {
      return { invoked: true, error: errStr(e) };
    }
  }

  async function fingerprintFor(win) {
    const w = win || window;
    const n = w.navigator;
    const vv = w.visualViewport;
    const href = w.location.href;
    const proto = w.location.protocol;
    let related;
    if (typeof n.getInstalledRelatedApps !== 'function') {
      related = { invoked: false, available: false, reason: w.isSecureContext ? 'API not exposed by this browser' : 'not a secure context' };
    } else {
      try {
        const apps = await withTimeout(n.getInstalledRelatedApps(), 4000);
        related = { invoked: true, result: apps.map((a) => ({ platform: a.platform, id: a.id, url: a.url, version: a.version })) };
      } catch (e) {
        related = { invoked: true, error: errStr(e) };
      }
    }
    const dm = (q) => { try { return window.matchMedia('(display-mode: ' + q + ')').matches; } catch (_) { return null; } };
    return {
      userAgent: n.userAgent,
      platform: n.platform,
      maxTouchPoints: n.maxTouchPoints || 0,
      vendor: n.vendor || '',
      language: n.language,
      languages: Array.from(n.languages || []),
      screen: { width: w.screen.width, height: w.screen.height },
      viewport: { width: w.innerWidth, height: w.innerHeight, dpr: w.devicePixelRatio || 1 },
      visualViewportScale: vv ? vv.scale : null,
      displayMode: { standalone: dm('standalone'), fullscreen: dm('fullscreen'), minimalUi: dm('minimal-ui'), browser: dm('browser') },
      twa: (w.document.referrer || '').startsWith('android-app://'),
      href,
      protocol: proto,
      servedAs: proto === 'file:' ? 'file' : proto === 'https:' ? 'https' : 'http',
      isSecureContext: w.isSecureContext,
      uaIqMatch: /am30|smartemb/i.test(n.userAgent),
      relatedApps: related,
      topLevel: w.top === w.self
    };
  }

  function confidenceWord(c) {
    return c >= 0.8 ? ['alta', 'high'] : c >= 0.6 ? ['media', 'medium'] : ['baja', 'low'];
  }

  /* ------------------------------------------------------------------ P0 shell */

  function reqDone(id) {
    const miss = store.state.evidence.missing;
    return !miss.includes('scenario:' + id) && !(id === 'B' && miss.includes('scenario:B:sbPresent'));
  }

  function renderHead() {
    store.updateEvidence();
    const h = store.state.host;
    const ev = store.state.evidence;
    const served = h.protocol === 'file:' ? 'file:' : h.protocol === 'https:' ? 'https' : 'http';
    const secure = h.isSecureContext;
    const conf = confidenceWord(h.confidence);
    const secs = store.state.activeSeconds || 0;
    const clock = `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
    // Four chips only. The A–E, H and out counts live on the list (evidence bar, D / H / G cards), not up here.
    el.chips.innerHTML = [
      `<span class="ds-chip probe-chip probe-chip--info" aria-label="host">${ic('layout-grid', 'md')}${bi('host: ' + esc(h.classification), 'confianza ' + conf[0] + ' · confidence ' + conf[1])}</span>`,
      `<span class="ds-chip probe-chip ${secure ? 'probe-chip--ok' : 'probe-chip--warn'}">${ic(secure ? 'lock' : 'triangle-alert', 'md')}${bi(esc(served) + (secure ? ' · contexto seguro' : ' · sin contexto seguro'), esc(served) + (secure ? ' · secure context' : ' · not a secure context'))}</span>`,
      `<span class="ds-chip probe-chip">${ic('clock', 'md')}${bi('Visita', 'Visit')}<strong class="probe-count" id="visit-clock">${clock}</strong></span>`,
      ev.complete
        ? `<span class="ds-chip probe-chip probe-chip--ok" role="status">${ic('circle-check', 'md')}${bi('Evidencia completa', 'evidence.complete: yes')}</span>`
        : `<span class="ds-chip probe-chip probe-chip--warn" role="status">${ic('triangle-alert', 'md')}${bi('Evidencia incompleta', 'evidence.complete: no')}</span>`
    ].join('');
  }

  function tickClock() {
    if (document.hidden) return;
    store.state.activeSeconds = (store.state.activeSeconds || 0) + 1;
    const node = document.getElementById('visit-clock');
    if (node) {
      const s = store.state.activeSeconds;
      node.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
    }
    if (store.state.activeSeconds % 10 === 0) store.persist();
  }

  /* ------------------------------------------------------------------ P1 script rail */

  function stepDone(step) {
    if (step.num === 1) return sc('A').status !== 'idle';
    if (step.num === '1b') return store.state.delivery.length > 0 || ['B', 'C', 'D', 'E'].some((id) => sc(id).status !== 'idle');
    if (step.num === 2) { const o = store.state.operator; return o.overlayAtStart !== 'unknown' && o.freezeAtStart !== 'unknown'; }
    if (step.num === 9) return outCount() >= 2;
    return step.targets.every((id) => isTerminalStatus(sc(id).status));
  }

  // The guide is one tappable strip: the first step still to do (clamped; the full numbered script opens in a dialog).
  function renderRail() {
    const steps = BILINGUAL.steps;
    const current = steps.find((s) => !stepDone(s)) || null;
    const doneCount = steps.filter(stepDone).length;
    const text = current
      ? `<span class="probe-guide__num" aria-hidden="true">${current.num}</span>
        <span class="probe-guide__text"><span class="probe-guide__es" lang="es"><span class="probe-sr">${current.num}. </span>${esc(current.es)}</span><span class="probe-guide__en" lang="en">${esc(current.en)}</span></span>`
      : `<span class="probe-guide__num probe-guide__num--done" aria-hidden="true">${ic('check', 'md')}</span>
        <span class="probe-guide__text"><span class="probe-guide__es" lang="es">Guion terminado.</span><span class="probe-guide__en" lang="en">Script finished.</span></span>`;
    el.rail.innerHTML = `<button type="button" class="probe-guide" data-act="script-open" aria-haspopup="dialog">${text}
      <span class="probe-guide__all">${ic('clipboard-list', 'md')}${biInline('Guion', 'Script')} <strong class="probe-count">${doneCount}/${steps.length}</strong></span></button>`;
  }

  function openScript() {
    const steps = BILINGUAL.steps;
    const current = steps.find((s) => !stepDone(s)) || null;
    const items = steps.map((s) => {
      const done = stepDone(s);
      const isCur = current && current.num === s.num;
      return `<li><button type="button" class="probe-step${done ? ' probe-step--done' : ''}"${isCur ? ' aria-current="step"' : ''} data-act="step" data-step="${s.num}" aria-label="${s.num}. ${esc(s.es)}">
          <span class="probe-step__num">${done ? ic('check', 'sm') : s.num}</span>
          <span class="probe-step__text"><span class="probe-step__es" lang="es">${esc(s.es)}</span><span class="probe-step__en" lang="en">${esc(s.en)}</span></span></button></li>`;
    }).join('');
    openModal(dialogShell('Guion del operador', 'Operator script', `<ol class="probe-steps">${items}</ol>`, btn('modal-close', 'Cerrar', 'Close', { variant: 'ghost' })), { focus: current ? '[aria-current="step"]' : null });
  }

  acts['script-open'] = openScript;

  acts.step = (t) => {
    const step = BILINGUAL.steps.find((s) => String(s.num) === t.dataset.step);
    if (!step) return;
    closeModal();
    if (step.num === '1b') { openSend(); return; }
    selectScenario(step.targets[0], true);
  };

  /* ------------------------------------------------------------------ P2 scenario list */

  function trialsDone() {
    return Object.values(sc('D').trials).filter((t) => isTerminalStatus(t.status) && (t.status !== 'na' || (t.notes || '').trim())).length;
  }

  function holeTrial(tid) {
    const miss = store.state.evidence.missing;
    return miss.includes('trial:' + tid) || miss.includes('trial:' + tid + ':overlayOn');
  }

  // List cards show status as an icon only once it is not idle (the full word is in the pane head); the per-card skip arrow is gone: Skip… is in the pane head.
  function statusIcon(status) {
    const ui = STATUS_UI[status] || STATUS_UI.idle;
    const word = BILINGUAL.status[status] || BILINGUAL.status.idle;
    const said = `<span class="probe-sr"><span lang="es">${word.es}</span> / <span lang="en">${word.en}</span></span>`;
    if (status === 'idle' || !STATUS_UI[status]) return said;
    return `<span class="ds-badge probe-card__status${ui.tone ? ' ds-badge--' + ui.tone : ''} probe-status--${status}">${ic(ui.icon, 'md')}${said}</span>`;
  }

  function renderList() {
    const done = REQUIRED.filter(reqDone).length;
    const holes = ['D3', 'D4', 'D6'].map((tid) => {
      const hole = holeTrial(tid);
      return `<span class="ds-badge ${hole ? 'ds-badge--warning' : 'ds-badge--success'}">${ic(hole ? 'triangle-alert' : 'circle-check', 'sm')}${tid}<span class="probe-sr"> ${hole ? 'pendiente / pending' : 'completo / complete'}</span></span>`;
    }).join('');
    const card = (m) => {
      const s = sc(m.id);
      const hole = m.id === 'D' && ['D3', 'D4', 'D6'].some(holeTrial) && s.status !== 'idle';
      const letter = m.optional ? '' : `<span class="probe-card__letter">${m.id}</span>`;
      const extra = m.id === 'D' ? `<span class="ds-badge">${trialsDone()}/6</span>`
        : m.id === 'H' ? `<span class="ds-badge ds-badge--info">${hDoneCount()}/3</span><span class="ds-badge ds-badge--warning">${ic('clock', 'sm')}Antes de F / Before F</span>`
          : m.id === 'G' ? `<span class="ds-badge">${ic('upload', 'sm')}${biInline('salida', 'out')} ${outCount()}/2</span>` : '';
      const warn = m.warnEs ? `<span class="ds-badge ds-badge--warning">${ic('triangle-alert', 'sm')}${m.warnEs} / ${m.warnEn}</span>` : '';
      const metaRow = extra + warn;
      return `<li class="probe-card${hole ? ' probe-card--hole' : ''}" aria-current="${m.id === activeId}">
        <button type="button" class="probe-card__main" data-act="select" data-id="${m.id}"${s.status === 'running' ? ' aria-busy="true"' : ''}>
          <span class="probe-card__top">${letter}${bi(m.es, m.en)}${statusIcon(s.status)}</span>
          ${metaRow ? `<span class="probe-card__meta">${metaRow}</span>` : ''}
        </button>
      </li>`;
    };
    const main = BILINGUAL.scenarios.filter((m) => !m.optional && m.card !== false).map(card).join('');
    const optional = BILINGUAL.scenarios.filter((m) => m.optional && m.card !== false).map(card).join('');
    el.list.innerHTML = `<div class="ds-card ds-card--outline probe-summary">
        <div class="ds-progress"><span class="t-caption">A–E</span><div class="ds-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${done}" aria-label="Evidencia A–E / Evidence A–E"><div class="ds-progress__fill" data-pct="${done * 20}"></div></div><span>${done}/5</span></div>
        <div class="probe-summary__row"><span class="t-caption">Overlay ON</span>${holes}</div>
      </div>
      <ul class="probe-cards" role="list">${main}</ul>
      <p class="probe-list__rule t-caption">${biInline('Si hay tiempo', 'If time')}</p>
      <ul class="probe-cards" role="list">${optional}</ul>`;
    el.list.querySelectorAll('[data-pct]').forEach((n) => { n.style.width = n.dataset.pct + '%'; });
  }

  acts.select = (t) => selectScenario(t.dataset.id);
  acts.skip = (t) => openSkip(t.dataset.id);

  function refresh() {
    renderHead();
    renderRail();
    renderList();
    const ps = el.pane.querySelector('.probe-pane__status');
    if (ps) ps.innerHTML = statusBadge(sc(activeId).status);
  }

  /* ------------------------------------------------------------------ P4 live log */

  function logLine(l) {
    const d = new Date(l.ts);
    const icon = l.level === 'error' ? 'circle-alert' : l.level === 'warn' ? 'triangle-alert' : 'info';
    return `<div class="probe-log__line probe-log__line--${esc(l.level)}">${ic(icon, 'sm')}<time datetime="${esc(l.ts)}">${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}</time><span>${esc(l.message)}</span></div>`;
  }

  // Closed: a one-line strip with the newest event. Open: a drawer over the bottom of the page with the whole log.
  function renderLog() {
    const entries = store.state.log;
    const open = el.log.dataset.open === 'true';
    const active = document.activeElement;
    const focusKeep = active && el.log.contains(active) ? (active.dataset.act || active.dataset.chg || null) : null;
    let body = '';
    if (open) {
      if (!entries.length) body = `<p class="probe-log__empty">${biInline('sin eventos', 'no events')}</p>`;
      else if (rawLog) body = `<pre class="probe-log__raw" tabindex="0">${esc(safeJson(entries, 2))}</pre>`;
      else body = entries.map(logLine).join('');
    }
    const last = entries.length ? logLine(entries[entries.length - 1]) : `<p class="probe-log__empty">${biInline('sin eventos', 'no events')}</p>`;
    el.log.innerHTML = `<div class="probe-log__panel">
      <div class="probe-log__head">
        <h2 class="probe-log__title"><button type="button" class="ds-btn ds-btn--ghost probe-log__toggle" data-act="log-expand" aria-expanded="${open}" aria-controls="live-log-body">${ic(open ? 'chevron-down' : 'chevron-right', 'sm')}${biInline('Registro en vivo', 'Live log')}<span class="ds-badge">${entries.length}</span></button></h2>
        <div class="probe-log__last">${last}</div>
        <div class="probe-log__tools">
          ${open ? `<label class="ds-switch"><input type="checkbox" role="switch" data-chg="log-raw"${rawLog ? ' checked' : ''}><span class="ds-switch__track"></span><span>${biInline('Datos crudos', 'Raw')}</span></label>` : ''}
          <button type="button" class="ds-btn ds-btn--secondary probe-log__copy" data-act="log-copy">${ic('clipboard-list', 'md')}${biInline('Copiar registro', 'Copy log')}</button>
        </div>
      </div>
      <div class="probe-log__body" id="live-log-body" role="log" aria-live="off" tabindex="0">${body}</div>
    </div>`;
    if (open) {
      const b = el.log.querySelector('.probe-log__body');
      if (b) b.scrollTop = b.scrollHeight;
    }
    if (focusKeep) {
      const n = el.log.querySelector(`[data-act="${focusKeep}"], [data-chg="${focusKeep}"]`);
      if (n) n.focus({ preventScroll: true });
    }
  }

  acts['log-raw'] = (t) => { rawLog = t.checked; renderLog(); };
  acts['log-expand'] = () => { el.log.dataset.open = String(el.log.dataset.open !== 'true'); renderLog(); };
  acts['log-copy'] = () => copyLogAction();

  /* ------------------------------------------------------------------ modals (skip sheet, P6 gate, reset) */

  function openModal(html, opts) {
    closeModal(true);
    const o = opts || {};
    el.modal.innerHTML = `<div class="probe-modal${o.sheet ? ' probe-modal--sheet' : ''}"><div class="ds-scrim" data-act="modal-backdrop"><div class="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</div></div></div>`;
    modalState = { returnFocus: document.activeElement, onClose: o.onClose || null };
    const first = o.focus ? el.modal.querySelector(o.focus) : el.modal.querySelector('button, input, textarea');
    if (first) first.focus();
  }

  function closeModal(silent) {
    if (!modalState) return;
    const st = modalState;
    modalState = null;
    el.modal.innerHTML = '';
    if (!silent && st.returnFocus && st.returnFocus.focus) { try { st.returnFocus.focus(); } catch (_) { /* gone */ } }
    if (!silent && st.onClose) st.onClose();
  }

  acts['modal-close'] = () => closeModal();
  acts['modal-backdrop'] = (t, e) => { if (e.target === t) closeModal(); };

  function dialogShell(titleEs, titleEn, body, foot) {
    return `<div class="ds-dialog__head"><h2 class="ds-dialog__title" id="modal-title">${bi(titleEs, titleEn)}</h2><button type="button" class="ds-iconbtn" data-act="modal-close" aria-label="Cerrar / Close">${ic('x', 'lg')}</button></div>
      <div class="ds-dialog__body">${body}</div><div class="ds-dialog__foot">${foot}</div>`;
  }

  // Skip sheet: a reason is required; without one the scenario stays idle (not terminal).
  function openSkip(id) {
    const m = meta(id);
    const body = `<p>${biInline(`Saltar ${m.id}: ${esc(m.es)}`, `Skip ${m.id}: ${esc(m.en)}`)}</p>
      ${m.id === 'B' ? notice('No saltar B aunque parezca vacío.', 'Do not skip B even if it looks empty.', 'triangle-alert') : ''}
      <label class="ds-field"><span class="ds-field__label"><span lang="es">¿Por qué se salta?</span><span class="en" lang="en">Why is it skipped?</span></span>
        <textarea class="ds-input" id="skip-reason" rows="3" placeholder="¿Por qué se salta? / Why is it skipped?"></textarea>
        <span class="ds-field__error" id="skip-error" hidden>${ic('circle-alert', 'sm')}<span>Escribe un motivo para saltar. / Write a reason to skip.</span></span></label>`;
    const foot = `${btn('modal-close', 'Cancelar', 'Cancel', { variant: 'ghost' })}${btn('skip-confirm', 'Saltar', 'Skip', { attrs: `data-id="${id}"` })}`;
    openModal(dialogShell('Saltar escenario', 'Skip scenario', body, foot), { focus: '#skip-reason' });
  }

  acts['skip-confirm'] = (t) => {
    const reason = (document.getElementById('skip-reason').value || '').trim();
    if (!reason) {
      document.getElementById('skip-error').hidden = false;
      document.getElementById('skip-reason').setAttribute('aria-invalid', 'true');
      say(`Salto sin motivo: ${t.dataset.id} sigue pendiente`, `Skip without a reason: ${t.dataset.id} stays idle`, 'warn');
      return;
    }
    applySkip(t.dataset.id, reason);
    closeModal();
  };

  function applySkip(id, reason) {
    if (id === 'C' && cap.active) finishCapture('skip');
    if (id === 'D') {
      const d = sc('D');
      for (const tid of Object.keys(d.trials)) {
        if (!isTerminalStatus(d.trials[tid].status)) store.setTrialResult(tid, 'na', { notes: reason });
      }
      d.notes = reason;
      store.updateEvidence();
      store.persist();
    } else {
      store.setScenarioResult(id, 'na', null, reason);
    }
    say(`${id} saltado: ${reason}`, `${id} skipped: ${reason}`);
    refresh();
    if (activeId === id) renderPane(true);
  }

  // Collapses per-trial / per-scenario codes into a few readable lines.
  function missingList(codes) {
    const line = (es, en) => `<li>${biInline(esc(es), esc(en))}</li>`;
    const out = [];
    const trials = codes.filter((c) => /^trial:D\d$/.test(c)).map((c) => c.slice(6));
    const overlay = codes.filter((c) => /^trial:D\d:overlayOn$/.test(c)).map((c) => c.slice(6, 8));
    const scs = codes.filter((c) => /^scenario:\w$/.test(c)).map((c) => c.slice(9));
    if (codes.includes('host:gx-android')) out.push(line(...MISSING_TEXT('host:gx-android')));
    if (scs.length) out.push(line(`Sin terminar (o n/a sin motivo): ${scs.join(', ')}`, `Not terminal (or n/a without a reason): ${scs.join(', ')}`));
    if (codes.includes('scenario:B:sbPresent')) out.push(line(...MISSING_TEXT('scenario:B:sbPresent')));
    if (trials.length) out.push(line(`Ensayos sin terminar: ${trials.join(', ')}`, `Trials not terminal: ${trials.join(', ')}`));
    if (overlay.length) out.push(line(`Piden Overlay ON marcado: ${overlay.join(', ')}`, `Need Overlay ON ticked: ${overlay.join(', ')}`));
    return out.join('');
  }

  // P6 completeness gate (AC11)
  const MISSING_TEXT = (code) => {
    if (code === 'host:gx-android') return ['El host no es gx-android', 'Host is not gx-android'];
    let m;
    if ((m = /^scenario:(\w+):sbPresent$/.exec(code))) return ['B no registró sbPresent', 'B did not record sbPresent'];
    if ((m = /^scenario:(\w+)$/.exec(code))) return [`Escenario ${m[1]} sin terminar (o n/a sin motivo)`, `Scenario ${m[1]} not terminal (or n/a without a reason)`];
    if ((m = /^trial:(D\d):overlayOn$/.exec(code))) return [`${m[1]} pide Overlay ON marcado`, `${m[1]} needs Overlay ON ticked`];
    if ((m = /^trial:(D\d)$/.exec(code))) return [`Ensayo ${m[1]} sin terminar`, `Trial ${m[1]} not terminal`];
    return [code, code];
  };

  function openGate() {
    const ev = store.state.evidence;
    const items = missingList(ev.missing);
    const body = `<p>${biInline('evidence.complete: no — falta A–E terminal o D3/D4/D6; no es evidencia GX', 'evidence.complete: no — A–E not terminal or D3/D4/D6 missing; not GX evidence')}</p>
      <p class="t-small">${biInline('Faltan', 'Missing')}:</p><ul class="probe-list-plain">${items}</ul>
      <p class="t-small">${biInline('Este JSON no es evidencia GX. Skip-D + sbPresent:false no es un gate.', 'This JSON is not GX evidence. Skip-D + sbPresent:false is not a gate.')}</p>
      <p class="t-caption">overlayFollow.complete: ${Core.isHComplete(store.state) ? 'yes' : 'no'}</p>`;
    const foot = `${btn('modal-close', 'Volver', 'Back', { variant: 'secondary' })}${btn('gate-export', 'Exportar de todos modos · evidence.complete: false', 'Export anyway · evidence.complete: false')}`;
    openModal(dialogShell('evidence.complete: no', 'evidence.complete: no', body, foot), { focus: '[data-act="modal-close"].ds-btn' });
  }

  acts['gate-export'] = () => { closeModal(true); downloadExport(); };

  function openReset() {
    const body = `<p>${biInline('Se borrará la visita guardada en este navegador.', 'The visit saved in this browser will be erased.')}</p>`;
    const foot = `${btn('modal-close', 'Cancelar', 'Cancel', { variant: 'ghost' })}${btn('reset-confirm', 'Reiniciar', 'Reset', { variant: 'danger' })}`;
    openModal(dialogShell('¿Reiniciar la visita?', 'Reset the visit?', body, foot), { focus: '[data-act="modal-close"].ds-btn' });
  }

  acts['reset-confirm'] = () => {
    closeModal(true);
    stopAllActivity();
    store.clearSaved();
    clearPrev();
    pendingRestore = null;
    resetSceneState();
    store.state = store.createInitialState();
    collectBasicFingerprint();
    say('Visita reiniciada', 'Visit reset');
    renderBanner();
    refresh();
    selectScenario('A');
  };

  /* ------------------------------------------------------------------ export / copy log */

  function exportJsonText() { return safeJson(store.exportPayload(), 2); }

  function downloadExport() {
    const payload = store.exportPayload();
    const name = Core.exportFilename(new Date(payload.exportedAt), 'json');
    try {
      const blob = new Blob([safeJson(payload, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const g = sc('G');
      const prior = g.payload || {};
      store.setScenarioResult('G', 'pass', Object.assign({}, prior, { exports: (prior.exports || []).concat([{ at: payload.exportedAt, filename: name, evidenceComplete: payload.evidence.complete }]) }));
      say(`Exportado ${name} · evidence.complete: ${payload.evidence.complete}`, `Exported ${name} · evidence.complete: ${payload.evidence.complete}`);
    } catch (e) {
      say('La descarga falló: usa «Mostrar JSON» y copia', 'Download failed: use “Show JSON” and copy', 'error');
      selectScenario('G');
    }
    refresh();
    if (activeId === 'G') renderPane(true);
  }

  function logText() {
    return store.state.log.map((l) => `[${l.ts}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
  }

  async function copyLogAction() {
    const ok = await copyText(logText());
    say(ok ? 'Registro copiado al portapapeles' : 'No se pudo copiar: abre G y copia el JSON', ok ? 'Log copied to clipboard' : 'Copy failed: open G and copy the JSON', ok ? 'info' : 'warn');
  }

  function exportClicked() {
    store.updateEvidence();
    if (Core.needsIncompleteWarning('export', store.state.evidence)) openGate();
    else downloadExport();
  }

  /* ------------------------------------------------------------------ pane routing */

  function stopAllActivity() {
    if (paneCleanup) { try { paneCleanup(); } catch (_) { /* ignore */ } paneCleanup = null; }
  }

  function selectScenario(id, scrollCard) {
    stopAllActivity();
    activeId = id;
    renderList();
    renderRail();
    renderPane(false);
    if (scrollCard) {
      const card = el.list.querySelector(`[data-id="${id}"]`);
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    }
  }

  function paneHead() {
    const m = meta(activeId);
    const s = sc(activeId);
    const lead = m.optional ? `<span class="probe-pane__letter">${ic(activeId === 'iframe' ? 'layout-grid' : 'file-text', 'xl')}</span>` : `<span class="probe-pane__letter">${m.id}</span>`;
    const warn = m.warnEs ? `<span class="ds-badge ds-badge--warning">${ic('triangle-alert', 'sm')}${m.warnEs} / ${m.warnEn}</span>` : '';
    const canSkip = !isTerminalStatus(s.status) || s.status === 'na';
    return `<div class="probe-pane__head">${lead}<h2 class="probe-pane__title">${bi(m.es, m.en)}</h2><span class="probe-pane__status">${statusBadge(s.status)}</span>${warn}
      <div class="probe-pane__tools">${btn('skip', 'Saltar…', 'Skip…', { variant: 'ghost', attrs: `data-id="${activeId}"`, disabled: !canSkip, icon: 'arrow-right' })}</div></div>`;
  }

  const PANES = {};

  function focusKey(node) {
    if (!node || node === document.body) return null;
    if (node.dataset && node.dataset.fk) return node.dataset.fk;
    if (node.name && node.value !== undefined && node.type !== 'text') return node.name + '|' + node.value;
    if (node.dataset && node.dataset.act) return node.dataset.act + '|' + (node.dataset.tid || node.dataset.id || node.dataset.key || '');
    return null;
  }

  function renderPane(keepScroll) {
    const top = keepScroll ? el.pane.scrollTop : 0;
    const fk = keepScroll && el.pane.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const pane = PANES[activeId];
    if (paneCleanup) { const prev = paneCleanup; paneCleanup = null; (prev.soft || prev)(); }
    let html;
    try { html = pane.html(); } catch (err) {
      html = notice('Este escenario guardado tiene un formato antiguo; los datos crudos siguen en el JSON.', 'This saved scenario has an older format; the raw data is still in the JSON.', 'triangle-alert') + dump(sc(activeId).payload || {});
    }
    el.pane.innerHTML = paneHead() + html;
    el.pane.querySelectorAll('[data-pct]').forEach((n) => { n.style.width = n.dataset.pct + '%'; });
    if (pane.bind) { const cleanup = pane.bind(); if (cleanup) paneCleanup = cleanup; }
    el.pane.scrollTop = top;
    if (fk) {
      const nodes = el.pane.querySelectorAll('input, button, textarea');
      for (const n of nodes) { if (focusKey(n) === fk && !n.disabled) { n.focus({ preventScroll: true }); break; } }
    }
  }

  function afterChange(opts) {
    refresh();
    renderLog();
    if (!opts || opts.pane !== false) renderPane(true);
  }

  /* ------------------------------------------------------------------ shared canvas ink */

  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  function inkColor(pointerType) {
    return tok(pointerType === 'pen' ? '--color-steel-blue' : pointerType === 'touch' ? '--color-orange' : '--color-ink');
  }

  function drawMarker(ctx, x, y, pointerType) {
    ctx.fillStyle = inkColor(pointerType);
    ctx.beginPath();
    if (pointerType === 'pen') ctx.arc(x, y, 7, 0, Math.PI * 2);
    else if (pointerType === 'touch') { ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y + 7); ctx.lineTo(x - 8, y + 7); ctx.closePath(); }
    else ctx.rect(x - 6, y - 6, 12, 12);
    ctx.fill();
  }

  // Bright local ink from pointer events (C and D). Handler gets every raw event; ink only while drawWhen() is true.
  function makeInkSurface(surface, canvas, handler, drawWhen) {
    let view = fitCanvas(canvas);
    const down = new Map();
    const ro = new ResizeObserver(() => { view = fitCanvas(canvas); });
    ro.observe(canvas);
    const onEvent = (e) => {
      if (handler) handler(e);
      if (!e.type.startsWith('pointer') || (drawWhen && !drawWhen())) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pt = e.pointerType || 'mouse';
      if (e.type === 'pointerdown') { down.set(e.pointerId, { x, y }); drawMarker(view.ctx, x, y, pt); }
      else if (e.type === 'pointermove' && down.has(e.pointerId)) {
        const last = down.get(e.pointerId);
        view.ctx.strokeStyle = inkColor(pt);
        view.ctx.lineWidth = Math.max(3, (e.pressure || 0.5) * 9);
        view.ctx.lineCap = 'round';
        view.ctx.beginPath();
        view.ctx.moveTo(last.x, last.y);
        view.ctx.lineTo(x, y);
        view.ctx.stroke();
        down.set(e.pointerId, { x, y });
      } else if (e.type === 'pointerup' || e.type === 'pointercancel') down.delete(e.pointerId);
    };
    ALL_EVENTS.forEach((t) => surface.addEventListener(t, onEvent, { passive: true }));
    return {
      clear() { view.ctx.clearRect(0, 0, view.w, view.h); },
      destroy() { ro.disconnect(); ALL_EVENTS.forEach((t) => surface.removeEventListener(t, onEvent)); }
    };
  }

  let audioCtx = null;
  function beep() {
    if (beepMuted || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (_) { /* no audio */ }
  }

  /* ------------------------------------------------------------------ A: environment fingerprint */

  function opChip(key, label) {
    const v = store.state.operator[key];
    const state = v === 'on' ? ['triangle-alert', 'ON', 'ds-chip--on'] : v === 'off' ? ['circle-check', 'OFF', 'ds-chip--off'] : ['info', '?', ''];
    return `<button type="button" class="ds-chip ${state[2]}" data-act="op-cycle" data-key="${key}" aria-label="${label} ${state[1]}">${ic(state[0], 'md')}${label} ${state[1]}</button>`;
  }

  PANES.A = {
    html() {
      const s = sc('A');
      const p = s.payload;
      const o = store.state.operator;
      let result = '';
      if (p) {
        const h = store.state.host;
        const conf = confidenceWord(h.confidence);
        const ra = p.relatedApps;
        const raText = ra.invoked ? (ra.error ? `error: ${esc(ra.error)}` : `[${ra.result.map((a) => esc(a.id)).join(', ')}] (${ra.result.length})`) : `no invocado: ${esc(ra.reason)}`;
        result = `<div class="probe-block probe-block--tinted"><div class="probe-big"><span>${esc(h.classification)}</span>${bi('confianza ' + conf[0] + ' (' + Math.round(h.confidence * 100) + ' %)', 'confidence ' + conf[1])}</div>
          <p class="probe-note">${esc(h.reason || '')}${ra.error ? ` — <span lang="es">API con error: registrado</span> / <span lang="en">API error: logged</span>` : ''}</p></div>
          ${kv([
            ['User agent', 'User agent', esc(p.userAgent)],
            ['Plataforma · proveedor', 'Platform · vendor', `${esc(p.platform)} · ${esc(p.vendor)}`],
            ['Puntos táctiles máx.', 'maxTouchPoints', p.maxTouchPoints],
            ['Idioma', 'Language', esc(p.language)],
            ['Viewport CSS · DPR', 'CSS viewport · DPR', `${p.viewport.width} × ${p.viewport.height} · ${p.viewport.dpr}`],
            ['Escala visualViewport', 'visualViewport scale', p.visualViewportScale == null ? 'n/a' : p.visualViewportScale],
            ['Modo de visualización', 'Display mode', `standalone ${p.displayMode.standalone ? 'sí/yes' : 'no'} · TWA ${p.twa ? 'sí/yes' : 'no'}`],
            ['URL', 'location.href', esc(p.href)],
            ['Servido como', 'Served as', `${esc(p.servedAs)} · ${p.isSecureContext ? 'contexto seguro / secure context' : 'sin contexto seguro / not secure'}`],
            ['Coincide /am30|smartemb/', 'UA matches /am30|smartemb/', p.uaIqMatch ? 'sí / yes' : 'no'],
            ['getInstalledRelatedApps()', 'getInstalledRelatedApps()', raText]
          ])}`;
      }
      return `<p class="probe-lead"><span lang="es">Mide el navegador, no lo supone. Pega el modelo y anota el estado de Overlay y Freeze.</span><span class="en" lang="en">Measure the browser, do not assume. Paste the model and note the Overlay and Freeze state.</span></p>
        <div class="probe-block">
          <h3 class="probe-block__title">${biInline('Estado al empezar (paso 2)', 'State at the start (step 2)')}</h3>
          <div class="probe-row">${opChip('overlayAtStart', 'Overlay')}${opChip('freezeAtStart', 'Freeze')}</div>
          <p class="probe-note"><span lang="es">Toca para alternar ? → ON → OFF. Es lo que ves en el tablero; no hace falta apagarlos.</span><span class="en" lang="en">Tap to cycle ? → ON → OFF. It is what you see on the board; you do not need to turn them off.</span></p>
          <div class="probe-grid2">
            ${field(['Modelo GX', 'GX model'], 'Ajustes → Acerca de / Settings → About', `<input class="ds-input" type="text" data-chg="op-text" data-key="gxModel" value="${esc(o.gxModel)}" placeholder="SBID-GX…" autocomplete="off" autocapitalize="off" spellcheck="false">`)}
            ${field(['¿Chrome y/o app Navegador SMART?', 'Chrome and/or SMART Browser app?'], '', `<input class="ds-input" type="text" data-chg="op-text" data-key="browsers" value="${esc(o.browsers)}" autocomplete="off" spellcheck="false">`)}
          </div>
        </div>
        <div class="probe-row">${btn('a-run', p ? 'Ejecutar de nuevo' : 'Ejecutar A', p ? 'Run again' : 'Run A', { icon: 'play', disabled: s.status === 'running' })}</div>
        ${s.status === 'running' ? notice('Recogiendo datos; getInstalledRelatedApps puede tardar.', 'Collecting data; getInstalledRelatedApps may stall.', 'clock') : ''}
        ${result}`;
    }
  };
  acts['op-cycle'] = (t) => {
    const key = t.dataset.key;
    const next = { unknown: 'on', on: 'off', off: 'unknown' };
    store.state.operator[key] = next[store.state.operator[key]];
    store.updateEvidence();
    store.persist();
    refresh();
    renderPane(true);
  };
  acts['op-text'] = (t) => {
    store.state.operator[t.dataset.key] = t.value;
    store.updateEvidence();
    store.persist();
    renderHead();
  };
  acts['a-run'] = async () => {
    store.setScenarioResult('A', 'running');
    say('A: recogiendo huella de entorno…', 'A: collecting environment fingerprint…');
    afterChange();
    const fp = await fingerprintFor(window);
    const iq = fp.relatedApps.result ? fp.relatedApps.result.some((a) => /com\.smarttech\.iq/i.test(a.id || '')) : false;
    const res = collectBasicFingerprint({ isIqAppDetected: iq });
    store.setScenarioResult('A', 'pass', fp);
    say(`A terminado: host ${res.classification} (${Math.round(res.confidence * 100)} %)`, `A finished: host ${res.classification} (${Math.round(res.confidence * 100)} %)`);
    afterChange({ pane: activeId === 'A' });
  };

  /* ------------------------------------------------------------------ B: SMART WDK / window.SB */

  const bLive = { busy: false, initBusy: false, initCancel: null, initMessage: '' };

  function loadWdkScript(doc, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      const old = doc.getElementById('wdk-script');
      if (old) old.remove();
      const s = doc.createElement('script');
      s.id = 'wdk-script';
      s.src = WDK_URL;
      s.async = true;
      const finish = (r) => { if (done) return; done = true; clearTimeout(tid); resolve({ scriptLoad: r, ms: Math.round(performance.now() - t0) }); };
      s.onload = () => finish('loaded');
      s.onerror = () => finish('error');
      const tid = setTimeout(() => finish('timeout'), timeoutMs);
      (doc.head || doc.documentElement).appendChild(s);
    });
  }

  async function probeFetch(url) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(url, { mode: 'no-cors', signal: ctrl.signal });
      return { kind: 'fetch', url, outcome: 'response', responseType: r.type, status: r.status };
    } catch (e) {
      return { kind: 'fetch', url, outcome: e.name === 'AbortError' ? 'timeout' : 'error', error: errStr(e) };
    } finally { clearTimeout(tid); }
  }

  function probeWs(url) {
    return new Promise((resolve) => {
      let ws = null;
      let done = false;
      const end = (outcome, extra) => {
        if (done) return;
        done = true;
        clearTimeout(tid);
        try { if (ws) ws.close(); } catch (_) { /* ignore */ }
        resolve(Object.assign({ kind: 'websocket', url, outcome }, extra || {}));
      };
      const tid = setTimeout(() => end('timeout'), 3000);
      try { ws = new WebSocket(url); } catch (e) { end('threw', { error: errStr(e) }); return; }
      ws.onopen = () => end('open');
      ws.onerror = () => end('error');
      ws.onclose = (ev) => end('closed', { code: ev.code });
    });
  }

  function readSbProps(SB) {
    const out = {};
    for (const k of ['wantsTouches', 'disableInkFields', 'disableTouchPointers', 'disableBanners']) {
      try { out[k] = { value: preview(SB[k]), type: typeof SB[k] }; } catch (e) { out[k] = { error: errStr(e) }; }
    }
    return out;
  }

  async function runB() {
    bLive.busy = true;
    store.setScenarioResult('B', 'running');
    say('B: cargando script WDK y sondeando puertos…', 'B: loading WDK script and probing ports…');
    afterChange();
    const ports = Promise.all([
      probeFetch('https://localhost:54743'), probeFetch('http://127.0.0.1:54743'),
      probeWs('wss://localhost:54743'), probeWs('ws://127.0.0.1:54743')
    ]);
    const load = await loadWdkScript(document, 8000);
    // AC3: wait up to 3 s after load before declaring SB absent
    for (let i = 0; i < 12 && typeof window.SB === 'undefined'; i++) await sleep(250);
    const present = typeof window.SB !== 'undefined';
    const payload = {
      sbPresent: present,
      typeofSB: typeof window.SB,
      scriptLoad: load.scriptLoad,
      scriptLoadMs: load.ms,
      keys: [],
      props: {},
      localhostProbe: await ports,
      testedAt: new Date().toISOString()
    };
    if (present) {
      try { payload.keys = Object.keys(window.SB); } catch (e) { payload.keysError = errStr(e); }
      payload.props = readSbProps(window.SB);
    }
    const prior = sc('B').payload || {};
    if (prior.initialize) payload.initialize = prior.initialize;
    store.setScenarioResult('B', 'pass', payload);
    bLive.busy = false;
    say(`B terminado: sbPresent=${present}, scriptLoad=${load.scriptLoad}`, `B finished: sbPresent=${present}, scriptLoad=${load.scriptLoad}`, present ? 'info' : 'warn');
    afterChange({ pane: activeId === 'B' });
  }

  async function runInit() {
    const SB = window.SB;
    bLive.initBusy = true;
    bLive.initMessage = '';
    renderPane(true);
    const watchdog = new Promise((resolve) => {
      const id = setTimeout(() => resolve({ outcome: 'hang' }), 5000);
      bLive.initCancel = () => { clearTimeout(id); resolve({ outcome: 'cancelled' }); };
    });
    const call = new Promise((resolve) => {
      try {
        const r = SB.initializeSMARTBoard();
        Promise.resolve(r).then((v) => resolve({ outcome: 'returned', value: preview(v) }), (e) => resolve({ outcome: 'rejected', error: errStr(e) }));
      } catch (e) { resolve({ outcome: 'threw', error: errStr(e) }); }
    });
    const t0 = performance.now();
    const r = await Promise.race([call, watchdog]);
    r.ms = Math.round(performance.now() - t0);
    bLive.initCancel = null;
    bLive.initBusy = false;
    const p = sc('B').payload || {};
    p.initialize = r;
    store.setScenarioResult('B', sc('B').status, p);
    bLive.initMessage = r.outcome;
    say(`initializeSMARTBoard(): ${r.outcome}`, `initializeSMARTBoard(): ${r.outcome}`, r.outcome === 'returned' ? 'info' : 'warn');
    afterChange();
  }

  PANES.B = {
    html() {
      const s = sc('B');
      const p = s.payload;
      const attempted = Boolean(p);
      const present = attempted && p.sbPresent;
      const canInit = present && typeof window.SB !== 'undefined' && typeof window.SB.initializeSMARTBoard === 'function';
      let body = '';
      if (attempted) {
        body += present
          ? notice('window.SB existe en esta página.', 'window.SB exists on this page.', 'circle-check')
          : notice('sbPresent: false — window.SB no existe 3 s después de la carga. Es un resultado válido.', 'sbPresent: false — window.SB is undefined 3 s after load. This is a valid result.', 'info');
        body += kv([
          ['Carga del script', 'scriptLoad', `<strong>${esc(p.scriptLoad)}</strong> (${p.scriptLoadMs} ms)`],
          ['typeof SB', 'typeof SB', esc(p.typeofSB)],
          ['sbPresent', 'sbPresent', `<strong>${p.sbPresent}</strong>`],
          ['Claves de SB', 'SB keys', p.keys.length ? esc(p.keys.join(', ')) : '—']
        ].concat(Object.keys(p.props || {}).map((k) => [esc(k), esc(k), p.props[k].error ? esc(p.props[k].error) : `${esc(p.props[k].value)} (${esc(p.props[k].type)})`])));
        body += `<h3 class="probe-block__title">${biInline('Puertos locales 54743 (esperado: fallan en GX)', 'Local port 54743 (expected to fail on GX)')}</h3>
          ${kv((p.localhostProbe || []).map((r) => [esc(r.kind), esc(r.url), `<strong>${esc(r.outcome)}</strong>${r.error ? ' · ' + esc(r.error) : ''}${r.status !== undefined ? ' · ' + esc(r.responseType) + ' ' + r.status : ''}${r.code !== undefined ? ' · code ' + r.code : ''}`]))}`;
      }
      const init = `<div class="probe-block ${bLive.initBusy ? 'probe-block--warn' : ''}">
          <h3 class="probe-block__title">${biInline('SB.initializeSMARTBoard()', 'SB.initializeSMARTBoard()')}</h3>
          <p class="probe-note"><span lang="es">Solo con este botón; puede quedarse colgado. Vigilante de 5 s.</span><span class="en" lang="en">Only behind this button; it may hang. 5 s watchdog.</span></p>
          <div class="probe-row">${btn('b-init', 'Ejecutar initializeSMARTBoard()', 'Run initializeSMARTBoard()', { icon: 'play', disabled: !canInit || bLive.initBusy })}
            ${bLive.initBusy ? btn('b-init-cancel', 'Cancelar espera', 'Cancel wait', { variant: 'secondary', icon: 'x' }) : ''}
            ${!canInit ? `<span class="probe-note"><span lang="es">Disponible solo si window.SB y la función existen.</span><span class="en" lang="en">Available only if window.SB and the function exist.</span></span>` : ''}</div>
          <p class="probe-note" aria-live="assertive">${bLive.initBusy ? `<strong lang="es">Esperando respuesta… hasta 5 s.</strong><span class="en" lang="en">Waiting for a response… up to 5 s.</span>` : (p && p.initialize ? `<strong>${esc(p.initialize.outcome)}</strong> ${esc(p.initialize.value || p.initialize.error || '')} (${p.initialize.ms} ms)` : '')}</p>
        </div>`;
      const ink = present ? `<div class="probe-block">
          <h3 class="probe-block__title">${biInline('Probar disableInkFields = true', 'Try disableInkFields = true')}</h3>
          <div class="probe-row">${btn('b-ink', 'Probar disableInkFields = true', 'Try disableInkFields = true', { variant: 'secondary' })}</div>
          ${p.disableInkTrial ? `<p class="probe-note">${esc(p.disableInkTrial.readback || p.disableInkTrial.error || '')}</p>` : ''}
          ${check('overlayStillOpens', Boolean(p.overlayStillOpens), false, 'Overlay aún se abre al coger el lápiz', 'Overlay still opens on pen pickup', 'data-chg="b-overlay"')}
        </div>` : '';
      return `<p class="probe-lead"><span lang="es">Carga el script de SMART, lee window.SB y sondea los puertos locales. Nunca se inicializa solo.</span><span class="en" lang="en">Load the SMART script, read window.SB and probe the local ports. It never initializes on its own.</span></p>
        <div class="probe-row">${btn('b-run', attempted ? 'Cargar de nuevo' : 'Cargar script WDK', attempted ? 'Load again' : 'Load WDK script', { icon: 'download', disabled: s.status === 'running' })}</div>
        ${s.status === 'running' ? notice('Cargando script y sondeando puertos (hasta unos 11 s). La página sigue activa.', 'Loading script and probing ports (up to ~11 s). The page stays live.', 'clock') : ''}
        ${body}${attempted ? init : ''}${ink}`;
    }
  };
  acts['b-run'] = () => { if (!bLive.busy) runB(); };
  acts['b-init'] = () => { if (!bLive.initBusy) runInit(); };
  acts['b-init-cancel'] = () => { if (bLive.initCancel) bLive.initCancel(); };
  acts['b-ink'] = () => {
    const p = sc('B').payload;
    try {
      window.SB.disableInkFields = true;
      p.disableInkTrial = { set: true, readback: 'disableInkFields → ' + preview(window.SB.disableInkFields) };
    } catch (e) { p.disableInkTrial = { set: false, error: errStr(e) }; }
    store.setScenarioResult('B', sc('B').status, p);
    say('B: probado disableInkFields = true', 'B: tried disableInkFields = true');
    afterChange();
  };
  acts['b-overlay'] = (t) => {
    const p = sc('B').payload;
    p.overlayStillOpens = t.checked;
    store.setScenarioResult('B', sc('B').status, p);
    afterChange({ pane: false });
  };

  /* ------------------------------------------------------------------ C: pointer taxonomy */

  const cap = { active: false, startedAt: 0, timerId: 0, tickId: 0, sample: [], total: 0, byType: {}, byPointerType: {}, last: '', pointers: new Set(), maxPointers: 0, maxPressure: 0, tiltSeen: false, moveSkip: 0, prompts: {}, append: false, surface: null };
  const C_PROMPTS = [
    ['finger', 'Dedo', 'Finger'], ['pen', 'Lápiz de bandeja', 'Tray pen'], ['two', 'Dos dedos', 'Two fingers'],
    ['penfinger', 'Lápiz y dedo a la vez', 'Pen and finger together'], ['palm', 'Palma o puño', 'Palm or fist']
  ];

  function capReset() {
    cap.sample = []; cap.total = 0; cap.byType = {}; cap.byPointerType = {}; cap.last = '';
    cap.pointers = new Set(); cap.maxPointers = 0; cap.maxPressure = 0; cap.tiltSeen = false; cap.moveSkip = 0;
  }

  function setText(id, text) { const n = document.getElementById(id); if (n) n.textContent = text; }

  function onCapEvent(e) {
    if (!cap.active) return;
    const n = normalizePointerEvent(e);
    cap.total++;
    cap.byType[n.type] = (cap.byType[n.type] || 0) + 1;
    if (e.type.startsWith('pointer')) {
      cap.byPointerType[n.pointerType] = (cap.byPointerType[n.pointerType] || 0) + 1;
      if (e.type === 'pointerdown') cap.pointers.add(n.pointerId);
      if (e.type === 'pointerup' || e.type === 'pointercancel') cap.pointers.delete(n.pointerId);
      cap.maxPointers = Math.max(cap.maxPointers, cap.pointers.size);
      cap.maxPressure = Math.max(cap.maxPressure, n.pressure);
      if (n.tiltX || n.tiltY) cap.tiltSeen = true;
      if (n.pointerType !== cap.last) { cap.last = n.pointerType; beep(); }
    }
    const keep = e.type !== 'pointermove' && e.type !== 'touchmove' ? true : (++cap.moveSkip % 6 === 0);
    if (keep && cap.sample.length < 600) cap.sample.push(n);
    setText('c-count', String(cap.total));
    setText('c-last', cap.last || '—');
    setText('c-pointers', `${cap.pointers.size} (max ${cap.maxPointers})`);
  }

  function capTick() {
    const left = Math.max(0, 15000 - (Date.now() - cap.startedAt));
    setText('c-time', `0:${pad2(Math.ceil(left / 1000))}`);
    if (left <= 0) finishCapture('timeout');
  }

  function startCapture() {
    if (cap.active) return;
    if (!cap.append) capReset();
    cap.active = true;
    cap.startedAt = Date.now();
    store.setScenarioResult('C', 'running');
    cap.tickId = setInterval(capTick, 250);
    say('C: captura de punteros iniciada (15 s)', 'C: pointer capture started (15 s)');
    refresh();
    renderPane(true);
    const surface = document.getElementById('c-surface');
    if (surface) { surface.focus({ preventScroll: true }); surface.scrollIntoView({ block: 'nearest' }); }
  }

  function finishCapture(reason) {
    if (!cap.active) return;
    clearInterval(cap.tickId);
    cap.active = false;
    const pointerEvents = POINTER_EVENTS.reduce((a, k) => a + (cap.byType[k] || 0), 0);
    const payload = {
      totalEvents: cap.total,
      pointerEvents,
      byEventType: cap.byType,
      byPointerType: cap.byPointerType,
      pointerTypesObserved: Object.keys(cap.byPointerType),
      maxSimultaneousPointers: cap.maxPointers,
      maxPressure: cap.maxPressure,
      tiltReported: cap.tiltSeen,
      promptsDone: Object.assign({}, cap.prompts),
      stoppedBy: reason,
      eventsSample: cap.sample.slice(-200)
    };
    if (cap.total > 0) {
      store.setScenarioResult('C', 'pass', payload);
      say(`C terminado: ${cap.total} eventos, tipos: ${payload.pointerTypesObserved.join(', ') || '—'}`, `C finished: ${cap.total} events, types: ${payload.pointerTypesObserved.join(', ') || '—'}`);
    } else {
      store.setScenarioResult('C', 'running', payload);
      say('C: 0 eventos; reintenta o salta con motivo', 'C: 0 events; retry or skip with a reason', 'warn');
    }
    if (reason !== 'left') { refresh(); if (activeId === 'C') renderPane(true); }
  }

  PANES.C = {
    html() {
      const s = sc('C');
      const p = s.payload;
      const zero = !cap.active && s.status === 'running' && p && p.totalEvents === 0;
      const chips = C_PROMPTS.map((c) => `<label class="ds-check probe-opt"><input type="checkbox" data-chg="c-prompt" data-key="${c[0]}"${cap.prompts[c[0]] ? ' checked' : ''}><span class="ds-check__box">${ic('check', 'sm')}</span>${bi(c[1], c[2])}</label>`).join('');
      return `<p class="probe-lead"><span lang="es">Dedo, luego lápiz de bandeja, luego dos dedos. Marca «hecho» en cada indicación.</span><span class="en" lang="en">Finger, then tray pen, then two fingers. Tick each prompt when done.</span></p>
        <div class="probe-row">
          ${cap.active ? btn('c-stop', 'Detener', 'Stop', { variant: 'danger', icon: 'x' }) : btn('c-start', p && p.totalEvents ? 'Capturar de nuevo (15 s)' : 'Iniciar captura (15 s)', p && p.totalEvents ? 'Capture again (15 s)' : 'Start capture (15 s)', { icon: 'play' })}
          <label class="ds-switch"><input type="checkbox" role="switch" data-chg="c-append"${cap.append ? ' checked' : ''}><span class="ds-switch__track"></span><span>${biInline('Añadir a la captura anterior', 'Append to previous capture')}</span></label>
          <label class="ds-switch"><input type="checkbox" role="switch" data-chg="c-mute"${beepMuted ? ' checked' : ''}><span class="ds-switch__track"></span><span>${biInline('Silenciar pitido', 'Mute beep')}</span></label>
        </div>
        ${zero ? notice('0 eventos registrados. Toca la superficie y vuelve a empezar, o salta con motivo.', '0 events recorded. Touch the surface and start again, or skip with a reason.', 'triangle-alert') : ''}
        <div class="probe-live" aria-live="polite">
          <span>${biInline('Grabando', 'Recording')}: <strong id="c-time">${cap.active ? '0:15' : '—'}</strong></span>
          <span>${biInline('Eventos', 'Events')}: <strong id="c-count">${cap.total}</strong></span>
          <span>${biInline('Último observado', 'Last observed')}: <strong id="c-last">${esc(cap.last || '—')}</strong></span>
          <span>${biInline('Punteros', 'Pointers')}: <strong id="c-pointers">${cap.pointers.size} (max ${cap.maxPointers})</strong></span>
        </div>
        <div class="probe-fill">
          <div class="probe-surface${cap.active ? ' probe-surface--rec' : ''}" id="c-surface" role="application" tabindex="0" aria-label="Superficie de captura / Capture surface"><canvas id="c-canvas"></canvas></div>
        </div>
        <div class="probe-opts" role="group" aria-label="Indicaciones / Prompts">${chips}</div>
        ${p && p.totalEvents ? `<h3 class="probe-block__title">${biInline('Resultado', 'Result')}</h3>${kv([
          ['Tipos observados', 'Pointer types observed', esc(p.pointerTypesObserved.join(', ') || '—')],
          ['Eventos por tipo', 'Events by type', esc(safeJson(p.byEventType))],
          ['Punteros simultáneos máx.', 'Max simultaneous pointers', p.maxSimultaneousPointers],
          ['Presión máx. · inclinación', 'Max pressure · tilt', `${p.maxPressure.toFixed(2)} · ${p.tiltReported ? 'sí/yes' : 'no'}`]
        ])}<h3 class="probe-block__title">${biInline('Últimos eventos (tipo, coordenadas)', 'Latest events (type, coordinates)')}</h3>${dump(p.eventsSample.slice(-8).map((e) => `${e.type} ${e.pointerType}#${e.pointerId} (${Math.round(e.clientX)}, ${Math.round(e.clientY)}) p=${e.pressure.toFixed(2)}`).join('\n'))}` : ''}`;
    },
    bind() {
      const surface = document.getElementById('c-surface');
      const canvas = document.getElementById('c-canvas');
      const ink = makeInkSurface(surface, canvas, onCapEvent, () => cap.active);
      if (!cap.active) ink.clear();
      const leave = () => { if (cap.active) finishCapture('left'); ink.destroy(); };
      leave.soft = () => ink.destroy();
      return leave;
    }
  };
  acts['c-start'] = startCapture;
  acts['c-stop'] = () => finishCapture('stop');
  acts['c-append'] = (t) => { cap.append = t.checked; };
  acts['c-mute'] = (t) => { beepMuted = t.checked; };
  acts['c-prompt'] = (t) => { cap.prompts[t.dataset.key] = t.checked; };

  /* ------------------------------------------------------------------ D: gesture ownership */

  const OPT_MOVES = [['moves', 'Recibimos movimientos', 'We got moves'], ['stolen', 'Robados', 'Stolen'], ['both', 'Ambos', 'Both'], ['none', 'Ninguno', 'None']];
  const OPT_PINCH = [['pointers', 'Dos punteros', 'Two pointers'], ['stolen', 'Robados', 'Stolen'], ['both', 'Ambos', 'Both'], ['none', 'Ninguno', 'None']];
  const OPT_FREEZE = [['events', 'Eventos para nosotros', 'Events to us'], ['not', 'No llegaron', 'Did not arrive']];
  const OPT_INK = [['ours', 'Nuestra tinta', 'Our ink'], ['acetate', 'Acetato de Overlay', 'Overlay acetate'], ['both', 'Ambas', 'Both'], ['none', 'Ninguna', 'None']];
  const D_PASS = new Set(['moves', 'pointers', 'both', 'events', 'ours']);
  const TRIALS = {
    D1: { es: 'Overlay OFF. Un dedo arrastra.', en: 'Overlay OFF. One-finger drag.', need: 'off', opts: OPT_MOVES },
    D2: { es: 'Overlay OFF. Pellizco.', en: 'Overlay OFF. Pinch.', need: 'off', opts: OPT_PINCH },
    D3: { es: 'Overlay ON. Un dedo arrastra.', en: 'Overlay ON. One-finger drag.', need: 'on', opts: OPT_MOVES },
    D4: { es: 'Overlay ON. Pellizco.', en: 'Overlay ON. Pinch.', need: 'on', opts: OPT_PINCH },
    D5: { es: 'Freeze ON. Pellizco o arrastre.', en: 'Freeze ON. Pinch or drag.', need: 'freeze', opts: OPT_FREEZE },
    D6: { es: 'Coge el lápiz. ¿Se abre Overlay solo? ¿Quién pinta?', en: 'Pick up the pen. Does Overlay open by itself? Who draws?', need: 'pen', opts: OPT_INK }
  };
  const dLive = { active: null, measuring: null, counts: null, naOpen: {}, ink: null };

  function newCounts() { return { pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0, touch: 0, maxPointers: 0, pointerTypes: {}, down: new Set() }; }

  function onDEvent(e) {
    const c = dLive.counts;
    if (!c || !dLive.measuring) return;
    if (e.type.startsWith('pointer')) {
      c[e.type]++;
      c.pointerTypes[e.pointerType || 'unknown'] = (c.pointerTypes[e.pointerType || 'unknown'] || 0) + 1;
      if (e.type === 'pointerdown') c.down.add(e.pointerId);
      if (e.type === 'pointerup' || e.type === 'pointercancel') c.down.delete(e.pointerId);
      c.maxPointers = Math.max(c.maxPointers, c.down.size);
    } else if (e.type.startsWith('touch')) c.touch++;
    setText('d-live', dCountsText(c));
  }

  function dCountsText(c) {
    return `down ${c.pointerdown} · move ${c.pointermove} · up ${c.pointerup} · cancel ${c.pointercancel} · touch ${c.touch} · max ${c.maxPointers} ptr`;
  }

  function dFirstOpen() {
    return Object.keys(TRIALS).find((tid) => !isTerminalStatus(sc('D').trials[tid].status)) || 'D1';
  }

  function dAllowed(tid, group) {
    const t = sc('D').trials[tid];
    const need = TRIALS[tid].need;
    if (need === 'off') return !t.overlayOn;
    if (need === 'on') return t.overlayOn === true;
    if (need === 'freeze') return t.freezeOn === true;
    if (need === 'pen') return group === 'off' ? true : t.overlayOn === true;
    return true;
  }

  function dEvaluate(tid) {
    const t = sc('D').trials[tid];
    if (t.status === 'na') return;
    let status = 'idle';
    if (tid === 'D6') {
      if (t.resultOn && dAllowed(tid, 'on')) status = D_PASS.has(t.resultOn) ? 'pass' : 'fail';
      else if (t.resultOff) status = 'running';
    } else if (t.result && dAllowed(tid)) status = D_PASS.has(t.result) ? 'pass' : 'fail';
    store.setTrialResult(tid, status, {});
    if (sc('D').status === 'idle' && status !== 'idle') store.setScenarioResult('D', 'running');
  }

  function trialRow(tid) {
    const def = TRIALS[tid];
    const t = sc('D').trials[tid];
    const active = dLive.active === tid;
    const overlayTrial = def.need === 'on' || tid === 'D6';
    const hole = holeTrial(tid) && ['D3', 'D4', 'D6'].includes(tid) && t.status !== 'idle';
    const head = `<button type="button" class="probe-trial__head" data-act="d-open" data-tid="${tid}" aria-expanded="${active}">
        <span class="probe-trial__id">${tid}</span><span class="probe-trial__title">${bi(def.es, def.en)}</span>
        ${overlayTrial ? `<span class="ds-badge ds-badge--warning">${ic('triangle-alert', 'sm')}Overlay ON</span>` : ''}${def.need === 'freeze' ? `<span class="ds-badge ds-badge--info">${ic('hand', 'sm')}Freeze ON</span>` : ''}
        ${statusBadge(t.status)}</button>`;
    if (!active) return `<li class="probe-trial${overlayTrial ? ' probe-trial--overlay' : ''}${hole ? ' probe-trial--hole' : ''}">${head}</li>`;
    const measuring = dLive.measuring === tid;
    const measureText = measuring ? dCountsText(dLive.counts) : (t.measure ? dCountsText(Object.assign(newCounts(), t.measure)) : 'sin medir / not measured');
    const boxLabel = def.need === 'freeze' ? ['Freeze estuvo ON', 'Freeze was ON', 'freezeOn', t.freezeOn] : ['Overlay estuvo ON', 'Overlay was ON', 'overlayOn', t.overlayOn];
    const needText = def.need === 'off' ? ['Este ensayo pide Overlay OFF: deja la casilla sin marcar.', 'This trial needs Overlay OFF: leave the box unticked.']
      : def.need === 'on' ? ['Este ensayo pide Overlay ON: marca la casilla.', 'This trial needs Overlay ON: tick the box.']
      : def.need === 'freeze' ? ['Este ensayo pide Freeze ON: marca la casilla.', 'This trial needs Freeze ON: tick the box.']
      : ['Prueba primero con Overlay OFF; marca la casilla para la prueba con Overlay ON.', 'Try with Overlay OFF first; tick the box for the Overlay ON try.'];
    const radios = (group, name, resultKey) => {
      const allowed = dAllowed(tid, group);
      return def.opts.map((o) => radio(name, o[0], t[resultKey] === o[0], !allowed, o[1], o[2], `data-chg="d-result" data-tid="${tid}" data-key="${resultKey}"`)).join('');
    };
    const results = tid === 'D6'
      ? `<div class="probe-trial__result"><p class="t-caption">${biInline('Con Overlay OFF', 'With Overlay OFF')}</p><div class="probe-opts" role="radiogroup">${radios('off', 'd6off', 'resultOff')}</div></div>
         <div class="probe-trial__result"><p class="t-caption">${biInline('Con Overlay ON', 'With Overlay ON')}</p><div class="probe-opts" role="radiogroup">${radios('on', 'd6on', 'resultOn')}</div></div>`
      : `<div class="probe-trial__result"><p class="t-caption">${biInline('¿Qué pasó?', 'What happened?')}</p><div class="probe-opts" role="radiogroup">${radios('x', tid + 'r', 'result')}</div></div>`;
    const naOpen = dLive.naOpen[tid];
    return `<li class="probe-trial probe-trial--active${overlayTrial ? ' probe-trial--overlay' : ''}${hole ? ' probe-trial--hole' : ''}">${head}
      <div class="probe-trial__body">
        <p class="probe-note"><span lang="es">${needText[0]}</span><span class="en" lang="en">${needText[1]}</span></p>
        <div class="probe-row">
          ${check(tid + 'cb', Boolean(boxLabel[3]), false, boxLabel[0], boxLabel[1], `data-chg="d-check" data-tid="${tid}" data-key="${boxLabel[2]}"`)}
          ${measuring ? btn('d-measure-stop', 'Parar medición', 'Stop measuring', { variant: 'danger', icon: 'x', attrs: `data-tid="${tid}"` }) : btn('d-measure', 'Medir en la superficie', 'Measure on the surface', { variant: 'secondary', icon: 'play', attrs: `data-tid="${tid}"` })}
        </div>
        <p class="probe-note"><span class="probe-mono"${measuring ? ' id="d-live"' : ''}>${esc(measureText)}</span></p>
        ${results}
        ${field(['Notas', 'Notes'], '', `<input class="ds-input" type="text" data-chg="d-notes" data-tid="${tid}" value="${esc(t.status === 'na' ? '' : t.notes)}" autocomplete="off">`)}
        <div class="probe-row">
          ${btn('d-na-toggle', 'No pude hacerlo…', 'I could not do it…', { variant: 'ghost', attrs: `data-tid="${tid}"` })}
        </div>
        ${naOpen ? `<div class="probe-block">${field(['Motivo (obligatorio)', 'Reason (required)'], '', `<input class="ds-input" type="text" id="d-na-reason" value="${esc(t.status === 'na' ? t.notes : '')}" placeholder="no pude cambiar Overlay">`)}
          <div class="probe-row">${btn('d-na-confirm', 'Marcar n/a', 'Mark n/a', { attrs: `data-tid="${tid}"` })}</div></div>` : ''}
      </div></li>`;
  }

  PANES.D = {
    html() {
      if (!dLive.active) dLive.active = dFirstOpen();
      return `<div class="probe-surface probe-surface--fixed" id="d-surface" role="application" tabindex="0" aria-label="Superficie de ensayo / Trial surface">
          <canvas id="d-canvas"></canvas>
          <div class="probe-surface__hud"><span class="ds-badge ds-badge--info">${ic('pen', 'sm')}${dLive.active}</span></div>
        </div>
        <div class="probe-scroll"><p class="probe-lead"><span lang="es">Seis ensayos físicos. Tu tinta local aparece en la superficie: así ves quién pinta, nosotros u Overlay.</span><span class="en" lang="en">Six physical trials. Our local ink shows on the surface so you can see who draws, us or Overlay.</span></p>
        <div class="probe-row">${btn('d-clear', 'Borrar tinta', 'Clear ink', { variant: 'secondary', icon: 'eraser' })}</div>
        <ol class="probe-trials">${Object.keys(TRIALS).map(trialRow).join('')}</ol></div>`;
    },
    bind() {
      const canvas = document.getElementById('d-canvas');
      const ink = makeInkSurface(document.getElementById('d-surface'), canvas, onDEvent, () => true);
      dLive.ink = ink;
      if (dLive.snap) {
        const img = new Image();
        img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
        img.src = dLive.snap;
      }
      const leave = () => { dLive.measuring = null; dLive.ink = null; dLive.snap = null; ink.destroy(); };
      leave.soft = () => { dLive.snap = canvas.toDataURL(); ink.destroy(); };
      return leave;
    }
  };
  acts['d-open'] = (t) => { dLive.measuring = null; dLive.active = dLive.active === t.dataset.tid ? null : t.dataset.tid; renderPane(true); };
  acts['d-clear'] = () => { dLive.snap = null; if (dLive.ink) dLive.ink.clear(); };
  acts['d-measure'] = (t) => { dLive.measuring = t.dataset.tid; dLive.counts = newCounts(); renderPane(true); };
  acts['d-measure-stop'] = (t) => {
    const tid = t.dataset.tid;
    const c = dLive.counts;
    dLive.measuring = null;
    const measure = { pointerdown: c.pointerdown, pointermove: c.pointermove, pointerup: c.pointerup, pointercancel: c.pointercancel, touch: c.touch, maxPointers: c.maxPointers, pointerTypes: c.pointerTypes };
    store.setTrialResult(tid, sc('D').trials[tid].status, { measure, eventsReceived: c.pointerdown + c.pointermove });
    say(`${tid} medido: ${dCountsText(c)}`, `${tid} measured: ${dCountsText(c)}`);
    afterChange();
  };
  acts['d-check'] = (t) => {
    const tid = t.dataset.tid;
    const d = {}; d[t.dataset.key] = t.checked;
    store.setTrialResult(tid, sc('D').trials[tid].status, d);
    dEvaluate(tid);
    say(`${tid}: ${t.dataset.key === 'freezeOn' ? 'Freeze' : 'Overlay'} estuvo ${t.checked ? 'ON' : 'OFF'}`, `${tid}: ${t.dataset.key === 'freezeOn' ? 'Freeze' : 'Overlay'} was ${t.checked ? 'ON' : 'OFF'}`);
    afterChange();
  };
  acts['d-result'] = (t) => {
    const tid = t.dataset.tid;
    const d = {}; d[t.dataset.key] = t.value;
    store.setTrialResult(tid, sc('D').trials[tid].status === 'na' ? 'idle' : sc('D').trials[tid].status, d);
    dEvaluate(tid);
    const st = sc('D').trials[tid].status;
    say(`${tid}: ${t.value} → ${st}`, `${tid}: ${t.value} → ${st}`);
    afterChange();
  };
  acts['d-notes'] = (t) => {
    const tr = sc('D').trials[t.dataset.tid];
    if (tr.status === 'na') return;
    tr.notes = t.value;
    store.persist();
  };
  acts['d-na-toggle'] = (t) => { dLive.naOpen[t.dataset.tid] = !dLive.naOpen[t.dataset.tid]; renderPane(true); };
  acts['d-na-confirm'] = (t) => {
    const tid = t.dataset.tid;
    const reason = (document.getElementById('d-na-reason').value || '').trim();
    if (!reason) { document.getElementById('d-na-reason').setAttribute('aria-invalid', 'true'); say(`${tid}: n/a necesita motivo`, `${tid}: n/a needs a reason`, 'warn'); return; }
    store.setTrialResult(tid, 'na', { notes: reason });
    dLive.naOpen[tid] = false;
    say(`${tid}: n/a — ${reason}`, `${tid}: n/a — ${reason}`);
    dLive.active = dFirstOpen();
    afterChange();
  };

  /* ------------------------------------------------------------------ E: local ink with zoom and pan */

  const ink = { strokes: [], view: { scale: 1, tx: 0, ty: 0 }, tool: 'draw', step: 1 };
  const E_PAGE = { x: 80, y: 60, w: 640, h: 300 };

  function viewApply(v, p) { return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty }; }

  function drawScene(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = ink.view;
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.tx, dpr * v.ty);
    // content: a paper page with a registration cross and a labelled grid, so anchoring is visible
    ctx.fillStyle = tok('--color-paper');
    ctx.fillRect(E_PAGE.x, E_PAGE.y, E_PAGE.w, E_PAGE.h);
    ctx.strokeStyle = tok('--color-line-strong');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(E_PAGE.x, E_PAGE.y, E_PAGE.w, E_PAGE.h);
    ctx.strokeStyle = tok('--color-lavender');
    ctx.lineWidth = 1;
    for (let y = E_PAGE.y + 24; y < E_PAGE.y + E_PAGE.h; y += 24) { ctx.beginPath(); ctx.moveTo(E_PAGE.x, y); ctx.lineTo(E_PAGE.x + E_PAGE.w, y); ctx.stroke(); }
    ctx.strokeStyle = tok('--color-teal');
    ctx.lineWidth = 3;
    const cx = E_PAGE.x + E_PAGE.w / 2;
    const cy = E_PAGE.y + E_PAGE.h / 2;
    ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
    ctx.fillStyle = tok('--color-ink-2');
    ctx.font = `${tok('--fw-medium')} 16px ${tok('--font-sans')}`;
    ctx.fillText('Contenido / Content (0,0)', E_PAGE.x + 12, E_PAGE.y + 22);
    ctx.fillText(`(${E_PAGE.w},${E_PAGE.h})`, E_PAGE.x + E_PAGE.w - 80, E_PAGE.y + E_PAGE.h - 10);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of ink.strokes) {
      ctx.strokeStyle = inkColor(s.pointerType);
      ctx.lineWidth = 4;
      ctx.beginPath();
      s.pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      if (s.pts.length === 1) ctx.lineTo(s.pts[0].x + 0.1, s.pts[0].y);
      ctx.stroke();
    }
  }

  function setScale(canvas, scale) {
    const s = Math.min(4, Math.max(0.25, Number(scale.toFixed(2))));
    const v = ink.view;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = (w / 2 - v.tx) / v.scale;
    const cy = (h / 2 - v.ty) / v.scale;
    v.scale = s;
    v.tx = w / 2 - cx * s;
    v.ty = h / 2 - cy * s;
    drawScene(canvas);
    setText('e-zoom', Math.round(s * 100) + '%');
  }

  function eVerdict() { const p = sc('E').payload || {}; return p; }

  function eSave(partial) {
    const p = Object.assign({}, eVerdict(), partial);
    p.strokeCount = ink.strokes.length;
    p.viewMatrix = Object.assign({}, ink.view);
    const s1 = p.step1, s2 = p.step2;
    let status = sc('E').status === 'idle' ? 'running' : sc('E').status;
    if (s1 && s1.verdict && s2 && s2.verdict && (s2.verdict !== 'cannot' || (s2.note || '').trim())) status = s1.verdict === 'floats' ? 'fail' : 'pass';
    else if (status === 'pass' || status === 'fail') status = 'running';
    store.setScenarioResult('E', status, p);
    store.state.scenarios.E.strokeCount = ink.strokes.length;
    store.persist();
  }

  PANES.E = {
    html() {
      const p = eVerdict();
      const s1 = p.step1 || {};
      const s2 = p.step2 || {};
      const zoomPct = Math.round(ink.view.scale * 100);
      return `<div class="probe-surface probe-surface--fixed" id="e-surface" role="application" tabindex="0" aria-label="Superficie de tinta / Ink surface"><canvas id="e-canvas"></canvas></div>
        <div class="probe-zoombar">
          <div class="ds-dock" role="toolbar" aria-label="Herramienta / Tool">
            <button type="button" class="ds-tool" aria-pressed="${ink.tool === 'draw'}" data-act="e-tool" data-key="draw">${ic('pen', 'lg')}<span lang="es">Dibujar</span><span lang="en" class="ds-tool__en">Draw</span></button>
            <button type="button" class="ds-tool" aria-pressed="${ink.tool === 'pan'}" data-act="e-tool" data-key="pan">${ic('hand', 'lg')}<span lang="es">Mover</span><span lang="en" class="ds-tool__en">Pan</span></button>
          </div>
          <div class="ds-zoom" role="group" aria-label="Zoom">
            <button type="button" class="ds-iconbtn ds-iconbtn--board" data-act="e-zoom" data-delta="-0.25" aria-label="Alejar / Zoom out">${ic('minus', 'xl')}</button>
            <span class="ds-zoom__value" id="e-zoom" role="status">${zoomPct}%</span>
            <button type="button" class="ds-iconbtn ds-iconbtn--board" data-act="e-zoom" data-delta="0.25" aria-label="Acercar / Zoom in">${ic('plus', 'xl')}</button>
            <button type="button" class="ds-iconbtn ds-iconbtn--board" data-act="e-fit" aria-label="Ajustar / Fit">${ic('maximize', 'xl')}</button>
          </div>
          ${btn('e-150', 'Zoom 150 %', 'Zoom 150%', { variant: 'secondary', icon: 'zoom-in' })}
          ${btn('e-clear', 'Borrar tinta', 'Clear ink', { variant: 'ghost', icon: 'eraser' })}
        </div>
        <div class="probe-scroll"><p class="probe-lead"><span lang="es">Nuestra tinta debe quedarse en el contenido al hacer zoom. La tinta de Overlay no debe seguir nuestro zoom.</span><span class="en" lang="en">Our ink must stay on the content when you zoom. Overlay ink must not follow our zoom.</span></p><div class="probe-block">
          <h3 class="probe-block__title">1 · ${biInline('Nuestra tinta', 'Our ink')}</h3>
          <p class="probe-note"><span lang="es">Overlay OFF. Dibuja con el dedo, toca «Zoom 150 %» y mira si el trazo sigue sobre el contenido.</span><span class="en" lang="en">Overlay OFF. Draw with a finger, tap “Zoom 150%” and check the stroke stays on the content.</span></p>
          <div class="probe-opts">${check('e1overlay', Boolean(s1.overlayOn), false, 'Overlay estuvo ON', 'Overlay was ON', 'data-chg="e-check" data-step="step1"')}</div>
          <div class="probe-opts" role="radiogroup">${radio('e1v', 'anchored', s1.verdict === 'anchored', false, 'Sí, anclada', 'Yes, anchored', 'data-chg="e-verdict" data-step="step1"')}${radio('e1v', 'floats', s1.verdict === 'floats', false, 'No, flota', 'No, it floats', 'data-chg="e-verdict" data-step="step1"')}</div>
        </div>
        <div class="probe-block probe-block--warn">
          <h3 class="probe-block__title">2 · ${biInline('Acetato de Overlay', 'Overlay ink')}</h3>
          <p class="probe-note"><span lang="es">Overlay ON. Dibuja con el lápiz de bandeja, luego haz zoom en nuestra vista. La tinta de Overlay no debería seguir. Foto opcional.</span><span class="en" lang="en">Overlay ON. Draw with the tray pen, then zoom our view. Overlay ink should not follow. Photo optional.</span></p>
          <div class="probe-opts">${check('e2overlay', Boolean(s2.overlayOn), false, 'Overlay estuvo ON', 'Overlay was ON', 'data-chg="e-check" data-step="step2"')}</div>
          <div class="probe-opts" role="radiogroup">${radio('e2v', 'notfollow', s2.verdict === 'notfollow', false, 'No siguió', 'Did not follow', 'data-chg="e-verdict" data-step="step2"')}${radio('e2v', 'followed', s2.verdict === 'followed', false, 'Siguió', 'Followed', 'data-chg="e-verdict" data-step="step2"')}${radio('e2v', 'cannot', s2.verdict === 'cannot', false, 'No pude probar', 'Could not test', 'data-chg="e-verdict" data-step="step2"')}</div>
          ${field(['Notas (obligatorio si no pudiste probar)', 'Notes (required if you could not test)'], '', `<input class="ds-input" type="text" data-chg="e-note" value="${esc(s2.note || '')}" autocomplete="off">`)}
        </div>
        <p class="probe-note">${biInline('viewMatrix', 'viewMatrix')}: <span class="probe-mono">${esc(safeJson(ink.view))}</span> · ${ink.strokes.length} ${biInline('trazos', 'strokes')}</p></div>`;
    },
    bind() {
      const surface = document.getElementById('e-surface');
      const canvas = document.getElementById('e-canvas');
      const fit = () => { fitCanvas(canvas); drawScene(canvas); };
      const ro = new ResizeObserver(fit);
      ro.observe(canvas);
      fit();
      let current = null;
      let panLast = null;
      const toContent = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left - ink.view.tx) / ink.view.scale, y: (e.clientY - r.top - ink.view.ty) / ink.view.scale };
      };
      const down = (e) => {
        surface.setPointerCapture && surface.setPointerCapture(e.pointerId);
        if (ink.tool === 'pan') { panLast = { x: e.clientX, y: e.clientY }; return; }
        current = { pointerType: e.pointerType || 'mouse', step: ink.step, viewAtDraw: Object.assign({}, ink.view), pts: [toContent(e)] };
        ink.strokes.push(current);
        if (sc('E').status === 'idle') { store.setScenarioResult('E', 'running'); refresh(); }
        drawScene(canvas);
      };
      const move = (e) => {
        if (panLast) { ink.view.tx += e.clientX - panLast.x; ink.view.ty += e.clientY - panLast.y; panLast = { x: e.clientX, y: e.clientY }; drawScene(canvas); return; }
        if (!current) return;
        current.pts.push(toContent(e));
        drawScene(canvas);
      };
      const up = () => {
        if (current) { eSave({}); refresh(); say(`E: trazo ${ink.strokes.length} dibujado a ${Math.round(ink.view.scale * 100)} %`, `E: stroke ${ink.strokes.length} drawn at ${Math.round(ink.view.scale * 100)}%`); }
        current = null; panLast = null;
      };
      const wheel = (e) => { e.preventDefault(); setScale(canvas, ink.view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); };
      surface.addEventListener('pointerdown', down);
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', up);
      surface.addEventListener('pointercancel', up);
      surface.addEventListener('wheel', wheel, { passive: false });
      return () => { ro.disconnect(); surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', up); surface.removeEventListener('wheel', wheel); };
    }
  };
  const eCanvas = () => document.getElementById('e-canvas');
  acts['e-tool'] = (t) => { ink.tool = t.dataset.key; renderPane(true); };
  acts['e-zoom'] = (t) => { setScale(eCanvas(), ink.view.scale + Number(t.dataset.delta)); eSave({}); };
  acts['e-fit'] = () => { ink.view = { scale: 1, tx: 0, ty: 0 }; setScale(eCanvas(), 1); eSave({}); };
  acts['e-150'] = () => { setScale(eCanvas(), 1.5); eSave({}); say('E: zoom a 150 %', 'E: zoom to 150%'); };
  acts['e-clear'] = () => { ink.strokes = []; drawScene(eCanvas()); eSave({}); renderHead(); };
  acts['e-check'] = (t) => {
    const p = eVerdict();
    const step = Object.assign({}, p[t.dataset.step], { overlayOn: t.checked });
    const part = {}; part[t.dataset.step] = step;
    eSave(part);
    afterChange({ pane: false });
  };
  acts['e-verdict'] = (t) => {
    const p = eVerdict();
    const step = Object.assign({}, p[t.dataset.step], { verdict: t.value, viewMatrix: Object.assign({}, ink.view), strokes: ink.strokes.length, recordedAt: new Date().toISOString() });
    const part = {}; part[t.dataset.step] = step;
    eSave(part);
    say(`E ${t.dataset.step === 'step1' ? '1' : '2'}: veredicto ${t.value}`, `E ${t.dataset.step === 'step1' ? '1' : '2'}: verdict ${t.value}`);
    afterChange({ pane: false });
  };
  acts['e-note'] = (t) => {
    const p = eVerdict();
    eSave({ step2: Object.assign({}, p.step2, { note: t.value }) });
    refresh();
  };

  /* ------------------------------------------------------------------ F: Chrome / Android constraints */

  const visLog = [];
  const fLive = { none: { moves: 0, cancels: 0, downs: 0 }, auto: { moves: 0, cancels: 0, downs: 0 }, pd: { touchstart: null, pointerdown: null, passive: null }, kb: null, paneScrollStart: 0, scaleStart: 1 };
  const F_ITEMS = [
    ['touchAction', 'touch-action: none frente a auto', 'touch-action: none vs auto'],
    ['preventDefault', 'preventDefault en touchstart / pointerdown', 'preventDefault on touchstart / pointerdown'],
    ['fullscreen', 'Pantalla completa', 'Fullscreen'],
    ['pointerLock', 'Bloqueo de puntero', 'Pointer lock'],
    ['keyboard', 'Teclado virtual', 'Virtual keyboard'],
    ['wakeLock', 'Wake lock y visibilitychange', 'Wake lock and visibilitychange']
  ];

  function fItems() { return (sc('F').payload && sc('F').payload.items) || {}; }

  function fRegister(id, value, opts) {
    const p = sc('F').payload || { items: {} };
    p.items = Object.assign({}, p.items);
    p.items[id] = Object.assign({ testedAt: new Date().toISOString() }, value);
    const all = F_ITEMS.every((i) => p.items[i[0]]);
    store.setScenarioResult('F', all ? 'pass' : 'running', p);
    say(`F ${id}: registrado`, `F ${id}: recorded`);
    refresh();
    if (!opts || opts.rerender !== false) renderPane(true);
  }

  function dims() {
    const vv = window.visualViewport;
    return { innerHeight: window.innerHeight, visualViewportHeight: vv ? Math.round(vv.height) : null, dvh: el.dvh.offsetHeight, visualViewportScale: vv ? vv.scale : null };
  }

  function fCheckHtml(item, body) {
    const r = fItems()[item[0]];
    return `<li class="probe-check"><div class="probe-check__head"><h3 class="probe-check__title">${bi(item[1], item[2])}</h3>${r ? `<span class="ds-badge ds-badge--success">${ic('circle-check', 'sm')}<span lang="es">Registrado</span><span aria-hidden="true">/</span><span lang="en">Recorded</span></span>` : `<span class="ds-badge">${ic('circle', 'sm')}<span lang="es">Sin probar</span><span aria-hidden="true">/</span><span lang="en">Untested</span></span>`}</div>
      ${body}${r ? dump(r) : ''}</li>`;
  }

  PANES.F = {
    html() {
      const bodies = {
        touchAction: `<p class="probe-note"><span lang="es">Arrastra con el dedo en cada zona y pulsa «Registrar». Mide cancelaciones de puntero, desplazamiento y zoom de la página.</span><span class="en" lang="en">Drag a finger in each zone and tap “Record”. Measures pointer cancels, scroll and page zoom.</span></p>
          <div class="probe-zones"><div><p class="t-caption">touch-action: none</p><div class="probe-zone probe-zone--none" id="f-zone-none" tabindex="0"><div class="probe-zone__tall"></div></div></div>
          <div><p class="t-caption">touch-action: auto</p><div class="probe-zone probe-zone--auto" id="f-zone-auto" tabindex="0"><div class="probe-zone__tall"></div></div></div></div>
          <div class="probe-row">${btn('f-reg-touch', 'Registrar', 'Record', { variant: 'secondary', icon: 'save' })}</div>`,
        preventDefault: `<p class="probe-note"><span lang="es">Toca la zona una vez y pulsa «Registrar».</span><span class="en" lang="en">Tap the zone once and tap “Record”.</span></p>
          <div class="probe-zone probe-zone--tap" id="f-zone-pd" tabindex="0"><span>${biInline('Toca aquí', 'Tap here')}</span></div>
          <div class="probe-row">${btn('f-reg-pd', 'Registrar', 'Record', { variant: 'secondary', icon: 'save' })}</div>`,
        fullscreen: `<div class="probe-row">${btn('f-fullscreen', 'Pedir pantalla completa', 'Request fullscreen', { icon: 'maximize' })}</div>`,
        pointerLock: `<div class="probe-row">${btn('f-lock', 'Pedir bloqueo de puntero', 'Request pointer lock', { icon: 'lock' })}</div>`,
        keyboard: `<p class="probe-note"><span lang="es">Toca el campo; se mide si Chrome cambia el tamaño de la vista.</span><span class="en" lang="en">Tap the field; we measure whether Chrome resizes the view.</span></p>
          <input class="ds-input" type="text" id="f-kb-input" data-chg="f-kb" placeholder="Toca aquí / Tap here" autocomplete="off"><p class="probe-note" aria-live="polite"><span id="f-kb-live"></span></p>`,
        wakeLock: `<p class="probe-note"><span lang="es">Pide el wake lock y abre la barra lateral de SMART; vuelve a esta pestaña. Eventos de visibilidad: <strong id="f-vis">${visLog.length}</strong>.</span><span class="en" lang="en">Request the wake lock and open SMART’s side toolbar; come back to this tab. Visibility events: <strong>${visLog.length}</strong>.</span></p>
          <div class="probe-row">${btn('f-wake', 'Pedir wake lock', 'Request wake lock', { icon: 'eye' })}${btn('f-reg-vis', 'Registrar visibilidad', 'Record visibility', { variant: 'secondary', icon: 'save' })}</div>`
      };
      return `<p class="probe-lead"><span lang="es">Seis comprobaciones de un toque. Un fallo es un dato, no un error.</span><span class="en" lang="en">Six one-tap checks. A failure is data, not an error.</span></p>
        <ul class="probe-checks" role="list">${F_ITEMS.map((i) => fCheckHtml(i, bodies[i[0]])).join('')}</ul>`;
    },
    bind() {
      fLive.none = { moves: 0, cancels: 0, downs: 0 };
      fLive.auto = { moves: 0, cancels: 0, downs: 0 };
      fLive.pd = { touchstart: null, pointerdown: null, passive: null };
      fLive.paneScrollStart = el.pane.scrollTop;
      fLive.scaleStart = window.visualViewport ? window.visualViewport.scale : 1;
      const offs = [];
      const on = (target, type, fn, opts) => { if (!target) return; target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
      for (const key of ['none', 'auto']) {
        const zone = document.getElementById('f-zone-' + key);
        const inner = zone && zone.firstElementChild;
        on(zone, 'pointerdown', () => { fLive[key].downs++; });
        on(zone, 'pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') fLive[key].moves++; });
        on(zone, 'pointercancel', () => { fLive[key].cancels++; });
        fLive[key].scrollStart = zone ? zone.scrollTop : 0;
        fLive[key].zone = zone;
      }
      const pd = document.getElementById('f-zone-pd');
      const rec = (name, e, after) => { fLive.pd[name] = { seen: true, cancelable: e.cancelable, defaultPreventedBefore: e.defaultPrevented, defaultPreventedAfter: after }; };
      on(pd, 'touchstart', (e) => { const before = e.defaultPrevented; e.preventDefault(); fLive.pd.touchstart = { seen: true, cancelable: e.cancelable, defaultPreventedBefore: before, defaultPreventedAfter: e.defaultPrevented }; }, { passive: false });
      on(pd, 'pointerdown', (e) => { const before = e.defaultPrevented; e.preventDefault(); fLive.pd.pointerdown = { seen: true, cancelable: e.cancelable, defaultPreventedBefore: before, defaultPreventedAfter: e.defaultPrevented }; });
      on(pd, 'touchstart', (e) => {
        let threw = null;
        try { e.preventDefault(); } catch (err) { threw = errStr(err); }
        fLive.pd.passive = { seen: true, defaultPreventedAfter: e.defaultPrevented, threw };
      }, { passive: true });
      const kb = document.getElementById('f-kb-input');
      on(kb, 'focus', async () => {
        const before = fLive.kbBefore || dims();
        await sleep(900);
        const after = dims();
        fLive.kb = { before, after, resizedLayout: before.dvh !== after.dvh, resizedVisual: before.visualViewportHeight !== after.visualViewportHeight || before.innerHeight !== after.innerHeight };
        if (document.getElementById('f-kb-input')) { fRegister('keyboard', fLive.kb, { rerender: false }); setText('f-kb-live', `layout ${fLive.kb.resizedLayout ? 'sí/yes' : 'no'} · visual ${fLive.kb.resizedVisual ? 'sí/yes' : 'no'}`); }
      });
      fLive.kbBefore = dims();
      return () => offs.forEach((f) => f());
    }
  };
  acts['f-reg-touch'] = () => {
    const snap = (k) => ({ pointerdown: fLive[k].downs, pointermoves: fLive[k].moves, pointercancels: fLive[k].cancels, scrollDelta: fLive[k].zone ? fLive[k].zone.scrollTop - fLive[k].scrollStart : 0 });
    fRegister('touchAction', { none: snap('none'), auto: snap('auto'), paneScrollDelta: el.pane.scrollTop - fLive.paneScrollStart, pageScrollY: window.scrollY, visualViewportScaleStart: fLive.scaleStart, visualViewportScaleNow: window.visualViewport ? window.visualViewport.scale : null });
  };
  acts['f-reg-pd'] = () => fRegister('preventDefault', { touchstart: fLive.pd.touchstart || { seen: false }, pointerdown: fLive.pd.pointerdown || { seen: false }, passiveTouchstart: fLive.pd.passive || { seen: false } });
  acts['f-fullscreen'] = async () => {
    const root = document.documentElement;
    let r;
    if (!root.requestFullscreen) r = { supported: false, fullscreenEnabled: document.fullscreenEnabled };
    else {
      try { await root.requestFullscreen(); r = { supported: true, entered: Boolean(document.fullscreenElement) }; await sleep(700); try { await document.exitFullscreen(); } catch (_) { /* ignore */ } }
      catch (e) { r = { supported: true, entered: false, error: errStr(e) }; }
    }
    fRegister('fullscreen', r);
  };
  acts['f-lock'] = async () => {
    const target = document.getElementById('f-zone-pd') || document.documentElement;
    let r;
    if (!target.requestPointerLock) r = { supported: false };
    else {
      const events = [];
      const onChange = () => events.push('pointerlockchange');
      const onError = () => events.push('pointerlockerror');
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const ret = target.requestPointerLock();
        if (ret && ret.then) await withTimeout(ret, 1500);
        await sleep(400);
        r = { supported: true, locked: document.pointerLockElement === target, events };
        if (document.exitPointerLock) document.exitPointerLock();
      } catch (e) { r = { supported: true, locked: false, error: errStr(e), events }; }
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onError);
    }
    fRegister('pointerLock', r);
  };
  acts['f-kb'] = () => { /* measurement happens in the focus listener */ };
  acts['f-wake'] = async () => {
    let r;
    if (!('wakeLock' in navigator)) r = { supported: false };
    else {
      try { const lock = await navigator.wakeLock.request('screen'); r = { supported: true, acquired: true, type: lock.type }; await sleep(800); await lock.release(); r.released = true; }
      catch (e) { r = { supported: true, acquired: false, error: errStr(e) }; }
    }
    r.visibilityEvents = visLog.slice(-20);
    fRegister('wakeLock', r);
  };
  acts['f-reg-vis'] = () => fRegister('wakeLock', Object.assign({}, fItems().wakeLock || {}, { visibilityEvents: visLog.slice(-20), recordedAt: new Date().toISOString() }));

  function recordVisibility(type) {
    visLog.push({ at: new Date().toISOString(), type, visibilityState: document.visibilityState });
    if (visLog.length > 100) visLog.shift();
    say(`Pestaña: ${type} (${document.visibilityState})`, `Tab: ${type} (${document.visibilityState})`);
    setText('f-vis', String(visLog.length));
  }

  /* ------------------------------------------------------------------ G: storage and export */

  async function storageSmoke() {
    const r = { at: new Date().toISOString() };
    try { const k = 'smart-board-probe:smoke'; localStorage.setItem(k, '1'); r.localStorage = { ok: localStorage.getItem(k) === '1' }; localStorage.removeItem(k); }
    catch (e) { r.localStorage = { ok: false, error: errStr(e) }; }
    try {
      r.indexedDB = await withTimeout(new Promise((resolve, reject) => {
        const open = indexedDB.open('smart-board-probe-smoke', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put('1', 'k');
          const get = tx.objectStore('kv').get('k');
          tx.oncomplete = () => { db.close(); indexedDB.deleteDatabase('smart-board-probe-smoke'); resolve({ ok: get.result === '1' }); };
          tx.onerror = () => reject(tx.error);
        };
      }), 4000);
    } catch (e) { r.indexedDB = { ok: false, error: errStr(e) }; }
    try {
      if (navigator.storage && navigator.storage.estimate) { const est = await navigator.storage.estimate(); r.quota = { usage: est.usage, quota: est.quota }; }
    } catch (e) { r.quota = { error: errStr(e) }; }
    return r;
  }

  let gShowJson = false;

  PANES.G = {
    html() {
      const s = sc('G');
      const p = s.payload || {};
      const ev = store.state.evidence;
      const smoke = p.smoke;
      const summary = BILINGUAL.scenarios.filter((m) => !m.optional && m.id !== 'G' && m.card !== false).map((m) => `<li class="probe-sumrow">${bi(m.id + ' · ' + m.es, m.en)}${statusBadge(sc(m.id).status)}</li>`).join('');
      const lastExport = p.exports && p.exports.length ? p.exports[p.exports.length - 1] : null;
      return `<h3 class="probe-s__title" id="save-title">① ${biInline('Guardar', 'Save')}</h3>
        <p class="probe-lead"><span lang="es">Comprueba el almacenamiento, exporta el JSON y copia el registro. Deja la pestaña abierta hasta que el archivo esté en Descargas.</span><span class="en" lang="en">Check storage, export the JSON and copy the log. Leave the tab open until the file is in Downloads.</span></p>
        ${lastExport ? `<p class="probe-note"><span class="probe-mono">${esc(lastExport.filename)} · ${hhmm(lastExport.at)}</span></p>` : ''}
        <div class="probe-row">
          ${btn('g-export', 'Exportar JSON', 'Export JSON', { icon: 'download' })}
          ${btn('g-copy-json', 'Copiar JSON', 'Copy JSON', { variant: 'secondary', icon: 'clipboard-list' })}
          ${btn('g-copy-log', 'Copiar registro', 'Copy log', { variant: 'secondary', icon: 'clipboard-list' })}
          ${btn('g-smoke', 'Probar almacenamiento', 'Test storage', { variant: 'secondary', icon: 'save' })}
          ${btn('g-show', gShowJson ? 'Ocultar JSON' : 'Mostrar JSON', gShowJson ? 'Hide JSON' : 'Show JSON', { variant: 'ghost', icon: 'eye' })}
        </div>
        <div class="probe-block ${ev.complete ? 'probe-block--tinted' : 'probe-block--warn'}">
          <h3 class="probe-block__title">${ev.complete ? biInline('evidence.complete: sí', 'evidence.complete: yes') : biInline('evidence.complete: no', 'evidence.complete: no')}</h3>
          ${ev.complete ? '' : `<ul class="probe-list-plain">${missingList(ev.missing)}</ul>`}
        </div>
        ${smoke ? kv([
          ['localStorage', 'localStorage', smoke.localStorage.ok ? 'ok' : esc(smoke.localStorage.error || 'fail')],
          ['indexedDB', 'indexedDB', smoke.indexedDB.ok ? 'ok' : esc(smoke.indexedDB.error || 'fail')],
          ['Cuota', 'Quota', smoke.quota ? esc(safeJson(smoke.quota)) : 'n/a']
        ]) : ''}
        <ul class="probe-checks" role="list">${summary}</ul>
        ${gShowJson ? `<label class="ds-field"><span class="ds-field__label"><span lang="es">JSON de exportación (copia manual)</span><span class="en" lang="en">Export JSON (manual copy)</span></span><textarea class="ds-input probe-json" readonly rows="14">${esc(exportJsonText())}</textarea></label>` : ''}${sendHtml()}`;
    }
  };
  acts['g-export'] = exportClicked;
  acts['g-copy-json'] = async () => { const ok = await copyText(exportJsonText()); say(ok ? 'JSON copiado' : 'No se pudo copiar el JSON: usa «Mostrar JSON»', ok ? 'JSON copied' : 'Could not copy JSON: use “Show JSON”', ok ? 'info' : 'warn'); };
  acts['g-copy-log'] = copyLogAction;
  acts['g-show'] = () => { gShowJson = !gShowJson; renderPane(true); };
  acts['g-smoke'] = async () => {
    const smoke = await storageSmoke();
    const prior = sc('G').payload || {};
    store.setScenarioResult('G', 'pass', Object.assign({}, prior, { smoke }));
    say(`Almacenamiento: localStorage ${smoke.localStorage.ok}, indexedDB ${smoke.indexedDB.ok}`, `Storage: localStorage ${smoke.localStorage.ok}, indexedDB ${smoke.indexedDB.ok}`);
    afterChange();
  };

  /* ------------------------------------------------------------------ H: Overlay follows content (spec v0.4 AC12–AC18, UX §16) */

  const H_TRIALS = {
    H1a: { surface: 'S-doc', es: 'Desplazar la página', en: 'Scroll the page', doEs: 'desplaza la página con el dedo', doEn: 'scroll the page with a finger' },
    H1b: { surface: 'S-box', es: 'Desplazar la caja', en: 'Scroll the box', doEs: 'desplaza la caja con el dedo', doEn: 'scroll the box with a finger' },
    H2: { surface: 'S-doc', es: 'Zoom de página (pellizco)', en: 'Pinch-zoom the page', doEs: 'haz zoom con dos dedos (pellizco)', doEn: 'pinch-zoom the page' },
    H3: { surface: 'S-xform', es: 'Arrastrar o zoom (CSS)', en: 'Drag or zoom (CSS)', doEs: 'arrastra con un dedo o usa +/−', doEn: 'drag with one finger or use +/−' }
  };
  const H_WORD = { follows: ['sigue', 'follows'], stays: ['se queda', 'stays'], partial: ['parcial', 'partial'], scales: ['escala', 'scales'], 'n/a': ['n/a', 'n/a'] };
  const H4_CHIPS = [['Visor del tablero', 'Board viewer'], ['Archivos / Files', 'Files'], ['Compartir / Share', 'Share'], ['Otra', 'Other']];
  const H5_ROWS = [
    ['H5a', '¿Overlay se cierra con un botón?', 'Does Overlay close with a button?', 'cuál botón / which button'],
    ['H5b', '¿Overlay se cierra con un gesto?', 'Does Overlay close with a gesture?', 'cuál gesto / which gesture'],
    ['H5c', '¿Overlay se cierra al devolver el lápiz a la bandeja?', 'Does Overlay close when the pen goes back in the tray?', ''],
    ['H5d', '¿Se borra la tinta al cerrar Overlay?', 'Is the ink erased when Overlay closes?', 'se guarda / save prompt / kept'],
    ['H5e', '¿Overlay ofrece Compartir o Guardar?', 'Does Overlay offer Share or Save?', 'cuál / which'],
    ['H5f', '¿La sonda instalada aparece en la lista de Compartir?', 'Is the installed probe in the Share list?', ''],
    ['H5g', '¿Ajustes de GX tiene opción de lápiz / Overlay automático?', 'Does GX Settings have a pen-pickup / Overlay auto-launch setting?', 'ruta y valores / path and values']
  ];
  const SHARE_KEY = 'smart-board-probe:share';

  const hLive = {
    open: null, spec: null, draft: null, recorder: null, recorderError: false, running: false, t0: 0, elapsed: 0, timerId: 0,
    side: 'right', sheet: 'peek', err: null, saved: false, still: false, summary: null, live: { scroll: 0, vvMin: 1, vvMax: 1 },
    lastTop: {}, tapTimes: [], recOffs: [], offs: [], paneScroll: 0, xf: { scale: 1, tx: 0, ty: 0 }, install: null, h6Na: false
  };
  const hTrial = (id) => store.state.overlayFollow.trials[id];
  const hStatusOf = (t) => (Core.isHTrialTerminal(t) ? (t.verdict === 'n/a' ? 'na' : 'pass') : 'idle');
  const hWord = (v) => H_WORD[v] || [String(v), String(v)];
  const hDoneCount = () => ['H1a', 'H1b', 'H3'].filter((id) => Core.isHTrialTerminal(hTrial(id)) && hTrial(id).overlayOn === true).length;
  const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '--:--' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const sumCounts = (o) => Object.values(o || {}).reduce((a, v) => a + (typeof v === 'number' ? v : sumCounts(v)), 0);
  const hTimelines = () => Core.H_IDS.reduce((acc, id) => acc.concat(Array.isArray(hTrial(id).timeline) ? hTrial(id).timeline : []), []);

  function hCount(c, key, type) {
    const v = c && c[key];
    if (typeof v === 'number') return v;
    if (!v) return 0;
    return type ? (v[type] || 0) : sumCounts(v);
  }

  // facts, not colours: counts exact, pointermove stored sampled
  function hCountsLine(c, scrollSum, vvText) {
    const ptr = (type) => ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].reduce((a, k) => a + hCount(c, k, type), 0);
    const scroll = scrollSum == null ? `scroll ${hCount(c, 'scroll')}` : `scrollΔ ${scrollSum}`;
    return `blur ${hCount(c, 'blur')} · focus ${hCount(c, 'focus')} · vis ${hCount(c, 'visibilitychange')} · pen ${ptr('pen')} · touch ${ptr('touch')} · mouse ${ptr('mouse')} · ${scroll}${vvText ? ' · vv ' + vvText : ''}`;
  }

  /* ---- H pane (P3) */

  function hTrialRow(id) {
    const m = H_TRIALS[id];
    const t = hTrial(id);
    const w = hWord(t.verdict);
    const result = t.verdict
      ? `<span class="ds-badge${t.verdict === 'n/a' ? '' : ' ds-badge--info'}">${biInline(w[0], w[1])}</span>${t.overlayOn ? `<span class="ds-badge ds-badge--warning">${ic('triangle-alert', 'sm')}Overlay ON</span>` : ''}${t.recalled ? `<span class="ds-badge">${biInline('de memoria', 'recalled')}</span>` : ''}${t.truncated ? `<span class="ds-badge ds-badge--warning">${biInline('truncado', 'truncated')}</span>` : ''}`
      : '';
    const counts = t.counts ? `<span class="probe-mono">${esc(hCountsLine(t.counts))}</span>` : '';
    return `<li class="ds-card probe-h-trial"><span class="probe-h-trial__id">${id}</span>
      <div><div>${bi(`${m.surface} · ${m.es}`, m.en)}</div><div class="probe-h-trial__sub">${result}${counts}${t.notes ? `<span>${esc(t.notes.length > 60 ? t.notes.slice(0, 59) + '…' : t.notes)}</span>` : ''}</div></div>
      <div class="probe-h-trial__acts">${statusBadge(hStatusOf(t))}${btn('h-open', 'Abrir', 'Open', { icon: 'play', attrs: `data-tid="${id}"` })}${btn('h-skip', 'Saltar…', 'Skip…', { variant: 'ghost', attrs: `data-tid="${id}"` })}</div></li>`;
  }

  function h5Row(r) {
    const of = store.state.overlayFollow;
    const a = of.h5[r[0]];
    const na = r[0] === 'H5f' && of.h5.H5e.answer === 'no';
    const opts = [['yes', 'sí', 'yes'], ['no', 'no', 'no'], ['unknown', 'no sé', 'unknown']]
      .map((o) => radio('h5-' + r[0], o[0], a.answer === o[0], na, o[1], o[2], `data-chg="h5-ans" data-id="${r[0]}"`)).join('');
    return `<div class="probe-h-h5${na ? ' probe-h-h5--na' : ''}"><div>${bi(`${r[0]} · ${r[1]}`, r[2])}${na ? `<span class="probe-note">${biInline('no aplica', 'n/a')}</span>` : ''}</div>
      <div class="probe-h-opts" role="radiogroup" aria-label="${r[0]}">${opts}</div>
      <input class="ds-input" type="text" data-chg="h5-note" data-id="${r[0]}" value="${esc(a.note)}" placeholder="${esc(r[3])}"${na ? ' readonly' : ''} autocomplete="off" aria-label="${r[0]} nota / note"></div>`;
  }

  function hMechanismHtml() {
    const of = store.state.overlayFollow;
    const mech = Core.computeOverlayMechanism(of.trials);
    const known = ['follows', 'stays', 'partial'];
    const basis = ['H1a', 'H1b', 'H3'].map((id) => { const t = of.trials[id]; const w = t && Core.isHTrialTerminal(t) ? hWord(t.verdict) : null; return `${id} ${w ? w[0] + ' / ' + w[1] : '—'}`; }).join(' · ');
    const missing = ['H1a', 'H1b', 'H3'].filter((id) => !known.includes(of.trials[id].verdict));
    const h2 = of.trials.H2;
    const h2w = h2 && Core.isHTrialTerminal(h2) ? hWord(h2.verdict) : null;
    const sigs = Core.computeOverlaySignals(of.taps, hTimelines());
    const kinds = Array.from(new Set(sigs.reduce((acc, s) => acc.concat(s.events.map((e) => e.kind)), [])));
    const gx = store.state.host.classification === 'gx-android';
    return `<div class="probe-h-mech" role="status">
        <div class="probe-h-mech__line">${biInline('Mecanismo', 'Mechanism')}: <span class="probe-h-mech__val">${mech}</span></div>
        <div class="probe-h-mech__line">${biInline('Basado en', 'Based on')}: ${esc(basis)} · GX: ${gx ? 'sí / yes' : 'no'}</div>
        ${mech === 'inconclusive' ? `<div class="probe-h-mech__line">${biInline('falta', 'missing')}: ${missing.join(' ')}</div>` : ''}
        <div class="probe-h-mech__line">${biInline('Zoom (H2): refina solo el zoom', 'Zoom (H2): refines zoom only')}: ${h2w ? esc(h2w[0] + ' / ' + h2w[1]) : '—'}</div>
        <div class="probe-h-mech__line">${biInline('Señales de página cerca de «Overlay abierto»', 'Page signals near “Overlay is open”')}: ${of.taps.length ? `${kinds.length ? esc(kinds.join(', ')) : biInline('ninguna', 'none')} (${of.taps.length} taps)` : biInline('ninguna', 'none')}</div>
        <div class="probe-h-mech__line">${biInline('H completo', 'H complete')}: ${Core.isHComplete(store.state) ? 'sí / yes' : 'no'} · ${biInline('No cambia evidence.complete', 'Does not change evidence.complete')}</div>
      </div>`;
  }

  const h6Files = () => { const p = sc('H6').payload; return p && Array.isArray(p.files) ? p.files : []; };

  function hShareHtml() {
    const installed = window.matchMedia('(display-mode: standalone)').matches;
    const files = h6Files();
    const s = sc('H6');
    const a = sc('A').payload;
    const vp = a && a.viewport ? `${a.viewport.width}×${a.viewport.height}` : `${window.innerWidth}×${window.innerHeight}`;
    let body;
    if (files.length) {
      body = files.map((f) => (f.error
        ? `<div class="probe-h-recv">${notice('No se pudo leer el archivo', 'The file could not be read', 'circle-alert')}</div>`
        : `<div class="probe-h-recv"><div class="probe-h-thumb" aria-hidden="true">${esc(f.mime || '?')}</div><div>
            <p class="probe-mono">${esc(f.mime)} · ${fmtSize(f.byteSize)} · ${f.width ? `${f.width}×${f.height}` : '—'} · ${biInline('transparencia', 'has alpha')}: ${f.hasAlpha === true ? 'sí / yes' : f.hasAlpha === false ? 'no' : 'desconocido / unknown'}</p>
            <p class="probe-note">${biInline('Viewport de la página', 'Page viewport')}: <span class="probe-mono">${esc(vp)}</span></p>
            <p class="probe-note">${biInline('El archivo no se guarda ni se envía', 'The file is neither stored nor sent')}</p></div></div>`)).join('');
    } else if (s.status === 'na') {
      body = `<p class="probe-note">n/a — ${esc(s.notes)}</p>`;
    } else if (!installed) {
      body = `<p class="probe-note"><span lang="es">Instala la sonda: menú ⋮ de Chrome → Instalar aplicación.</span><span class="en" lang="en">Install the probe: Chrome ⋮ menu → Install app.</span></p>${hLive.install ? `<div class="probe-row">${btn('h6-install', 'Instalar', 'Install', { icon: 'download' })}</div>` : ''}`;
    } else {
      body = `<p class="probe-note"><span lang="es">Abre Overlay, escribe, y elige Compartir → Sonda.</span><span class="en" lang="en">Open Overlay, write, then choose Share → Probe.</span></p>
        <div class="probe-row">${btn('h6-na-toggle', 'No llegó nada · n/a…', 'Nothing arrived · n/a…', { variant: 'ghost' })}</div>
        ${hLive.h6Na ? `<div class="probe-block">${field(['Motivo (obligatorio)', 'Reason (required)'], '', '<input class="ds-input" type="text" id="h6-na-reason" autocomplete="off">')}<div class="probe-row">${btn('h6-na-confirm', 'Marcar n/a', 'Mark n/a')}</div></div>` : ''}`;
    }
    return `<div class="probe-block"><p class="probe-h-rule t-caption">${biInline('Si hay tiempo', 'If time')}</p>
      <h3 class="probe-block__title">H6 · ${biInline('Compartir → sonda', 'Share → probe')}</h3>${body}</div>`;
  }

  PANES.H = {
    html() {
      const of = store.state.overlayFollow;
      const v = of.trials.H1a.variant || {};
      const variantOpts = [['follows', 'sigue', 'follows'], ['stays', 'se queda', 'stays'], ['partial', 'parcial', 'partial']]
        .map((o) => radio('hvar', o[0], v.verdict === o[0], false, o[1], o[2], 'data-chg="h-variant-verdict"')).join('');
      const chips = H4_CHIPS.map((c) => `<button type="button" class="ds-chip" data-act="h4-chip" data-text="${esc(c[0])}">${esc(c[0])}</button>`).join('');
      return `<p class="probe-lead"><span lang="es">Antes: Overlay ON, lápiz de bandeja. Marca con el lápiz y mueve el contenido con el dedo. Esta página no dibuja: cualquier marca es de Overlay.</span><span class="en" lang="en">Before: Overlay ON, tray pen. Write a mark with the pen, then move the content with a finger. This page draws nothing: any mark is Overlay’s.</span></p>
        <h3 class="probe-block__title">${biInline('Ensayos', 'Trials')} <span class="ds-badge">${hDoneCount()}/3</span></h3>
        <ul class="probe-h-trials" role="list">${Core.H_IDS.map(hTrialRow).join('')}</ul>
        <div class="probe-block"><h3 class="probe-block__title">${biInline('Otra web larga en Chrome (opcional)', 'Any long site in Chrome (optional)')}</h3>
          ${field(['Sitio', 'Site'], '', `<input class="ds-input" type="text" data-chg="h-variant-site" value="${esc(v.site || '')}" autocomplete="off">`)}
          <div class="probe-opts" role="radiogroup">${variantOpts}</div></div>
        <div class="probe-block"><h3 class="probe-block__title">H4 · ${biInline('Respuestas', 'Answers')}</h3>
          <label class="ds-field"><span class="ds-field__label"><span lang="es">¿Qué app del tablero mantuvo la tinta sobre un PDF/imagen? ¿Cómo se abrió el archivo? ¿Siguió al desplazar, al zoom, o a ambos?</span><span class="en" lang="en">Which board app kept ink on a PDF/image? How was the file opened? Did it follow scroll, zoom, or both?</span></span><textarea class="ds-input" rows="3" data-chg="h4-text">${esc(of.h4)}</textarea></label>
          <div class="probe-opts">${chips}</div></div>
        <div class="probe-block"><h3 class="probe-block__title">H5 · ${biInline('Ciclo de vida de Overlay', 'Overlay lifecycle')}</h3>${H5_ROWS.map(h5Row).join('')}</div>
        ${hShareHtml()}
        ${hMechanismHtml()}`;
    }
  };

  acts['h4-text'] = (t) => store.setH4(t.value);
  acts['h4-chip'] = (t) => { const cur = store.state.overlayFollow.h4; store.setH4(cur ? cur + ' · ' + t.dataset.text : t.dataset.text); renderPane(true); };
  acts['h5-ans'] = (t) => { const id = t.dataset.id; store.setH5(id, t.value, store.state.overlayFollow.h5[id].note); say(`${id}: ${t.value}`, `${id}: ${t.value}`); afterChange(); };
  acts['h5-note'] = (t) => store.setH5Note(t.dataset.id, t.value);
  acts['h-variant-site'] = (t) => { const v = hTrial('H1a').variant || {}; store.setHVariant(t.value, v.verdict); };
  acts['h-variant-verdict'] = (t) => { const v = hTrial('H1a').variant || {}; store.setHVariant(v.site || '', t.value); };
  acts['h-skip'] = (t) => {
    const id = t.dataset.tid;
    const body = `<p>${biInline(`Saltar ${id}: ${esc(H_TRIALS[id].es)}`, `Skip ${id}: ${esc(H_TRIALS[id].en)}`)}</p>
      <label class="ds-field"><span class="ds-field__label"><span lang="es">Motivo (obligatorio)</span><span class="en" lang="en">Reason (required)</span></span><textarea class="ds-input" id="h-skip-reason" rows="3" placeholder="no se abrió Overlay / Overlay did not open"></textarea>
        <span class="ds-field__error" id="h-skip-error" hidden>${ic('circle-alert', 'sm')}<span>Escribe un motivo. / Write a reason.</span></span></label>`;
    const foot = `${btn('modal-close', 'Cancelar', 'Cancel', { variant: 'ghost' })}${btn('h-skip-confirm', 'Marcar n/a', 'Mark n/a', { attrs: `data-tid="${id}"` })}`;
    openModal(dialogShell('Saltar ensayo', 'Skip trial', body, foot), { focus: '#h-skip-reason' });
  };
  acts['h-skip-confirm'] = (t) => {
    const reason = (document.getElementById('h-skip-reason').value || '').trim();
    if (!reason) { document.getElementById('h-skip-error').hidden = false; return; }
    store.setHTrial(t.dataset.tid, { verdict: 'n/a', overlayOn: false, notes: reason, timeline: [], truncated: false, recalled: false });
    say(`${t.dataset.tid}: n/a — ${reason}`, `${t.dataset.tid}: n/a — ${reason}`);
    closeModal(true);
    afterChange();
  };
  acts['h6-na-toggle'] = () => { hLive.h6Na = !hLive.h6Na; renderPane(true); };
  acts['h6-na-confirm'] = () => {
    const reason = (document.getElementById('h6-na-reason').value || '').trim();
    if (!reason) { document.getElementById('h6-na-reason').setAttribute('aria-invalid', 'true'); return; }
    store.setScenarioResult('H6', 'na', null, reason);
    hLive.h6Na = false;
    say(`H6: n/a — ${reason}`, `H6: n/a — ${reason}`);
    afterChange();
  };
  acts['h6-install'] = async () => {
    const prompt = hLive.install;
    if (!prompt) return;
    hLive.install = null;
    try { await prompt.prompt(); } catch (_) { /* dismissed */ }
    if (activeId === 'H') renderPane(true);
  };
  acts['h-open'] = (t) => hOpen(t.dataset.tid);

  /* ---- received share (H6): the installed PWA window gets a redirect with metadata only; the file is already gone */

  let pendingShare = [];

  function readShareList() {
    try { const raw = ls && ls.getItem(SHARE_KEY); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list.slice(-10) : []; } catch (_) { return []; }
  }
  function saveShareList(list) {
    if (!ls) return;
    try { if (list.length) ls.setItem(SHARE_KEY, JSON.stringify(list)); else ls.removeItem(SHARE_KEY); } catch (_) { /* quota */ }
  }

  function takeShareFromUrl() {
    let packed = null;
    try { packed = new URLSearchParams(window.location.search).get('share'); } catch (_) { return; }
    if (!packed) return;
    let rec;
    try {
      const meta = JSON.parse(atob(packed.replace(/-/g, '+').replace(/_/g, '/')));
      rec = meta && meta.error
        ? { error: 'unreadable', at: new Date().toISOString() }
        : { mime: String(meta.mime || '').slice(0, 60), byteSize: Number(meta.byteSize) || 0, width: meta.width == null ? null : Number(meta.width), height: meta.height == null ? null : Number(meta.height), hasAlpha: typeof meta.hasAlpha === 'boolean' ? meta.hasAlpha : null, at: new Date().toISOString() };
    } catch (_) {
      rec = { error: 'unreadable', at: new Date().toISOString() };
    }
    pendingShare = pendingShare.concat([rec]);
    saveShareList(pendingShare);
    try { window.history.replaceState(null, '', window.location.pathname + window.location.hash); } catch (_) { /* ignore */ }
  }

  function renderShareBanner() {
    if (!pendingShare.length) { el.shareBanner.hidden = true; el.shareBanner.innerHTML = ''; return; }
    const last = pendingShare[pendingShare.length - 1];
    const what = last.error
      ? ['No se pudo leer el archivo recibido', 'The received file could not be read']
      : [`Archivo recibido: ${esc(last.mime)} ${last.width ? last.width + '×' + last.height : ''} · ${fmtSize(last.byteSize)}`, `File received: ${esc(last.mime)} ${last.width ? last.width + '×' + last.height : ''} · ${fmtSize(last.byteSize)}`];
    const canRestore = pendingRestore && !pendingRestore.error;
    el.shareBanner.hidden = false;
    el.shareBanner.innerHTML = `<div class="ds-banner" role="status">${ic('image', 'lg')}<div class="ds-banner__text"><span lang="es">${what[0]}</span><span class="ds-banner__en" lang="en">${what[1]}</span></div><div class="probe-banner-actions">${canRestore ? btn('share-restore', 'Restaurar visita y añadir a H6', 'Restore the visit and add to H6', { variant: 'secondary' }) : ''}${btn('share-add', canRestore ? 'Añadir a visita vacía' : 'Añadir a la visita', canRestore ? 'Add to an empty visit' : 'Add to the visit', { variant: 'secondary' })}${btn('share-ignore', 'Ignorar', 'Ignore', { variant: 'secondary' })}</div></div>`;
  }

  // H6 never persists the file: only metadata is appended, and a restore never overwrites H state.
  function h6Append(list) {
    const p = Object.assign({ files: [] }, sc('H6').payload);
    p.files = (p.files || []).concat(list.map((r) => { const o = Object.assign({}, r); o.receivedAt = o.at; delete o.at; return o; }));
    const ok = p.files.some((f) => !f.error);
    sc('H6').notes = ok ? '' : 'No se pudo leer el archivo / the file could not be read';
    store.setScenarioResult('H6', ok ? 'pass' : 'na', p);
    say(`H6: ${list.length} archivo(s) recibido(s) (solo metadatos)`, `H6: ${list.length} file(s) received (metadata only)`);
  }
  function clearShare() { pendingShare = []; saveShareList([]); renderShareBanner(); }

  acts['share-restore'] = () => {
    const list = pendingShare;
    acts['restore-yes']();
    claimWriter();
    h6Append(list);
    clearShare();
    refresh();
    selectScenario('H');
  };
  acts['share-add'] = () => { const list = pendingShare; h6Append(list); clearShare(); refresh(); selectScenario('H'); };
  acts['share-ignore'] = () => { clearShare(); say('Archivo recibido ignorado', 'Received file ignored'); };

  /* ---- single writer: the share opens the installed PWA window; two windows must not overwrite each other silently */

  const WRITER_KEY = 'smart-board-probe:writer';
  const windowId = Math.random().toString(36).slice(2, 10);
  let writerLost = false;

  function claimWriter() {
    if (ls) { try { ls.setItem(WRITER_KEY, windowId); } catch (_) { /* ignore */ } }
    writerLost = false;
    renderWriterBanner();
  }
  function renderWriterBanner() {
    if (!writerLost) { el.writerBanner.hidden = true; el.writerBanner.innerHTML = ''; return; }
    el.writerBanner.hidden = false;
    el.writerBanner.innerHTML = `<div class="ds-banner" role="status">${ic('triangle-alert', 'lg')}<div class="ds-banner__text"><span lang="es">Otra ventana activa: esta ventana ya no guarda la visita.</span><span class="ds-banner__en" lang="en">Another window is active: this window no longer saves the visit.</span></div><div class="probe-banner-actions">${btn('writer-take', 'Tomar el control', 'Take control', { variant: 'secondary' })}</div></div>`;
  }
  acts['writer-take'] = () => { store.storage = ls; store.persist(); claimWriter(); say('Esta ventana vuelve a guardar la visita', 'This window saves the visit again'); };

  /* ---- P7: surface takeover (page mode on <body>), the three surfaces and the trial dock */

  const hRowH = () => (window.matchMedia('(max-width: 799px)').matches ? 56 : 72);

  function hRowsHtml(spec) {
    const count = Math.max(spec.rows, Math.ceil((6 * window.innerHeight) / hRowH()));
    let out = '';
    for (let n = 1; n <= count; n++) {
      const num = String(n).padStart(3, '0');
      const cls = `probe-h-row${n % 5 === 0 ? ' probe-h-row--5' : ''}${n === spec.targetRow ? ' probe-h-row--target' : ''}`;
      const label = n % 20 === 0 ? `<span class="probe-h-band">═══ ${num} ═══</span>` : `<span class="probe-h-num">${num}</span>`;
      const extra = (n === 1 ? '<span class="probe-h-start">▲ START</span><span class="probe-h-cross">+</span>' : '')
        + (n === spec.targetRow ? '<span class="probe-h-ring"></span><span class="probe-h-mark">ESCRIBE AQUÍ / WRITE HERE ◀</span>' : '');
      out += `<div class="${cls}" data-n="${n}"><span class="probe-h-ruler">${num}</span>${label}${extra}</div>`;
    }
    return out;
  }

  // The surfaces draw nothing: no canvas, no ink handler. Any mark on screen is Overlay's (AC18).
  function hSurfaceHtml(spec) {
    const rows = hRowsHtml(spec);
    if (spec.id === 'S-doc') return `<div class="probe-h-surf probe-h-surf--doc" id="h-surf">${rows}</div>`;
    if (spec.id === 'S-box') return `<div class="probe-h-surf probe-h-surf--box" id="h-surf"><span class="probe-h-boxlabel">caja / box</span><div class="probe-h-box" id="h-box">${rows}</div></div>`;
    return `<div class="probe-h-surf probe-h-surf--xform" id="h-surf"><div class="probe-h-xview" id="h-xview"><div class="probe-h-xrows" id="h-xrows">${rows}</div></div>
      <div class="probe-h-xui" role="group" aria-label="Zoom">
        <button type="button" class="ds-iconbtn ds-iconbtn--board" data-act="h-xz" data-delta="-0.25" aria-label="Alejar / Zoom out">${ic('minus', 'xl')}</button>
        <span class="probe-h-xzoom" id="h-xzoom" role="status">100%</span>
        <button type="button" class="ds-iconbtn ds-iconbtn--board" data-act="h-xz" data-delta="0.25" aria-label="Acercar / Zoom in">${ic('plus', 'xl')}</button>
        ${btn('h-x150', 'Zoom 150 %', 'Zoom 150%', { variant: 'secondary', icon: 'zoom-in' })}
        ${btn('h-xreset', 'Restablecer', 'Reset view', { variant: 'secondary', icon: 'rotate-cw' })}
      </div></div>`;
  }

  function hXformApply() {
    const rows = document.getElementById('h-xrows');
    if (!rows) return;
    const v = hLive.xf;
    rows.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    setText('h-xzoom', Math.round(v.scale * 100) + '%');
  }
  function hXformScale(next) {
    const view = document.getElementById('h-xview');
    if (!view) return;
    const v = hLive.xf;
    const s = Math.min(4, Math.max(0.25, Number(next.toFixed(2))));
    const cx = view.clientWidth / 2;
    const cy = view.clientHeight / 2;
    const px = (cx - v.tx) / v.scale;
    const py = (cy - v.ty) / v.scale;
    v.scale = s; v.tx = cx - px * s; v.ty = cy - py * s;
    hXformApply();
  }
  acts['h-xz'] = (t) => hXformScale(hLive.xf.scale + Number(t.dataset.delta));
  acts['h-x150'] = () => hXformScale(1.5);
  acts['h-xreset'] = () => { hLive.xf = { scale: 1, tx: 0, ty: 0 }; hXformApply(); };

  const hTimerText = () => { const s = Math.floor((hLive.running ? Date.now() - hLive.t0 : hLive.elapsed) / 1000); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };

  function hLiveLine() {
    const snap = hLive.recorder ? hLive.recorder.snapshot() : { counts: {} };
    const vv = window.visualViewport;
    return hCountsLine(snap.counts, hLive.live.scroll, vv ? vv.scale.toFixed(2) : 'n/a');
  }

  function hSummaryHtml(snap) {
    const total = sumCounts(snap.counts);
    const e = snap.entries;
    const clock = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
    const sigs = Core.computeOverlaySignals(hLive.tapTimes, e);
    const kinds = Array.from(new Set(sigs.reduce((acc, s) => acc.concat(s.events.map((x) => x.kind)), [])));
    return `<div class="probe-h-sum">
        <p class="probe-mono">${esc(hCountsLine(snap.counts, hLive.live.scroll, `${hLive.live.vvMin.toFixed(2)}–${hLive.live.vvMax.toFixed(2)}`))}</p>
        <p class="probe-mono">${e.length ? `${clock(e[0].t)} → ${clock(e[e.length - 1].t)} · ` : ''}${e.length} ${biInline('entradas (pointermove muestreado)', 'entries (pointermove sampled)')}</p>
        <p>${hLive.tapTimes.length} × ${biInline('Overlay abierto ahora', 'Overlay is open now')} · ${biInline('señales', 'signals')}: ${kinds.length ? esc(kinds.join(', ')) : biInline('ninguna', 'none')}</p>
        ${snap.truncated ? `<p class="probe-h-warnline">2000/2000 — ${biInline('se descartan los siguientes', 'further entries dropped')}</p>` : ''}
        ${total === 0 ? `<p><strong>${biInline('0 también es dato', '0 is data too')}</strong></p>` : ''}
      </div>`;
  }

  function hDockHtml() {
    const d = hLive.draft;
    const tid = hLive.open;
    const m = H_TRIALS[tid];
    const locked = !d.overlayOn;
    const naOk = d.overlayOn || (d.notes || '').trim().length > 0;
    const radios = Core.H_VERDICTS[tid].map((v) => {
      const w = hWord(v);
      return radio('hv', v, d.verdict === v, v === 'n/a' ? !naOk : locked, w[0], w[1], `data-chg="h-verdict" data-fk="hv-${v}" aria-describedby="h-reason"`);
    }).join('');
    const running = hLive.running;
    return `<aside class="probe-h-dock" id="h-dock" role="region" aria-label="Panel del ensayo / Trial panel" data-side="${hLive.side}" data-sheet="${hLive.sheet}" data-running="${running}">
      <div class="probe-h-dock__head"><h2 class="probe-h-dock__title">${tid} · ${hLive.spec.id}<small>${esc(m.es)} / ${esc(m.en)}</small></h2>
        <button type="button" class="ds-iconbtn probe-h-sheetbtn" data-act="h-sheet" aria-label="Más controles / More controls" aria-expanded="${hLive.sheet === 'full'}">${ic('maximize', 'lg')}</button></div>
      <p class="probe-h-chip" id="h-zoomchip" hidden>${ic('triangle-alert', 'sm')}Zoom ≠ 1× — pellizca para volver / pinch back</p>
      <div class="probe-h-dock__core">
        ${check('hov', d.overlayOn, false, 'Overlay estaba ON', 'Overlay was ON', 'data-chg="h-overlay" data-fk="h-ov"')}
        ${running ? '' : btn('h-start', 'Empezar', 'Start', { icon: 'play' })}
        <span class="probe-h-timer" id="h-timer">${hTimerText()}</span>
        ${running ? btn('h-overlay-open', 'Overlay abierto ahora', 'Overlay is open now', { variant: 'secondary' }) + btn('h-stop', 'Parar', 'Stop', { variant: 'danger', icon: 'x' }) : ''}
      </div>
      <div class="probe-h-dock__more">
        <p class="probe-h-instr"><span lang="es">Escribe una marca corta con el lápiz de bandeja junto a la fila 08. Luego ${m.doEs}.</span><span class="en" lang="en">Write a short mark with the tray pen beside row 08. Then ${m.doEn}.</span></p>
        ${running ? `<p class="probe-h-count" id="h-counters" aria-live="off">${esc(hLiveLine())}</p>` : ''}
        ${hLive.summary ? hSummaryHtml(hLive.summary) : ''}
        ${hLive.recorderError ? `<p class="probe-h-warnline">${biInline('No se pudo grabar: el veredicto sigue permitido', 'Could not record: the verdict is still allowed')}</p>` : ''}
        <p class="probe-h-warnline"><span lang="es">Si Overlay bloquea los botones: recuerda lo que viste, ciérralo, y marca el veredicto después. Anota cómo se cierra en H5.</span><span class="en" lang="en">If Overlay blocks the buttons: remember what you saw, close it, then record the verdict. Note how it closes in H5.</span></p>
        <fieldset class="probe-h-verdict"><legend>${biInline('Veredicto', 'Verdict')}</legend><div class="probe-h-rads" role="radiogroup">${radios}</div>
          <p class="probe-h-reason" id="h-reason">${locked ? biInline('Marca «Overlay estaba ON» para elegir', 'Tick “Overlay was ON” to choose') : ''}</p></fieldset>
        <label class="ds-field"><span class="ds-field__label"><span lang="es">Notas</span><span class="en" lang="en">Notes</span></span><textarea class="ds-input" rows="2" data-chg="h-notes" data-fk="h-notes">${esc(d.notes)}</textarea></label>
        <p class="probe-h-err" id="h-err" role="alert">${hLive.err ? biInline(hLive.err[0], hLive.err[1]) : ''}${hLive.saved ? biInline('Guardado', 'Saved') : ''}</p>
        <div class="probe-h-dock__foot">${btn('h-save', 'Guardar', 'Save')}${btn('h-exit', 'Salir', 'Exit', { variant: 'secondary', icon: 'arrow-left' })}</div>
        <div class="probe-h-dock__foot">${btn('h-side', '⇄ Cambiar lado', 'Swap side', { variant: 'ghost' })}</div>
      </div>
      <p class="probe-h-sr" id="h-announce" role="status" aria-live="polite"></p>
    </aside>`;
  }

  function hRenderDock() {
    const dock = document.getElementById('h-dock');
    if (!dock) return;
    const a = document.activeElement;
    const inDock = a && dock.contains(a);
    const fk = inDock ? (a.dataset.fk ? `[data-fk="${a.dataset.fk}"]` : a.dataset.act ? `[data-act="${a.dataset.act}"]` : null) : null;
    const holder = document.createElement('div');
    holder.innerHTML = hDockHtml().trim();
    dock.replaceWith(holder.firstElementChild);
    hTrack();
    if (fk) { const n = document.querySelector('#h-dock ' + fk); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  }

  const hAnnounce = (text) => setText('h-announce', text);

  // AC18: the dock follows the visual viewport when it is zoomed; the chip is the visible fallback.
  function hTrack() {
    const dock = document.getElementById('h-dock');
    if (!dock) return;
    const vv = window.visualViewport;
    const p = Core.dockPlacement(vv ? { scale: vv.scale, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, width: vv.width, height: vv.height } : { scale: 1 });
    const chip = document.getElementById('h-zoomchip');
    if (chip) chip.hidden = !p.showZoomBadge;
    if (p.mode === 'fixed') { delete dock.dataset.track; return; }
    const root = document.documentElement;
    const wide = window.matchMedia('(min-width: 1280px)').matches;
    const tx = wide ? (hLive.side === 'left' ? p.offsetLeft : p.offsetLeft + p.width - root.clientWidth) : p.offsetLeft;
    const ty = wide ? p.offsetTop : p.offsetTop + p.height - root.clientHeight;
    dock.style.setProperty('--probe-h-tx', tx + 'px');
    dock.style.setProperty('--probe-h-ty', ty + 'px');
    dock.style.setProperty('--probe-h-ts', String(1 / p.scale));
    dock.dataset.track = '1';
  }

  function hBindSurface() {
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); hLive.offs.push(() => t.removeEventListener(type, fn, o)); };
    if (window.visualViewport) { on(window.visualViewport, 'resize', hTrack); on(window.visualViewport, 'scroll', hTrack); }
    const view = document.getElementById('h-xview');
    if (view) {
      let last = null;
      on(view, 'pointerdown', (e) => { view.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY }; });
      on(view, 'pointermove', (e) => {
        if (!last) return;
        hLive.xf.tx += e.clientX - last.x;
        hLive.xf.ty += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        hXformApply();
      });
      on(view, 'pointerup', () => { last = null; });
      on(view, 'pointercancel', () => { last = null; });
      on(view, 'wheel', (e) => { e.preventDefault(); hXformScale(hLive.xf.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
    }
  }

  function hOpen(tid) {
    stopAllActivity();
    const spec = Core.surfaceSpec(Core.SURFACE_FOR_TRIAL[tid]);
    const t = hTrial(tid);
    Object.assign(hLive, {
      open: tid, spec, draft: { overlayOn: t.overlayOn === true, verdict: t.verdict, notes: t.notes || '' }, recorder: null, recorderError: false,
      running: false, elapsed: 0, err: null, saved: false, still: false, summary: null, live: { scroll: 0, vvMin: 1, vvMax: 1 },
      lastTop: {}, tapTimes: [], recOffs: [], offs: [], paneScroll: el.pane.scrollTop, xf: { scale: 1, tx: 0, ty: 0 }
    });
    hLive.sheet = window.matchMedia('(min-width: 1280px)').matches ? 'full' : 'peek';
    document.body.dataset.surface = spec.id;
    document.documentElement.dataset.surface = spec.id;
    el.surface.dataset.side = hLive.side;
    el.surface.hidden = false;
    el.surface.innerHTML = hSurfaceHtml(spec) + hDockHtml();
    window.scrollTo(0, 0);
    hBindSurface();
    hTrack();
    say(`${tid}: ensayo abierto (${spec.id})`, `${tid}: trial opened (${spec.id})`);
  }

  function hDetach() { hLive.recOffs.forEach((f) => f()); hLive.recOffs = []; }

  // AC14: timestamped timeline with no operator effort. Events inside the dock are ignored, so "no events between Start and
  // Stop" (recalled) means Overlay really took the finger events away from the content.
  function hAttach() {
    const rec = Core.createTrialRecorder({ cap: 2000 });
    hLive.recorder = rec;
    hLive.live = { scroll: 0, vvMin: 1, vvMax: 1 };
    hLive.lastTop = {};
    hLive.tapTimes = [];
    hLive.recOffs = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); hLive.recOffs.push(() => t.removeEventListener(type, fn, o)); };
    const add = (evt) => { evt.t = Date.now(); rec.add(evt); };
    const inDock = (e) => { const d = document.getElementById('h-dock'); return Boolean(d && e.target && d.contains(e.target)); };
    on(window, 'blur', () => add({ kind: 'blur' }));
    on(window, 'focus', () => add({ kind: 'focus' }));
    on(document, 'visibilitychange', () => add({ kind: 'visibilitychange', state: document.visibilityState }));
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => on(document, type, (e) => {
      if (inDock(e)) return;
      add({ kind: type, pointerType: e.pointerType || 'unknown', pointerId: e.pointerId, x: Math.round(e.clientX), y: Math.round(e.clientY) });
    }, { capture: true, passive: true }));
    on(document, 'scroll', (e) => {
      const t = e.target;
      let target = null;
      let top = 0;
      if (t === document) { target = 'S-doc'; top = Math.round(document.scrollingElement.scrollTop); }
      else if (t && t.id === 'h-box') { target = 'S-box'; top = Math.round(t.scrollTop); }
      if (!target) return;
      hLive.live.scroll += Math.abs(top - (hLive.lastTop[target] || 0));
      hLive.lastTop[target] = top;
      add({ kind: 'scroll', target, scrollTop: top });
    }, { capture: true, passive: true });
    const vv = window.visualViewport;
    if (vv) {
      let lastVv = 0;
      const onVv = () => {
        hLive.live.vvMin = Math.min(hLive.live.vvMin, vv.scale);
        hLive.live.vvMax = Math.max(hLive.live.vvMax, vv.scale);
        const now = Date.now();
        if (now - lastVv < 50) return;
        lastVv = now;
        add({ kind: 'vv', scale: Number(vv.scale.toFixed(3)), offsetLeft: Math.round(vv.offsetLeft), offsetTop: Math.round(vv.offsetTop), width: Math.round(vv.width), height: Math.round(vv.height) });
      };
      on(vv, 'resize', onVv);
      on(vv, 'scroll', onVv);
    }
  }

  function hTick() {
    setText('h-timer', hTimerText());
    setText('h-counters', hLiveLine());
    if (!hLive.still && Date.now() - hLive.t0 >= 90000) { hLive.still = true; hAnnounce('Sigue grabando / Still recording'); }
  }

  acts['h-start'] = () => {
    if (hLive.running) return;
    hLive.recorderError = false;
    try { hAttach(); } catch (e) {
      hDetach();
      hLive.recorder = null;
      hLive.recorderError = true;
      say(`${hLive.open}: no se pudo grabar`, `${hLive.open}: could not record`, 'warn');
    }
    hLive.running = true;
    hLive.t0 = Date.now();
    hLive.summary = null;
    hLive.saved = false;
    hLive.timerId = setInterval(hTick, 250);
    say(`${hLive.open}: grabación iniciada`, `${hLive.open}: recording started`);
    hRenderDock();
    hAnnounce('Grabando / Recording');
  };

  function hStop() {
    if (!hLive.running) return;
    hLive.running = false;
    clearInterval(hLive.timerId);
    hLive.elapsed = Date.now() - hLive.t0;
    hDetach();
    hLive.summary = hLive.recorder ? hLive.recorder.snapshot() : null;
    hLive.sheet = 'full';
    say(`${hLive.open}: grabación detenida`, `${hLive.open}: recording stopped`);
    hRenderDock();
    hAnnounce('Detenido / Stopped');
  }
  acts['h-stop'] = hStop;

  acts['h-overlay-open'] = () => {
    if (!hLive.running) return;
    const t = Date.now();
    store.addOverlayTap(t);
    hLive.tapTimes.push(t);
    say(`${hLive.open}: Overlay abierto ahora (${hLive.tapTimes.length})`, `${hLive.open}: Overlay is open now (${hLive.tapTimes.length})`);
    hAnnounce(`Overlay abierto ahora: ${hLive.tapTimes.length}`);
  };
  acts['h-overlay'] = (t) => { hLive.draft.overlayOn = t.checked; hLive.err = null; hLive.saved = false; hRenderDock(); };
  acts['h-verdict'] = (t) => { hLive.draft.verdict = t.value; hLive.err = null; hLive.saved = false; };
  acts['h-notes'] = (t) => {
    hLive.draft.notes = t.value;
    const na = document.querySelector('#h-dock input[value="n/a"]');
    if (na) na.disabled = !(hLive.draft.overlayOn || t.value.trim());
  };
  acts['h-side'] = () => { hLive.side = hLive.side === 'right' ? 'left' : 'right'; el.surface.dataset.side = hLive.side; hRenderDock(); };
  acts['h-sheet'] = () => { hLive.sheet = hLive.sheet === 'full' ? 'peek' : 'full'; hRenderDock(); };

  acts['h-save'] = () => {
    const d = hLive.draft;
    const tid = hLive.open;
    const check = Core.validateTrialVerdict(tid, d.verdict, { overlayOn: d.overlayOn, notes: d.notes });
    if (!check.ok) {
      hLive.err = check.error === 'na-needs-reason' ? ['n/a necesita un motivo en las notas', 'n/a needs a reason in the notes'] : check.error === 'bad-verdict' ? ['Elige un veredicto', 'Choose a verdict'] : ['Marca «Overlay estaba ON» para elegir', 'Tick “Overlay was ON” to choose'];
      hRenderDock();
      return;
    }
    if (hLive.running) hStop();
    const fin = Core.finalizeTrial(tid, { verdict: d.verdict, overlayOn: d.overlayOn, notes: d.notes }, hLive.recorder);
    if (hLive.recorderError) fin.timeline = null;
    fin.counts = hLive.recorder ? hLive.recorder.snapshot().counts : {};
    store.setHTrial(tid, fin);
    const w = hWord(d.verdict);
    say(`${tid}: veredicto ${w[0]}${fin.recalled ? ' (de memoria)' : ''}`, `${tid}: verdict ${w[1]}${fin.recalled ? ' (recalled)' : ''}`);
    hLive.err = null;
    hLive.saved = true;
    hRenderDock();
    hAnnounce('Guardado / Saved');
    refresh();
  };

  function hClose() {
    if (!hLive.open) return;
    if (hLive.running) { hLive.running = false; clearInterval(hLive.timerId); hDetach(); }
    hLive.offs.forEach((f) => f());
    hLive.offs = [];
    hLive.open = null;
    delete document.body.dataset.surface;
    delete document.documentElement.dataset.surface;
    el.surface.hidden = true;
    el.surface.innerHTML = '';
    window.scrollTo(0, 0);
    selectScenario('H');
    el.pane.scrollTop = hLive.paneScroll;
    refresh();
  }
  acts['h-exit'] = hClose;

  /* ------------------------------------------------------------------ G2: send results (spec v0.4 AC19–AC24, AC27, AC28; UX §17) */

  const sLive = {
    sharing: false, relay: null, relayTimer: 0, pendingPayload: null, mailHint: false, mailSeen: false, mailError: '', status: null,
    sumOpen: false, settingsOpen: false, notOfferedOpen: false, testDismissed: false, setErr: '', editTo: false
  };
  const HANDED = ['shared', 'opened', 'sent'];

  // salida n/2: (1) exported to Downloads, (2) handed off or sent at least once. Informational only.
  function outCount() {
    const g = sc('G').payload;
    const exported = g && Array.isArray(g.exports) && g.exports.length > 0 ? 1 : 0;
    return exported + (store.state.delivery.some((d) => HANDED.includes(d.outcome)) ? 1 : 0);
  }

  const detectFile = () => { try { return new File(['probe'], 'probe.json.txt', { type: 'text/plain' }); } catch (_) { return null; } };
  const currentChannels = () => Core.offeredChannels({ nav: navigator, file: detectFile(), settings: settings.load() });

  function sendContext() {
    const x = store.exportPayload();
    return { x, json: safeJson(x, 2), summary: Core.buildSummary(x), date: String(x.finishedAt).slice(0, 10) };
  }
  const subjectOf = (c) => `Probe ${c.x.hostClassification} ${c.date} complete=${c.x.evidence.complete}`;
  const renderSendIfActive = () => { if (activeId === 'G' && !hLive.open) renderPane(true); };

  function openSend() {
    selectScenario('G');
    const h = document.getElementById('send-title');
    if (h) { h.scrollIntoView({ block: 'start' }); h.focus({ preventScroll: true }); }
  }
  el.send.addEventListener('click', openSend);

  const OUT_ICON = { ok: 'circle-check', warn: 'info', neutral: 'minus', err: 'circle-alert' };
  const outcomeClass = (o) => (o === 'shared' || o === 'sent' ? 'ok' : o === 'opened' ? 'warn' : o === 'cancelled' ? 'neutral' : 'err');

  function outcomeLine(channel) {
    if (channel === 'share' && sLive.sharing) return `<div class="probe-s-ch__out probe-s-ch__out--run">${ic('clock', 'sm')}${biInline('esperando a la app…', 'waiting for the app…')}</div>`;
    if (channel === 'relay' && sLive.relay) return `<div class="probe-s-ch__out probe-s-ch__out--run">${ic('clock', 'sm')}${biInline('enviando…', 'sending…')} <span class="probe-mono" id="s-relay-count" aria-live="off">0/15 s</span>${btn('s-relay-cancel', 'Cancelar', 'Cancel', { variant: 'secondary', icon: 'x' })}</div>`;
    const last = store.state.delivery.slice().reverse().find((d) => d.channel === channel);
    if (!last) return `<div class="probe-s-ch__out probe-s-ch__out--neutral">${ic('circle', 'sm')}${biInline('sin enviar', 'not sent')}</div>`;
    const cls = outcomeClass(last.outcome);
    const w = Core.outcomeWord(channel, last.outcome);
    const hint = channel === 'mailto' && sLive.mailHint && last.outcome === 'opened'
      ? `<span class="probe-s-ch__hint">${biInline('¿No se abrió nada? Puede que esta pizarra no tenga correo. Prueba Compartir o Copiar resumen.', 'Nothing opened? This board may have no mail app. Try Share or Copy summary.')}</span>` : '';
    const next = channel === 'relay' && cls === 'err' ? `<span class="probe-s-ch__hint">${biInline('Usa Compartir, Correo o Copiar JSON.', 'Use Share, Email or Copy JSON.')}</span>` : '';
    const after = channel === 'relay' && last.outcome === 'sent' ? `<span class="probe-s-ch__hint">${biInline('Borra el código de este dispositivo al terminar.', 'Remove the code from this device when done.')}</span>` : '';
    return `<div class="probe-s-ch__out probe-s-ch__out--${cls}"${channel === 'relay' && cls === 'err' ? ' role="alert"' : ''}>${ic(OUT_ICON[cls], 'sm')}<span lang="es">${esc(w.es)}</span> <span class="en" lang="en">/ ${esc(w.en)}</span> <span class="probe-mono">${hhmm(last.at)}</span>${hint}${next}${after}</div>`;
  }

  function chanRow(n, key, noteHtml, controlsHtml) {
    return `<li class="probe-s-ch"><span class="probe-s-ch__n" aria-hidden="true">${n}</span>
      <div><div class="probe-s-ch__name">${bi(BILINGUAL.channels[key].es, BILINGUAL.channels[key].en)}</div>${noteHtml}</div>
      <div class="probe-s-ch__btn">${controlsHtml}</div>${outcomeLine(key)}</li>`;
  }

  function foldHtml(key, open, titleEs, titleEn, stat, bodyHtml) {
    return `<div class="probe-s__fold"><button type="button" class="probe-s__foldhead" data-act="s-fold" data-key="${key}" aria-expanded="${open}">${ic(open ? 'chevron-down' : 'chevron-right', 'md')}${biInline(titleEs, titleEn)}<span class="stat">${stat}</span></button>${open ? `<div class="probe-s__foldbody">${bodyHtml}</div>` : ''}</div>`;
  }

  function settingsBodyHtml(st) {
    let host = '';
    try { host = st.relayUrl ? new URL(st.relayUrl).host : ''; } catch (_) { host = ''; }
    return `<div class="probe-s__masked">${biInline('Destinatario', 'Recipient')}: ${st.recipient ? `<span class="probe-mono">${esc(st.recipient)}</span>${btn('s-edit-to', 'Cambiar', 'Change', { variant: 'ghost' })}` : biInline('sin guardar (campo en «Correo con resumen»)', 'not saved (field under “Email summary”)')}</div>
      <div class="probe-s__set">${field(['Servidor del relay', 'Relay host'], host ? `${host} · guardado / saved` : '', '<input class="ds-input" type="url" id="s-set-url" inputmode="url" placeholder="https://relay.example.com/…" autocomplete="off" autocapitalize="off" spellcheck="false">')}</div>
      <div class="probe-s__set">${field(['Código de visita', 'Visit code'], st.visitCode ? `${Core.maskCode(st.visitCode)} · guardado / saved` : '', '<input class="ds-input" type="password" id="s-set-code" autocomplete="off" autocapitalize="off" spellcheck="false">')}
        <button type="button" class="ds-btn ds-btn--secondary probe-s__eyebtn" data-act="s-show-code" aria-pressed="false">${ic('eye', 'md')}${biInline('Mostrar', 'Show')}</button></div>
      ${sLive.setErr ? `<p class="probe-s__err" role="alert">${esc(sLive.setErr)}</p>` : ''}
      <div class="probe-row">${btn('s-save-relay', 'Guardar servidor y código', 'Save host and code', { variant: 'secondary', icon: 'save' })}</div>
      <div class="probe-s__forget">${btn('s-forget', 'Olvidar ajustes de envío', 'Forget send settings', { variant: 'secondary', icon: 'trash-2' })}<span class="note">${biInline('Se borran de este dispositivo.', 'Removed from this device.')}</span></div>`;
  }

  function sendHtml() {
    const st = settings.load();
    const channels = currentChannels();
    const ctx = sendContext();
    const rs = store.runState();
    const RS = { empty: ['VACÍO', 'EMPTY'], partial: ['PARCIAL', 'PARTIAL'], finished: ['COMPLETO', 'FINISHED'] }[rs];
    const stats = Core.notesStats(ctx.x);
    const out = outCount();
    const exported = out > 0 && sc('G').payload && sc('G').payload.exports && sc('G').payload.exports.length > 0;
    const noneTerminal = Object.keys(store.state.scenarios).every((id) => !isTerminalStatus(sc(id).status));
    const chars = ctx.summary.length;

    const shareRow = channels.includes('share')
      ? chanRow(1, 'share', `<p class="probe-s-ch__note"><span lang="es">JSON completo como <span class="probe-mono">${esc(Core.exportFilename(new Date(), 'json') + '.txt')}</span> → Gmail, Drive, Bluetooth… Quítale «.txt» al guardarlo.</span><span class="en" lang="en">Full JSON as .json.txt (plain text). Drop “.txt” when saving.</span></p>`, btn('s-share', 'Compartir archivo', 'Share file', { icon: 'upload', disabled: sLive.sharing }))
      : '';
    const mailControls = st.recipient && !sLive.editTo
      ? `<div class="probe-s-ch__saved">${biInline('Para', 'To')}: <span class="probe-mono">${esc(st.recipient)}</span> · ${biInline('guardado en este dispositivo', 'saved on this device')} ${btn('s-edit-to', 'Cambiar', 'Change', { variant: 'ghost' })}</div>`
      : `<div class="probe-s-ch__fields">${field(['Para', 'To'], '', `<input class="ds-input" type="email" id="s-to" inputmode="email" autocapitalize="off" autocomplete="email" spellcheck="false" placeholder="you@example.com" value="${esc(st.recipient)}"${sLive.mailError ? ' aria-invalid="true" aria-describedby="s-mail-err"' : ''}>`)}${btn('s-save-to', 'Guardar', 'Save', { variant: 'secondary' })}</div>`;
    const mailRow = chanRow(2, 'mailto', `<p class="probe-s-ch__note"><span lang="es">Sin adjunto: solo el resumen. El JSON completo queda en Descargas.</span><span class="en" lang="en">No attachment: summary only. The full JSON stays in Downloads.</span></p>${mailControls}${sLive.mailError ? `<p class="probe-s__err" id="s-mail-err" role="alert">${esc(sLive.mailError)}</p>` : ''}`, btn('s-mail', 'Abrir correo', 'Open mail', { icon: 'link' }));
    let relayHost = '';
    try { relayHost = st.relayUrl ? new URL(st.relayUrl).host : ''; } catch (_) { relayHost = ''; }
    const relayRow = channels.includes('relay')
      ? chanRow(3, 'relay', `<p class="probe-s-ch__note"><span lang="es">Servidor: <span class="probe-mono">${esc(relayHost)}</span> · código guardado ${Core.maskCode(st.visitCode)}. Reenvía a tu correo; pide confirmar antes.</span><span class="en" lang="en">Forwards to your email. Asks you to confirm first.</span></p>`, btn('s-relay', 'Enviar al relay', 'Send to relay', { icon: 'upload', disabled: Boolean(sLive.relay) }))
      : '';

    const notOffered = [];
    if (!channels.includes('share')) notOffered.push(biInline('Compartir archivo', 'Share file'));
    if (!channels.includes('relay')) notOffered.push(biInline('Relay (sin configurar)', 'Relay (not configured)'));
    const deliveries = store.state.delivery.map((d, i) => {
      const w = Core.outcomeWord(d.channel, d.outcome);
      const cls = outcomeClass(d.outcome);
      return `<li class="probe-s__dl-row"><time datetime="${esc(d.at)}">${hhmm(d.at)}</time><span>${bi(BILINGUAL.channels[d.channel].es, BILINGUAL.channels[d.channel].en)}</span><span>${ic(OUT_ICON[cls], 'sm')}${biInline(esc(w.es), esc(w.en))}</span>${check('arr' + i, d.confirmed === true, false, 'Llegó a mi bandeja', 'Arrived in my inbox', `data-chg="s-arrived" data-i="${i}"`)}</li>`;
    }).join('');

    return `<h3 class="probe-s__title" id="send-title" tabindex="-1">② ${biInline('Enviar resultados', 'Send results')} <span class="ds-chip probe-chip">${biInline('salida', 'out')} <strong class="probe-count">${out}/2</strong></span></h3>
      <div class="probe-s">
        <div class="probe-s__runline"><span lang="es">Se envía el estado actual: <b>${RS[0]}</b> · A–E ${REQUIRED.filter(reqDone).length}/5 · evidence.complete: ${ctx.x.evidence.complete ? 'sí' : 'no'}</span><span class="en" lang="en">This sends the current state: <b>${RS[1]}</b> · A–E ${REQUIRED.filter(reqDone).length}/5 · evidence.complete: ${ctx.x.evidence.complete ? 'yes' : 'no'}</span></div>
        ${noneTerminal && !sLive.testDismissed ? `<div class="probe-s__test"><div class="txt"><span lang="es">¿Sin tarjeta? Prueba el envío ahora (30 s): enviará un resumen vacío.</span><span class="en" lang="en">No flash card? Test the send path now (30 s): it sends an empty summary.</span></div>${btn('s-test', 'Probar envío', 'Test send', { icon: 'upload' })}${btn('s-test-dismiss', 'Ocultar', 'Dismiss', { variant: 'ghost' })}</div>` : ''}
        ${!exported ? `<div class="probe-s__hint"><div class="txt"><span lang="es">Aún no exportaste: Descargas es tu copia de seguridad.</span><span class="en" lang="en">You have not exported yet: Downloads is your backup.</span></div>${btn('g-export', 'Exportar primero', 'Export first', { variant: 'secondary', icon: 'download' })}</div>` : ''}
        <ul class="probe-s__chans" role="list">${shareRow}${mailRow}${relayRow}</ul>
        <div class="probe-s__warn"><span lang="es">Las notas se envían tal cual. No escribas nombres de alumnos.</span><span class="en" lang="en">Notes are sent as typed. No student names.</span><span class="probe-mono">(${stats.count} · ${stats.chars})</span></div>
        <div class="probe-s__sumhead"><h4 class="probe-s__lbl">${biInline('Resumen', 'Summary')}</h4><span class="probe-s__count${chars > 1500 ? ' probe-s__count--over' : ''}">${chars} / 1500</span>
          <span class="grow"></span>${btn('s-copy-short', 'Copiar corto', 'Copy short', { variant: 'secondary', icon: 'clipboard-list' })}${btn('s-sum-toggle', sLive.sumOpen ? 'Contraer' : 'Expandir', sLive.sumOpen ? 'Collapse' : 'Expand', { variant: 'ghost' })}${btn('s-big', 'Ver grande', 'Show large', { variant: 'ghost', icon: 'maximize' })}</div>
        <pre class="probe-s__pre${sLive.sumOpen ? ' probe-s__pre--full' : ''}" tabindex="0">${esc(ctx.summary)}</pre>
        ${chars > 1500 ? `<p class="probe-note">${biInline('…truncado; JSON completo en Descargas', '…truncated; full JSON in Downloads')}</p>` : ''}
        <div role="status" class="probe-s__status">${sLive.status ? biInline(esc(sLive.status.es), esc(sLive.status.en)) : ''}</div>
        <h4 class="probe-s__lbl">${biInline('Siempre disponible', 'Always available')}</h4>
        <div class="probe-s__fallbacks">${btn('g-export', 'Exportar JSON', 'Export JSON', { icon: 'download' })}${btn('g-copy-json', 'Copiar JSON', 'Copy JSON', { variant: 'secondary', icon: 'clipboard-list' })}${btn('s-copy-short', 'Copiar registro corto', 'Copy short log', { variant: 'secondary', icon: 'clipboard-list' })}${btn('g-copy-log', 'Copiar registro', 'Copy log', { variant: 'secondary', icon: 'clipboard-list' })}</div>
        <h4 class="probe-s__lbl">${biInline('Envíos', 'Sends')}</h4>
        ${deliveries ? `<ul class="probe-s__dl" role="list">${deliveries}</ul>` : `<p class="probe-s__dl-empty">${biInline('sin envíos todavía', 'no sends yet')}</p>`}
        ${foldHtml('settingsOpen', sLive.settingsOpen, 'Ajustes de envío', 'Send settings', `${biInline('destinatario', 'recipient')} ${st.recipient ? '✓' : '✗'} · relay ${st.relayUrl && st.visitCode ? '✓' : '✗'}`, settingsBodyHtml(st))}
        ${foldHtml('notOfferedOpen', sLive.notOfferedOpen, 'Canales no disponibles aquí', 'Channels not offered here', '', notOffered.length ? notOffered.map((x) => `<p>${x}</p>`).join('') : `<p>${biInline('ninguno', 'none')}</p>`)}
      </div>`;
  }

  // polite outcome text: shown once, then cleared (the row keeps the outcome line)
  function flashStatus(w) {
    sLive.status = w;
    setTimeout(() => { sLive.status = null; const n = document.querySelector('.probe-s__status'); if (n) n.textContent = ''; }, 6000);
  }

  // one result per attempt: stored in delivery[], logged (never the code, never the URL path), shown on the row
  function sendResult(channel, outcome) {
    store.addDelivery({ channel, outcome });
    const w = Core.outcomeWord(channel, outcome);
    const ch = BILINGUAL.channels[channel];
    if (outcome !== 'cancelled') say(`${ch.es}: ${w.es}`, `${ch.en}: ${w.en}`, /^(error|failed)/.test(outcome) ? 'warn' : 'info');
    flashStatus(w);
    refresh();
    renderSendIfActive();
  }

  acts['s-fold'] = (t) => { sLive[t.dataset.key] = !sLive[t.dataset.key]; renderPane(true); };
  acts['s-sum-toggle'] = () => { sLive.sumOpen = !sLive.sumOpen; renderPane(true); };
  acts['s-edit-to'] = () => { sLive.editTo = true; sLive.mailError = ''; renderPane(true); const f = document.getElementById('s-to'); if (f) f.focus(); };
  acts['s-test-dismiss'] = () => { sLive.testDismissed = true; renderPane(true); };
  acts['s-show-code'] = (t) => {
    const input = document.getElementById('s-set-code');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.setAttribute('aria-pressed', String(show));
  };

  acts['s-save-to'] = () => {
    const f = document.getElementById('s-to');
    const v = f ? f.value.trim() : '';
    try { settings.save({ recipient: v }); sLive.mailError = ''; sLive.editTo = false; say('Destinatario guardado en este dispositivo', 'Recipient saved on this device'); }
    catch (e) { sLive.mailError = 'Escribe una dirección válida / Write a valid address'; }
    renderPane(true);
    const b = el.pane.querySelector('[data-act="s-mail"]');
    if (b && !sLive.mailError) b.focus();
  };

  acts['s-save-relay'] = () => {
    const url = (document.getElementById('s-set-url').value || '').trim();
    const code = (document.getElementById('s-set-code').value || '').trim();
    const patch = {};
    if (url) patch.relayUrl = url;
    if (code) patch.visitCode = code;
    if (!Object.keys(patch).length) { sLive.setErr = 'Escribe el servidor y el código / Type the host and the code'; renderPane(true); return; }
    try { settings.save(patch); sLive.setErr = ''; say('Ajustes de envío guardados (servidor y código)', 'Send settings saved (host and code)'); }
    catch (e) { sLive.setErr = 'No se pudo guardar / Could not save: ' + e.message; }
    refresh();
    renderPane(true);
  };

  acts['s-forget'] = () => {
    const body = `<p>${biInline('Se borran de este dispositivo: destinatario, servidor y código.', 'Removed from this device: recipient, host and code.')}</p>`;
    const foot = `${btn('modal-close', 'Cancelar', 'Cancel', { variant: 'ghost' })}${btn('s-forget-confirm', 'Olvidar', 'Forget', { variant: 'danger' })}`;
    openModal(dialogShell('Olvidar ajustes de envío', 'Forget send settings', body, foot), { focus: '[data-act="modal-close"].ds-btn' });
  };
  acts['s-forget-confirm'] = () => {
    closeModal(true);
    settings.forget();
    sLive.setErr = ''; sLive.editTo = false; sLive.mailError = '';
    say('Ajustes de envío olvidados', 'Send settings forgotten');
    refresh();
    renderSendIfActive();
  };

  acts['s-share'] = async () => {
    if (sLive.sharing) return;
    const c = sendContext();
    const f = Core.buildShareFile(c.json, new Date());
    let file = null;
    try { file = new File([f.content], f.name, { type: f.type }); } catch (_) { file = null; }
    if (!file || !navigator.canShare || !navigator.canShare({ files: [file] })) { sendResult('share', 'error: NotSupportedError'); return; }
    sLive.sharing = true;
    renderSendIfActive();
    const outcome = await Core.runShare(navigator, { file, text: c.summary, title: subjectOf(c) });
    sLive.sharing = false;
    sendResult('share', outcome);
  };

  acts['s-mail'] = () => {
    const field = document.getElementById('s-to');
    const to = field ? field.value.trim() : settings.load().recipient;
    const c = sendContext();
    const m = Core.buildMailto({ to, summary: c.summary, classification: c.x.hostClassification, date: c.date, complete: c.x.evidence.complete });
    if (m.error) {
      sLive.mailError = 'Escribe una dirección válida / Write a valid address';
      renderPane(true);
      const f = document.getElementById('s-to');
      if (f) f.focus();
      return;
    }
    if (to !== settings.load().recipient) { try { settings.save({ recipient: to }); } catch (_) { /* send anyway */ } }
    sLive.mailError = ''; sLive.editTo = false; sLive.mailHint = false; sLive.mailSeen = false;
    const a = document.createElement('a');
    a.href = m.url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    sendResult('mailto', 'opened');
    setTimeout(() => { if (!sLive.mailSeen) { sLive.mailHint = true; renderSendIfActive(); } }, 2200);
  };

  acts['s-relay'] = () => {
    const st = settings.load();
    if (!st.relayUrl || !st.visitCode) return;
    const c = sendContext();
    const payload = Core.compactRelayPayload(c.x);
    let d;
    try { d = Core.describeRelayConfirm({ relayUrl: st.relayUrl, visitCode: st.visitCode, payload }); }
    catch (_) { say('No se pudo preparar el envío al relay', 'Could not prepare the relay send', 'warn'); return; }
    sLive.pendingPayload = payload;
    const prev = store.state.delivery.filter((x) => x.channel === 'relay' && x.outcome === 'sent').pop();
    const kb = (d.bytes / 1024).toFixed(1);
    const stats = Core.notesStats(c.x);
    const body = `<dl class="probe-s__kv"><dt>${biInline('Servidor', 'Host')}</dt><dd>${esc(d.host)}</dd><dt>${biInline('Tamaño', 'Size')}</dt><dd>${kb} KB · ${biInline('compacto: sin cronologías', 'compact: no timelines')}</dd>
        <dt>${biInline('Contiene', 'Contains')}</dt><dd>${biInline(`huella, estados A–H, veredictos, notas (${stats.count})`, `fingerprint, A–H statuses, verdicts, notes (${stats.count})`)}</dd></dl>
      <p id="p9-contents">${biInline('Las notas van tal cual. No escribas nombres de alumnos.', 'Notes go as typed. No student names.')}</p>
      <details class="probe-s__details"><summary>${biInline('Ver contenido', 'View payload')}</summary><pre class="probe-dump" tabindex="0">${esc(d.preview)}</pre></details>
      ${prev ? `<p>${biInline(`Ya enviado a las ${hhmm(prev.at)}`, `Already sent at ${hhmm(prev.at)}`)}</p>` : ''}`;
    const foot = `${btn('modal-close', 'Cancelar', 'Cancel', { variant: 'ghost' })}${btn('s-relay-confirm', `Enviar · ${kb} KB`, `Send · ${kb} KB`)}`;
    openModal(dialogShell('¿Enviar al relay?', 'Send to relay?', body, foot), { focus: '[data-act="modal-close"].ds-btn' });
    const dlg = el.modal.querySelector('.ds-dialog');
    if (dlg) dlg.setAttribute('aria-describedby', 'p9-contents');
  };

  acts['s-relay-confirm'] = async () => {
    closeModal(true);
    const st = settings.load();
    const payload = sLive.pendingPayload;
    sLive.pendingPayload = null;
    if (!st.relayUrl || !st.visitCode || !payload) return;
    const ctrl = new AbortController();
    sLive.relay = { ctrl, t0: Date.now() };
    sLive.relayTimer = setInterval(() => setText('s-relay-count', `${Math.min(15, Math.floor((Date.now() - sLive.relay.t0) / 1000))}/15 s`), 500);
    renderSendIfActive();
    const outcome = await Core.sendRelay({ fetchImpl: (u, i) => fetch(u, i), relayUrl: st.relayUrl, visitCode: st.visitCode, payload, signal: ctrl.signal });
    clearInterval(sLive.relayTimer);
    sLive.relay = null;
    sendResult('relay', outcome);
  };
  acts['s-relay-cancel'] = () => { if (sLive.relay) sLive.relay.ctrl.abort(); };

  // channel-free test: the first channel that needs no typing, else the mail field
  acts['s-test'] = () => {
    const chans = currentChannels();
    if (chans.includes('share')) { acts['s-share'](); return; }
    if (chans.includes('relay')) { acts['s-relay'](); return; }
    if (settings.load().recipient) { acts['s-mail'](); return; }
    sLive.mailError = 'Escribe una dirección para la prueba / Type an address for the test';
    renderPane(true);
    const f = document.getElementById('s-to');
    if (f) f.focus();
  };

  acts['s-arrived'] = (t) => { store.confirmDelivery(Number(t.dataset.i), t.checked); say(t.checked ? 'Envío marcado como llegado' : 'Marca de llegada quitada', t.checked ? 'Send marked as arrived' : 'Arrived tick removed'); };

  acts['s-copy-short'] = async () => {
    const ok = await copyText(Core.buildSummary(store.exportPayload()));
    flashStatus(ok ? { es: 'copiado', en: 'copied' } : { es: 'No se pudo copiar: selecciona el texto del resumen', en: 'Could not copy: select the summary text' });
    if (!ok) sLive.sumOpen = true;
    say(ok ? 'Resumen copiado' : 'No se pudo copiar el resumen', ok ? 'Summary copied' : 'Could not copy the summary', ok ? 'info' : 'warn');
    renderSendIfActive();
  };

  // P10: summary in large type for photographing the glass. A fallback, not a channel: no outcome is recorded.
  acts['s-big'] = () => {
    const body = `<pre class="probe-s__big" tabindex="0">${esc(Core.buildSummary(store.exportPayload()))}</pre>`;
    const foot = btn('modal-close', 'Cerrar', 'Close', { variant: 'secondary' });
    openModal(dialogShell('Resumen', 'Summary', body, foot), { sheet: true, focus: '[data-act="modal-close"].ds-btn' });
  };

  /* ---- send settings imported from a private link's #fragment (OQ12): saves, cleans the address bar, sends nothing */

  let importedHost = null;

  function importSendSettings() {
    const imp = Core.importFragment(window.location.hash, window.location.href);
    if (!imp) return;
    try { window.history.replaceState(null, '', imp.cleanedUrl); } catch (_) { /* ignore */ }
    try {
      settings.save({ relayUrl: imp.relayUrl, visitCode: imp.visitCode });
      importedHost = new URL(imp.relayUrl).host;
      store.log(L('Ajustes de envío importados (servidor ' + importedHost + ')', 'Send settings imported (host ' + importedHost + ')'));
    } catch (_) {
      store.log(L('No se pudieron guardar los ajustes de envío importados', 'Imported send settings could not be saved'), 'warn');
    }
  }

  function renderImportBanner() {
    if (!importedHost) { el.importBanner.hidden = true; el.importBanner.innerHTML = ''; return; }
    el.importBanner.hidden = false;
    el.importBanner.innerHTML = `<div class="ds-banner" role="status">${ic('info', 'lg')}<div class="ds-banner__text"><span lang="es">Ajustes de envío importados · servidor ${esc(importedHost)} · código ••••• · la dirección se limpió</span><span class="ds-banner__en" lang="en">Send settings imported · host ${esc(importedHost)} · code ••••• · the address bar was cleaned</span></div><div class="probe-banner-actions">${btn('import-ok', 'Entendido', 'Understood', { variant: 'secondary' })}</div></div>`;
  }
  acts['import-ok'] = () => { importedHost = null; renderImportBanner(); };

  /* ------------------------------------------------------------------ should-have: iframe and file:// repeats of A–B */

  async function miniAB(win) {
    const fp = await fingerprintFor(win);
    const doc = win.document;
    const load = await loadWdkScript(doc, 6000);
    for (let i = 0; i < 12 && typeof win.SB === 'undefined'; i++) await sleep(250);
    return { context: win === window ? 'top-level' : 'iframe', fingerprint: fp, scriptLoad: load.scriptLoad, scriptLoadMs: load.ms, typeofSB: typeof win.SB, sbPresent: typeof win.SB !== 'undefined' };
  }

  const miniLive = { busy: false };

  function miniPane(id) {
    return {
      html() {
        const s = sc(id);
        const p = s.payload;
        const isFile = window.location.protocol === 'file:';
        const lead = id === 'iframe'
          ? ['Repite A y B dentro de un iframe del mismo origen (como una incrustación tipo Blink) y compara con el nivel superior.', 'Repeat A and B inside a same-origin iframe (Blink-like nesting) and compare with top level.']
          : ['Repite A y B abriendo la copia descargada de index.html desde file://. El script WDK fallará en file: por contenido mixto.', 'Repeat A and B by opening the downloaded copy of index.html from file://. The WDK script will fail on file: (mixed content).'];
        const warn = id === 'file' && !isFile ? notice('Esta pestaña no está en file://. Abre la copia descargada y ejecuta aquí.', 'This tab is not on file://. Open the downloaded copy and run it there.', 'triangle-alert') : '';
        return `<p class="probe-lead"><span lang="es">${lead[0]}</span><span class="en" lang="en">${lead[1]}</span></p>${warn}
          <div class="probe-row">${btn('mini-run', p ? 'Ejecutar de nuevo' : 'Ejecutar A y B', p ? 'Run again' : 'Run A and B', { icon: 'play', disabled: miniLive.busy || (id === 'file' && !isFile) })}</div>
          ${s.status === 'running' ? notice('Midiendo; el script WDK puede tardar unos segundos.', 'Measuring; the WDK script may take a few seconds.', 'clock') : ''}
          ${p && p.error ? dump(p) : ''}${p && p.fingerprint ? kv([
            ['Contexto', 'Context', esc(p.context)],
            ['Servido como', 'Served as', esc(p.fingerprint.servedAs)],
            ['Nivel superior', 'Top level', p.fingerprint.topLevel ? 'sí / yes' : 'no'],
            ['User agent', 'User agent', esc(p.fingerprint.userAgent)],
            ['scriptLoad', 'scriptLoad', `${esc(p.scriptLoad)} (${p.scriptLoadMs} ms)`],
            ['typeof SB · sbPresent', 'typeof SB · sbPresent', `${esc(p.typeofSB)} · ${p.sbPresent}`],
            ['getInstalledRelatedApps()', 'getInstalledRelatedApps()', esc(safeJson(p.fingerprint.relatedApps))]
          ]) : ''}`;
      }
    };
  }
  PANES.iframe = miniPane('iframe');
  PANES.file = miniPane('file');

  acts['mini-run'] = async () => {
    const id = activeId;
    if (miniLive.busy) return;
    miniLive.busy = true;
    store.setScenarioResult(id, 'running');
    say(`${id}: midiendo A y B…`, `${id}: measuring A and B…`);
    afterChange();
    let result;
    let frame = null;
    try {
      if (id === 'iframe') {
        frame = document.createElement('iframe');
        frame.className = 'probe-frame';
        frame.setAttribute('title', 'iframe de prueba / test iframe');
        frame.srcdoc = '<!doctype html><title>probe iframe</title>';
        const loaded = new Promise((r) => { frame.onload = r; });
        document.body.appendChild(frame);
        await loaded;
        result = await miniAB(frame.contentWindow);
      } else {
        result = await miniAB(window);
      }
      store.setScenarioResult(id, 'pass', result);
      say(`${id} terminado: sbPresent=${result.sbPresent}`, `${id} finished: sbPresent=${result.sbPresent}`);
    } catch (e) {
      store.setScenarioResult(id, 'fail', { error: errStr(e) });
      say(`${id} falló: ${errStr(e)}`, `${id} failed: ${errStr(e)}`, 'error');
    } finally {
      if (frame) frame.remove();
      miniLive.busy = false;
    }
    afterChange({ pane: activeId === id });
  };

  /* ------------------------------------------------------------------ global wiring */

  function resetSceneState() {
    cap.active = false; capReset(); cap.prompts = {};
    ink.strokes = []; ink.view = { scale: 1, tx: 0, ty: 0 }; ink.tool = 'draw';
    dLive.active = null; dLive.measuring = null; dLive.naOpen = {};
    bLive.busy = false; bLive.initBusy = false;
    gShowJson = false;
    hLive.h6Na = false;
    Object.assign(sLive, { status: null, mailHint: false, mailError: '', sumOpen: false, settingsOpen: false, notOfferedOpen: false, testDismissed: false, setErr: '', editTo: false });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (hLive.open) { e.preventDefault(); if (hLive.running) hStop(); else hClose(); return; }
      if (modalState) { e.preventDefault(); closeModal(); return; }
      if (cap.active) { e.preventDefault(); finishCapture('esc'); return; }
    }
    if (e.key === 'Enter' && e.target && e.target.id === 's-to') { e.preventDefault(); acts['s-save-to'](); return; }
    if (e.key === 'Tab' && modalState) {
      const nodes = Array.from(el.modal.querySelectorAll('button:not([disabled]), input, textarea'));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function init() {
    checkForSavedRun();
    if (ls) store.storage = ls;
    collectBasicFingerprint();
    store.log(L('Visita iniciada', 'Visit started'));
    pendingShare = readShareList();
    takeShareFromUrl();
    importSendSettings();
    store.log(Core.channelsLine(currentChannels())); // first paint: channels offered (AC27, OQ10)
    claimWriter();

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t && acts[t.dataset.act]) acts[t.dataset.act](t, e);
    });
    const onChange = (e) => {
      const t = e.target.closest('[data-chg]');
      if (t && acts[t.dataset.chg]) acts[t.dataset.chg](t, e);
    };
    document.addEventListener('change', onChange);
    document.addEventListener('input', (e) => { if (e.target.type === 'text' || e.target.tagName === 'TEXTAREA') onChange(e); });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', () => { sLive.mailSeen = true; recordVisibility('visibilitychange'); });
    window.addEventListener('blur', () => { sLive.mailSeen = true; });
    window.addEventListener('storage', (e) => { if (e.key === WRITER_KEY && e.newValue && e.newValue !== windowId) { writerLost = true; store.storage = null; renderWriterBanner(); } });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); hLive.install = e; if (activeId === 'H' && !hLive.open) renderPane(true); });

    el.export.addEventListener('click', exportClicked);
    el.reset.addEventListener('click', openReset);

    setInterval(tickClock, 1000);
    renderBanner();
    renderShareBanner();
    renderImportBanner();
    refresh();
    renderLog();
    selectScenario('A');

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
