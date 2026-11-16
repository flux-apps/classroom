// tests/canvas-url-safety.test.js — web card urls from lesson files / localStorage are http(s) only.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../canvas/canvas-core.js');

const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'file:///C:/secret.txt', 'blob:https://x/1', 'vbscript:x', 'not a url', '//evil.example', '', null, undefined, 42];

const lesson = (url) => ({
  version: '1.0.0',
  objects: [
    { id: 'o1', type: 'webcard', webCardId: 'w1', title: 'T', url, x: 0, y: 0 },
    { id: 'o2', type: 'link', title: 'L', url, x: 0, y: 0 }
  ],
  webCards: [{ id: 'w1', url, title: 'T', mode: 'interact', strokes: [] }]
});

describe('safeWebUrl', () => {
  it('accepts http(s) only', () => {
    assert.equal(core.safeWebUrl('https://es.wikipedia.org'), 'https://es.wikipedia.org/');
    assert.ok(core.safeWebUrl('http://example.com/a?b=1'));
    for (const bad of BAD) assert.equal(core.safeWebUrl(bad), null, String(bad));
  });
});

describe('LessonSerializer.deserialize neutralises non-http(s) card urls', () => {
  for (const bad of BAD) {
    it(`drops ${JSON.stringify(bad)}`, () => {
      const sg = new core.SceneGraph();
      const { webCards } = core.LessonSerializer.deserialize(lesson(bad), sg);
      assert.equal(webCards.length, 1, 'rest of the lesson still loads');
      assert.equal(core.safeWebUrl(webCards[0].url), null);
      assert.equal(webCards[0].mode, 'frozen');
      assert.equal(core.safeWebUrl(sg.objects.get('o1').url), null);
      assert.equal(core.safeWebUrl(sg.objects.get('o2').url), null);
    });
  }

  it('keeps a valid https url', () => {
    const sg = new core.SceneGraph();
    const { webCards } = core.LessonSerializer.deserialize(lesson('https://es.wikipedia.org/wiki/Gato'), sg);
    assert.equal(webCards[0].url, 'https://es.wikipedia.org/wiki/Gato');
    assert.equal(sg.objects.get('o1').url, 'https://es.wikipedia.org/wiki/Gato');
    assert.equal(webCards[0].mode, 'interact');
  });
});

describe('WebViewer.open refuses non-http(s) urls', () => {
  for (const bad of BAD) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      const viewer = new core.WebViewer(new core.SceneGraph());
      const card = new core.WebCard(bad, 'x');
      assert.throws(() => viewer.open(card, { explicit: true }), /http\(s\)/);
      assert.equal(viewer.isOpen, false);
    });
  }
  it('opens a valid https card', () => {
    const viewer = new core.WebViewer(new core.SceneGraph());
    viewer.open(new core.WebCard('https://es.wikipedia.org', 'W'), { explicit: true });
    assert.equal(viewer.isOpen, true);
  });
});

describe('app.js guards every iframe/window.open use of a card url', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'canvas', 'app.js'), 'utf8');
  it('openLink and openWebViewer check safeWebUrl and toast the bilingual refusal', () => {
    assert.match(src, /function openLink\(url\) \{\s*if \(!safeWebUrl\(url\)\)/);
    assert.match(src, /function openWebViewer\(card\) \{\s*if \(!card \|\| !safeWebUrl\(card\.url\)\)/);
    assert.match(src, /BILINGUAL\.webViewer\.blockedUrl/);
    assert.ok(core.BILINGUAL.webViewer.blockedUrl.es && core.BILINGUAL.webViewer.blockedUrl.en);
  });
});
