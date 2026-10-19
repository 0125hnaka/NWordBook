import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog } from '../src/domain.js';
import { buildLearningQuestions } from '../src/content.js';
import { createIpaNormalizer } from '../src/terminology.js';
import { validateQuestionContexts, renderQuestionContext } from '../src/question-contexts.js';
const data = await readDataset(), catalog = createCatalog(data);
const byId = new Map(catalog.cards.map(q => [q.id, q]));
const byCode = code => catalog.cards.find(q => q.shortCode === code);
const normalize = createIpaNormalizer(data.terminology);

test('通常思考812問に状況を表示し、原則だけの292問を具体的な問いへ直す', () => {
  const originals = buildLearningQuestions(data);
  const abstract = originals.filter(q => q.question.startsWith('確認する動作・条件：'));
  assert.equal(abstract.length, 292);
  assert.equal(catalog.cards.filter(q => q.contextualized).length, 812);
  for (const q of catalog.cards.filter(q => q.questionType !== 'term')) {
    assert.ok(q.context?.length >= 35, q.id);
    assert.ok(q.answerFocus?.length > 10, q.id);
    assert.ok(!q.question.startsWith('確認する動作・条件：'), q.id);
  }
  for (const original of abstract) {
    const card = byId.get(original.id);
    assert.notEqual(card.question, normalize(original.question));
    assert.ok(card.questionClarified);
  }
  for (const q of catalog.cards.filter(q => q.questionType === 'term')) assert.equal(q.context, undefined);
});

test('問題番号・解答・短い解説・詳しい解説・出典と用語カードを保持する', () => {
  for (const q of buildLearningQuestions(data)) {
    const card = byId.get(q.id);
    assert.equal(card.id, q.id);
    assert.equal(card.answer, normalize(q.answer), q.id);
    assert.equal(card.explanation, normalize(q.explanation), q.id);
    assert.deepEqual(card.sourceRefs, q.sourceRefs, q.id);
    assert.ok(card.detailSections.length === 3);
    if (q.questionType === 'term') assert.equal(card.question, normalize(q.question));
  }
  const codes = data.questionCodes;
  assert.equal(catalog.cards.length, 952);
  assert.equal(catalog.predictionCards.length, 78);
  assert.deepEqual(catalog.questionCodes, codes);
});

test('質問された問題の構成・変更条件・比較対象が明示される', () => {
  assert.match(byCode('Q055').context, /waf\.provider\.example/);
  assert.ok(!byCode('Q055').context.includes('CNAME'));
  assert.match(byCode('Q141').context, /BはこのOSPF経路を採用/);
  assert.match(byCode('Q141').context, /経路情報の受渡し/);
  assert.match(byCode('Q218').context, /ブラウザーのプロキシ設定は、まだ変更していない/);
  assert.match(byCode('Q245').context, /60秒/);
  assert.match(byCode('Q245').context, /経路が存在/);
  assert.match(byCode('Q253').context, /192\.0\.2\.1/);
  assert.match(byCode('Q253').context, /198\.51\.100\.2/);
  assert.match(byCode('Q253').context, /OSPFで広告するLANのプレフィックスを比較する問題ではない/);
  assert.match(byCode('Q253').question, /それぞれ何を相手/);
  assert.ok(!byCode('Q253').context.includes('224.0.0.5'));
  assert.equal(byCode('Q253').answerFocus.includes('原因'), false);
});

test('状況編集の欠落・不明参照・解答の混入を公開前に拒否する', () => {
  for (const mutate of [
    d => { delete d.questionContexts; },
    d => { delete d.questionContexts.atoms.KA_IPSEC_GRE; },
    d => { d.questionContexts.atoms.KA_IPSEC_GRE.context = ''; },
    d => { d.questionContexts.atoms.KA_IPSEC_GRE.prompt = ''; },
    d => { d.questionContexts.questions.unknown = { question: '問い', answerFocus: '対象' }; },
    d => { d.questionContexts.questions.Q_IPSEC_GRE_L3.answer = '上書き'; },
    d => { d.questionContexts.questions.Q_IPSEC_GRE_L3.answerFocus = ''; },
  ]) {
    const copy = structuredClone(data); mutate(copy);
    assert.throws(() => validateQuestionContexts(copy), /問題の状況/);
  }
});

test('答えを開く前に表示し、教材をHTMLとして解釈しない', async () => {
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = renderQuestionContext({ context: '<script>example</script>' }, escape);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.equal(renderQuestionContext({}, escape), '');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('renderQuestionContext(card, esc)') < app.indexOf('esc(card.question)'));
  assert.ok(app.indexOf('renderQuestionContext(card, esc)') < app.indexOf('${revealed ?'));
});

test('著作元から全366知識を重複なく再生成できる', async () => {
  const atoms = {};
  for (let n = 1; n <= 4; n++) {
    const { default: rows } = await import(`../scripts/contexts/atoms-${n}.mjs`);
    for (const row of rows.trim().split('\n')) {
      const columns = row.split('|'); assert.equal(columns.length, 3);
      const [suffix, context, prompt] = columns, id = `KA_${suffix}`;
      assert.ok(!atoms[id], id);
      atoms[id] = { context: context.replaceAll('\\n', '\n'), prompt };
    }
  }
  assert.deepEqual(atoms, data.questionContexts.atoms);
  const { default: questions } = await import('../scripts/contexts/questions.mjs');
  assert.deepEqual(questions, data.questionContexts.questions);
});
