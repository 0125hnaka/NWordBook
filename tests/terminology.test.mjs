import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/data.mjs';
import { createCatalog, recordConfidence, initialState } from '../src/domain.js';
import { createIpaNormalizer, validateTerminology } from '../src/terminology.js';

const data = await readDataset();
const normalize = createIpaNormalizer(data.terminology);
const catalog = createCatalog(data);

test('802.1Xの用語を出題・解答の両方向でIPA表記にし、解説と罠も揃える', () => {
  for (const [id, expected] of [['SUPPLICANT', 'サプリカント'], ['AUTHENTICATOR', 'オーセンティケータ']]) {
    const meaning = catalog.cards.find(c => c.id === `TERM_${id}_meaning`);
    const name = catalog.cards.find(c => c.id === `TERM_${id}_name`);
    assert.equal(meaning.question, `「${expected}」とは何ですか。`);
    assert.equal(name.answer, expected);
  }
  for (const card of catalog.cards.filter(c => c.knowledgeAtomId === 'KA_EAP_ROLES')) {
    assert.ok(!/Supplicant|Authenticator|認証Server/.test([card.question, card.answer, card.explanation, card.atom.commonTrap, card.atom.oneLineRule].join('\n')));
  }
  assert.match(catalog.cards.find(c => c.id === 'Q_EAP_ROLES_L4').question, /オーセンティケータ/);
});
test('SNMP・プロキシ・経路用語もIPA表記に統一する', () => {
  assert.equal(normalize('SNMP ManagerとAgent。Polling、Trap、Inform。'), 'SNMP マネージャとエージェント。ポーリング、トラップ、インフォーム。');
  assert.equal(normalize('Forward Proxy、Reverse Proxy、認証Server、Client、Router ID、Next hop'), 'フォワードプロキシ、リバースプロキシ、認証サーバ、クライアント、ルータID、ネクストホップ');
  assert.equal(catalog.cards.find(c => c.id === 'TERM_ROUTER_ID_name').answer, 'ルータID');
  assert.ok(catalog.profile.groups.every(g => !g.label.includes('Proxy')));
});
test('プロトコルの識別子・ヘッダー・URL・機器名を壊さず、表記変換は安定する', () => {
  const literal = 'ClientHello ServerHello NEXT_HOP AS_PATH Proxy-Authenticate User-Agent Set-Cookie X-Forwarded-For Router1 ServerA Windows Server 2022 Serverヘッダー https://example.jp/?role=Authenticator `Authenticator`';
  assert.equal(normalize(literal), literal);
  const text = '認証Serverに問い合わせるAuthenticatorとSupplicant。Router IDとNext-hop Router。';
  assert.equal(normalize(normalize(text)), normalize(text));
});
test('表記変更でも原本、問題ID、出典URL、確認状態、理解度の対応を保持する', () => {
  assert.equal(data.editorial.terms.find(t => t.id === 'SUPPLICANT').term, 'サプリカント');
  const source = data.questions.find(q => q.id === 'Q_EAP_ROLES_L4');
  const card = catalog.cards.find(q => q.id === source.id);
  assert.match(source.question, /Authenticator/);
  assert.deepEqual(card.sourceRefs, source.sourceRefs);
  assert.equal(card.id, source.id);
  assert.equal(card.defaultEnabled, source.defaultEnabled);
  const state = recordConfidence(initialState(catalog), 'TERM_SUPPLICANT_name', 'unknown');
  assert.equal(state.questionStates[catalog.cards.find(c => c.id === 'TERM_SUPPLICANT_name').id].confidence, 'unknown');
});
test('IPA用語表の参照切れ、曖昧な対応、IPA以外の出典を拒否する', () => {
  for (const mutate of [g => g.rules[0].sourceIds = ['missing'], g => g.rules[1].aliases.push(g.rules[0].aliases[0]), g => g.sources[0].url = 'https://example.com/']) {
    const invalid = structuredClone(data.terminology); mutate(invalid); assert.throws(() => validateTerminology(invalid));
  }
});
