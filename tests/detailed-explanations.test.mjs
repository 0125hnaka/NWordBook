import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog } from '../src/domain.js';
import { createIpaNormalizer } from '../src/terminology.js';
import { buildLearningQuestions } from '../src/content.js';
import { validateDetailedExplanations, renderDetailedExplanation } from '../src/detailed-explanations.js';
const data = await readDataset();
const catalog = createCatalog(data);
const all = [...catalog.cards, ...catalog.predictionCards];
const normalize = createIpaNormalizer(data.terminology);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('全1030問と追加用語の両方向に前提・具体例・理由があり、短い解説も保持する', () => {
  const originals = new Map(buildLearningQuestions(data).map(q => [q.id, q.explanation]));
  assert.equal(all.length, 1030);
  for (const card of all) {
    assert.deepEqual(card.detailSections.map(s => s.title), ['前提となる知識', '具体例で考える', '答えにつながる理由'], card.id);
    assert.ok(card.detailSections.every(s => s.text.trim().length > 20), card.id);
    assert.ok(card.detailSections.reduce((n, s) => n + s.text.length, 0) >= 250, card.id);
    assert.ok(!card.detailSections.some(s => s.text.includes('\\n')), card.id);
    if (!card.prediction) {
      // Compare against the original short text after the established terminology conversion.
      const before = originals.get(card.id);
      assert.equal(card.explanation, normalize(before), card.id);
      assert.ok(before.length > 0);
    }
  }
  for (const q of data.predictions.questions) assert.equal(catalog.predictionCards.find(c => c.id === q.id).answer, normalize(q.answer));
});

test('欠けた解説・不明ID・壊れた参照は公開前に拒否する', () => {
  for (const change of [
    d => { delete d.details.atoms.KA_DNS_CNAME; },
    d => { d.details.atoms.UNKNOWN = d.details.atoms.KA_DNS_CNAME; },
    d => { d.details.atoms.KA_DNS_CNAME.lesson = 'missing'; },
    d => { d.details.predictions.PRED_N001.example = ''; },
    d => { d.details.lessons.dns = 'DNS'; },
    d => { delete d.details; },
  ]) {
    const broken = structuredClone(data); change(broken);
    assert.throws(() => validateDetailedExplanations(broken), /詳しい解説/);
  }
});

test('会話で質問された四問の補足条件を含み、複数段落で読める', () => {
  const checks = {
    Q055: [/CNAME/, /再帰リゾルバー/, /キャッシュ/],
    Q141: [/AS_PATH=65010/, /タグ100/, /MED/, /必ず採用・ループするわけではありません/],
    Q218: [/10\.2\.2\.20/, /10\.1\.1\.10/, /DIRECT/, /PAC/],
    Q245: [/59秒/, /出力キュー/, /受信確認/, /再送/],
  };
  for (const [code, patterns] of Object.entries(checks)) {
    const card = all.find(c => c.shortCode === code);
    const example = card.detailSections[1].text;
    assert.ok(example.split('\n').length >= 3);
    for (const pattern of patterns) assert.match(example, pattern, code);
  }
});

test('教材の文字はHTMLとして解釈せず、詳しい解説は折り畳まず下へ表示する', async () => {
  const html = renderDetailedExplanation({ detailSections: [{ title: '<img src=x>', text: '<script>alert(1)</script>\n次の段落' }] }, escape);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<p>次の段落<\/p>/);
  assert.ok(!html.includes('<details'));
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('esc(card.explanation)') < app.indexOf('renderDetailedExplanation(card, esc)'));
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("'src/detailed-explanations.js'"));
});

test('著作データの重複・更新漏れがなくJSONと一致する', async () => {
  const examples = {};
  for (let n = 1; n <= 4; n++) {
    const { default: rows } = await import(`../scripts/details/atoms-${n}.mjs`);
    for (const row of rows.trim().split('\n')) {
      const [id, lesson, example] = row.split('|');
      assert.ok(!examples[`KA_${id}`], id);
      examples[`KA_${id}`] = { lesson, example: example.replaceAll('\\n', '\n') };
    }
  }
  assert.deepEqual(examples, data.details.atoms);
});
