const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Every field of the attributes below comes from the external Vulcan API.
// The cards must never let it reach innerHTML as markup.
const PAYLOAD = 'z<img src=x onerror=alert(1)>';

class Element {
  constructor() { this.style = {}; this.nodes = new Map(); this.html = ''; }
  set innerHTML(value) { this.html = value; }
  get innerHTML() { return this.html; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  addEventListener() {}
  appendChild() {}
}

function load(file) {
  let Card;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vultron', file), 'utf8'), {
    HTMLElement: Element,
    customElements: { define: (_, klass) => { Card = klass; } },
    document: { createElement: () => new Element() },
  });
  const card = new Card();
  card.config = { limit: 0 };
  card.content = new Element();
  return card;
}

function assertNoMarkup(html) {
  assert.ok(!html.includes('<img'), 'payload rendered as markup');
}

test('remarks card escapes every API field including the date', () => {
  const card = load('vultron-uwagi-card.js');
  card.renderBody({ attributes: { uwagi: [{
    data: PAYLOAD, tresc: PAYLOAD, autor: PAYLOAD, kategoria: PAYLOAD, punkty: PAYLOAD, typ: 'negatywna', id: '1',
  }] } });
  assertNoMarkup(card.content.html);
});

test('homework card escapes every API field including the date', () => {
  const card = load('vultron-work-card.js');
  card.renderBody({ attributes: { lista: [{
    data: PAYLOAD, przedmiot: PAYLOAD, typ: 'Sprawdzian', opis: PAYLOAD, autor: PAYLOAD,
  }] } });
  assertNoMarkup(card.content.html);
});

test('grades card escapes grades, corrections, dates and final grades in all views', () => {
  const card = load('vultron-grades-card.js');
  const state = { attributes: { lista_przedmiotow: [{
    przedmiot: PAYLOAD, srednia: PAYLOAD, srednia_zrodlo: 'wyliczona',
    oceny: [{ w: PAYLOAD, d: PAYLOAD, i: PAYLOAD, pop: [PAYLOAD] }],
    proponowana: PAYLOAD, okresowa: PAYLOAD, proponowana_num: PAYLOAD, okresowa_num: PAYLOAD,
  }] } };
  for (const view of ['renderBySubject', 'renderByDate', 'renderFinal']) {
    card[view](state);
    assertNoMarkup(card.content.html);
  }
});
