import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, advanceSession, reviewSession, returnToCurrent, sessionViewIndex } from '../src/domain.js';

function fifthQuestion() {
  let session = createSession(Array.from({ length: 5 }, (_, i) => ({ id: `q${i + 1}` })), {}, 5);
  for (let i = 0; i < 4; i++) session = advanceSession(session, 'next');
  session.ratings = { q1: 'unknown', q3: 'unclear', q5: 'understood' };
  session.cardViews = { q5: { revealed: true, details: [{ name: 'sources', open: true }] } };
  return session;
}

test('5問目から3問目を見直し、記録・キュー・5問目の解答状態を保持して戻る', () => {
  const original = fifthQuestion();
  const review = reviewSession(original, 2);
  assert.equal(sessionViewIndex(review), 2);
  assert.equal(review.index, 4);
  assert.equal(review.completed, 4);
  assert.deepEqual(review.queue, original.queue);
  const back = returnToCurrent(review);
  assert.equal(sessionViewIndex(back), 4);
  assert.deepEqual(back.ratings, original.ratings);
  assert.deepEqual(back.cardViews, original.cardViews);
  assert.equal(original.reviewIndex, null);
});

test('見直し完了を繰り返しても完了数・非表示数・進捗を二重計上しない', () => {
  let session = fifthQuestion();
  for (let i = 0; i < 3; i++) {
    session = reviewSession(session, 2);
    session = { ...session, ratings: { ...session.ratings, q3: 'understood' } };
    session = advanceSession(session, 'next');
    assert.equal(session.index, 4);
    assert.equal(session.completed, 4);
    assert.equal(session.hidden, 0);
  }
  assert.equal(session.ratings.q3, 'understood');
  const result = advanceSession(session, 'next');
  assert.equal(result.index, 5);
  assert.equal(result.completed, 5);
});

test('未到達・範囲外・非表示の問題へ移動できず、学習中の番号指定で元に戻る', () => {
  const session = advanceSession(createSession(Array.from({ length: 5 }, (_, i) => ({ id: `q${i}` })), {}, 5), 'next');
  for (const index of [-1, 2, 5, 0.5, NaN]) assert.equal(reviewSession(session, index), session);
  assert.equal(reviewSession(session, 0, new Set(['q0'])), session);
  assert.equal(sessionViewIndex(reviewSession(reviewSession(session, 0), 1)), 1);
});

test('過去問を非表示にした場合も元の問題に戻り、集計の合計を保持する', () => {
  let session = reviewSession(fifthQuestion(), 2);
  session = advanceSession(session, 'hide', new Set(['q3']));
  assert.equal(sessionViewIndex(session), 4);
  assert.equal(session.completed, 3);
  assert.equal(session.hidden, 1);
  assert.equal(reviewSession(session, 2, new Set(['q3'])), session);
  session = advanceSession(session, 'next');
  assert.equal(session.completed + session.hidden, 5);
});
