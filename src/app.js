import { createCatalog, eligibleCards, studyModeCounts, selectStudyQuestions, createSession, advanceSession, sessionViewIndex, reviewSession, returnToCurrent, recordConfidence, parseState, importState, safeUrl, sourceLabel, MAX_IMPORT_BYTES } from './domain.js';
import { renderQuestionContext } from './question-contexts.js';
import { renderDetailedExplanation } from './detailed-explanations.js';
import { createStateStore } from './storage.js';
import { eligiblePredictionCards, predictionScopeCounts } from './predictions.js';
import { eligiblePastTermCards, pastTermSourceLabel, pastTermOccurrences } from './past-terms.js';
import { examYearLabel } from './exams.js';

// Only escaped text enters templates. Source content is never interpreted as HTML.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = document.querySelector('#app');
const typeLabels = { term: '用語', mechanism: '仕組み', case: '構成・判断', change: '構成変更', failure: '障害' };
const confidenceLabels = { understood: 'わかった', unclear: 'わからない', unknown: '知らない' };
const confidenceHints = { understood: '意味・理由を説明できる', unclear: '解説を見ても理解できない', unknown: '初めて知った・覚えていない' };
const modeLabels = { terms: '用語を覚える', thinking: '仕組み・判断', mixed: '両方を学ぶ' };
const relationLabels = { generalized_from_subquestion: '設問から一般化', prerequisite: '設問群の前提', problem_body_prerequisite: '本文の前提', related_prerequisite_only: '関連する前提', candidate_without_ipa_exam_mapping: '対応未確認の補充' };
let catalog, store, view = 'home', session = null, revealed = false, message = '', pendingImport = null, hiddenLimit = 30;
let filter = { groupId: 'all', preset: 'all', mode: 'terms', direction: 'both', review: 'all', collection: 'exam', predictionScope: 'all', pastTermYear: 'all', pastTermPeriod: 'all' };
const state = () => store.state;
const save = next => store.save(next);
const cardsById = new Map();
const hiddenIds = () => new Set(Object.entries(state().questionStates).filter(([, s]) => s.hidden).map(([id]) => id));
const candidates = () => filter.collection === 'past-terms' ? eligiblePastTermCards(catalog, state(), filter) : filter.collection === 'predictions' ? eligiblePredictionCards(catalog, state(), filter) : eligibleCards(catalog, state(), filter);
const allCards = () => [...catalog.cards, ...catalog.predictionCards, ...catalog.pastTermCards];
const countSetting = () => filter.collection === 'past-terms' ? 'pastTermQuestionCount' : filter.collection === 'predictions' ? 'predictionQuestionCount' : 'questionCount';
const requestedCount = () => state().settings[countSetting()] ?? 10;
const collectionHome = () => ['predictions', 'past-terms'].includes(filter.collection) ? filter.collection : 'home';
const button = (action, label, cls = 'button', attrs = '') => `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;

function shell(content) {
  const inStudy = view === 'study';
  return `<header class="header"><div class="header-inner"><a class="brand" href="#home" aria-label="NWordBook ホーム"><span class="brand-mark" aria-hidden="true">N<span>↗</span></span><span>NWordBook<small>NETWORK SPECIALIST</small></span></a><span class="edition">午後対策 / SHORT STUDY</span></div></header>
    <div class="app-layout"><aside class="sidebar"><p class="nav-caption">MY STUDY</p><nav aria-label="メインメニュー">${inStudy ? button('interrupt', '← 中断して戻る', 'nav-item') : ['home', 'hidden', 'settings'].map((page, i) => `<a class="nav-item ${view === page ? 'active' : ''}" href="#${page}" ${view === page ? 'aria-current="page"' : ''}><span aria-hidden="true">${['▤', '◫', '⚙'][i]}</span>${['学習をはじめる', '非表示の問題', '学習設定'][i]}${page === 'hidden' ? `<span class="nav-count">${hiddenIds().size}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-note"><span class="tiny-label">ONE QUESTION AT A TIME</span><p>知識をつなぐ。<br>判断する力にする。</p><span>用語から、構成変更の理由まで。</span></div><p class="local-label"><span class="status-dot"></span>${store.persistent ? 'このブラウザーに保存' : '一時保存モード'}</p></aside>
    <main id="main" tabindex="-1">${store.notice ? `<div class="notice warning" role="status">${esc(store.notice)}</div>` : ''}<div id="feedback" role="status" aria-live="polite">${message ? `<div class="notice">${esc(message)}</div>` : ''}</div>${content}<footer>${filter.collection === 'past-terms' ? 'IPAの過去問の空欄前後を短く整理した独自編集問題です。IPAの公式・監修教材ではありません。' : filter.collection === 'predictions' ? '独自の予想教材です。IPA出題対応は未調査で、出題を保証するものではありません。' : 'IPAの過去問から一般化した独自編集の短問です。IPAの公式・監修教材ではありません。'}<br><span>教材 ${esc(filter.collection === 'past-terms' ? catalog.pastTerms.version : filter.collection === 'predictions' ? catalog.predictions.version : catalog.manifest.datasetVersion)} · NWordBook v0.7.0</span></footer></main></div>`;
}

function home() {
  const available = candidates();
  const enabledGroups = catalog.profile.groups.filter(g => state().settings.enabledGroupIds.includes(g.id));
  const count = state().settings.questionCount;
  const counts = studyModeCounts(catalog, state(), filter);
  const reviewCount = eligibleCards(catalog, state(), { ...filter, review: 'weak' }).length;
  return `<section class="panel study-setup"><div class="section-title"><h1 class="setup-heading">今日の学習</h1><span class="candidate-count" role="status">対象 ${available.length}問</span></div>
    <fieldset><legend>学び方</legend><div class="mode-options">${Object.entries(modeLabels).map(([mode, label]) => button(`mode-${mode}`, `<span>${label}</span><small>${counts[mode]}問</small>`, filter.mode === mode ? 'segment selected' : 'segment', `aria-pressed="${filter.mode === mode}"`)).join('')}</div><p class="field-note">${filter.mode === 'terms' ? '単語帳のように、用語の名前と意味・役割を覚えます。' : filter.mode === 'thinking' ? '構成や条件を読み、動作・理由・対処を答える練習です。' : (count === 'all' ? '条件に合う用語問題と考える問題をすべて出します。' : '候補があれば、用語問題と考える問題をおよそ半分ずつ出します。')}</p></fieldset>
    ${filter.mode === 'terms' ? `<label class="field-label" for="term-direction">用語カードの向き</label><select id="term-direction"><option value="both" ${filter.direction === 'both' ? 'selected' : ''}>両方を混ぜる</option><option value="meaning" ${filter.direction === 'meaning' ? 'selected' : ''}>用語 → 意味・役割</option><option value="name" ${filter.direction === 'name' ? 'selected' : ''}>説明 → 用語名</option></select>` : ''}
    <label class="review-choice"><input id="weak-only" type="checkbox" ${filter.review === 'weak' ? 'checked' : ''}><span>「わからない」「知らない」だけを復習（${reviewCount}問）</span></label>
    <fieldset><legend>学習範囲</legend><div class="segmented">${button('preset-all', '有効な分野すべて', filter.preset === 'all' ? 'segment selected' : 'segment', `aria-pressed="${filter.preset === 'all'}"`)}${button('preset-first100', 'まず覚える100', filter.preset === 'first100' ? 'segment selected' : 'segment', `aria-pressed="${filter.preset === 'first100'}"`)}</div><p class="field-note">${filter.preset === 'first100' ? '優先度Aの100知識を対象に、現在の分野・非表示設定で絞り込みます。100問固定ではありません。' : '設定で有効にした分野だけが出題されます。'}</p></fieldset>
    <label class="field-label" for="group">分野</label><select id="group"><option value="all">全分野ランダム</option>${enabledGroups.map(g => `<option value="${esc(g.id)}" ${filter.groupId === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
    <fieldset><legend>問題数</legend><div class="count-options">${[5, 10, 20, 'all'].map(n => button(`count-${n}`, `<strong>${n === 'all' ? 'すべて' : n}</strong>${n === 'all' ? '' : '<span>問</span>'}${n === 10 ? '<small>おすすめ</small>' : ''}`, n === count ? 'count-option selected' : 'count-option', `aria-pressed="${n === count}"`)).join('')}</div></fieldset>
    <div class="session-summary"><span>今回の出題</span><strong>${count === 'all' ? available.length : Math.min(count, available.length)}問 <span>/ 候補 ${available.length}問</span></strong></div>
    ${available.length === 0 || (count !== 'all' && available.length < count) ? `<p class="shortage" role="status">${available.length === 0 ? (filter.review === 'weak' ? 'この条件で「わからない」「知らない」を記録した問題はありません。復習のチェックを外すか、学び方・分野を変更してください。' : '出題候補がありません。学び方・分野・非表示設定を確認してください。') : `条件に合う問題が${available.length}問のため、その件数で開始します。学び方・分野・復習・非表示・未確認設定で絞り込んでいます。`}</p><div class="inline-links"><a href="#settings">学習分野を見直す</a><a href="#hidden">非表示一覧へ</a></div>` : ''}
    ${button('start', `学習をはじめる <span aria-hidden="true">→</span>`, 'button primary start-button', available.length ? '' : 'disabled')}<p class="below-button">答えは頭の中で。自分のペースで進めましょう。</p></section>
    <p class="prediction-entry"><a href="#past-terms" class="button secondary">過去問の用語クイズ</a><span>実際に問われた空欄を短く練習</span></p>
    <p class="prediction-entry"><a href="./exam.html" class="button secondary">午後試験を解く</a><span>公式PDFで大問を練習</span></p>
    <p class="prediction-entry">${button('prediction-home', '予想問題を解く', 'button quiet')}<span>過去問由来の学習を終えたら</span></p>`;
}

function predictions() {
  const available = candidates(), count = requestedCount();
  const counts = predictionScopeCounts(catalog, state(), filter);
  const reviewCount = eligiblePredictionCards(catalog, state(), { ...filter, review: 'weak' }).length;
  return `<section class="panel study-setup"><h1 class="setup-heading">予想問題</h1><p class="field-note">過去問由来の学習を終えた方向けの追加演習です。短問72問と複合演習6問を収録しています。IPA出題対応は未調査で、未出題を確認済みという意味ではありません。</p>
    <label class="field-label" for="prediction-scope">予想問題の種類</label><select id="prediction-scope">${[['all', `短問と複合演習（${counts.all}問）`], ['short', `短問（${counts.short}問）`], ['composite', `複合演習（${counts.composite}問）`]].map(([value, label]) => `<option value="${value}" ${filter.predictionScope === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <label class="review-choice"><input id="weak-only" type="checkbox" ${filter.review === 'weak' ? 'checked' : ''}><span>「わからない」「知らない」だけを復習（${reviewCount}問）</span></label>
    <fieldset><legend>問題数</legend><div class="count-options">${[5, 10, 20, 'all'].map(n => button(`count-${n}`, `<strong>${n === 'all' ? 'すべて' : n}</strong>${n === 'all' ? '' : '<span>問</span>'}`, n === count ? 'count-option selected' : 'count-option', `aria-pressed="${n === count}"`)).join('')}</div></fieldset>
    <div class="session-summary"><span>今回の出題</span><strong>${count === 'all' ? available.length : Math.min(count, available.length)}問 <span>/ 候補 ${available.length}問</span></strong></div>
    ${!available.length ? '<p class="shortage" role="status">条件に合う予想問題がありません。復習のチェックを外すか、問題の種類・非表示設定を見直してください。</p>' : ''}
    ${button('start', '予想問題をはじめる →', 'button primary start-button', available.length ? '' : 'disabled')}
    <p class="field-note">通常の学び方・学習分野・未確認補充の設定とは別に出題します。理解度・非表示・前の問題への移動も利用できます。</p><a href="#home">過去問由来の学習に戻る</a></section>`;
}

function pastTerms() {
  const available = candidates(), count = requestedCount();
  const reviewCount = eligiblePastTermCards(catalog, state(), { ...filter, review: 'weak' }).length;
  const years = [...new Set(catalog.pastTermCards.map(c => c.source.year))].sort((a, b) => b - a);
  return `<section class="panel study-setup"><div class="section-title"><h1 class="setup-heading">過去問の用語クイズ</h1><span class="candidate-count" role="status">対象 ${available.length}問</span></div>
    <p class="field-note">平成21年度〜令和7年度の全16年分から${catalog.pastTermCards.length}問。本文の空欄前後を短く整理し、用語だけで答えられる問題を選びました。図表の転記・計算・固有の設定値などは除いています。原文そのままの抜粋ではありません。</p>
    <div class="past-term-filters"><div><label class="field-label" for="past-term-year">年度</label><select id="past-term-year"><option value="all">すべての年度</option>${years.map(y => `<option value="${y}" ${filter.pastTermYear === String(y) ? 'selected' : ''}>${esc(examYearLabel(y))}（${y}年）</option>`).join('')}</select></div>
    <div><label class="field-label" for="past-term-period">午後区分</label><select id="past-term-period">${[['all', '午後Ⅰ・Ⅱ'], ['1', '午後Ⅰ'], ['2', '午後Ⅱ']].map(([v, label]) => `<option value="${v}" ${filter.pastTermPeriod === v ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>
    <label class="review-choice"><input id="weak-only" type="checkbox" ${filter.review === 'weak' ? 'checked' : ''}><span>「わからない」「知らない」だけを復習（${reviewCount}問）</span></label>
    <fieldset><legend>問題数</legend><div class="count-options">${[5, 10, 20, 'all'].map(n => button(`count-${n}`, `<strong>${n === 'all' ? 'すべて' : n}</strong>${n === 'all' ? '' : '<span>問</span>'}`, n === count ? 'count-option selected' : 'count-option', `aria-pressed="${n === count}"`)).join('')}</div></fieldset>
    <div class="session-summary"><span>今回の出題</span><strong>${count === 'all' ? available.length : Math.min(count, available.length)}問 <span>/ 候補 ${available.length}問</span></strong></div>
    ${!available.length ? '<p class="shortage" role="status">条件に合う問題がありません。年度・午後区分・復習・非表示設定を見直してください。</p>' : ''}
    ${button('start', '用語クイズをはじめる →', 'button primary start-button', available.length ? '' : 'disabled')}
    <p class="field-note">答えは頭の中で考え、「答えを見る」で確認します。理解度・非表示・前の問題への移動も使えます。通常の学習分野や用語カードの向きとは別の出題です。</p><a href="#home">今日の学習に戻る</a></section>`;
}

function pastTermAnswer(card) {
  const { cards, paperCount } = pastTermOccurrences(catalog, card);
  const source = card.source, hash = `#${source.year}-${source.period}-${source.questionNo}`;
  const localPdf = (filename, page) => `./past-exams/${encodeURIComponent(filename)}#page=${page}`;
  return `<p class="explanation">${esc(card.explanation)}</p><p class="field-note">解答は原問の解答例の表記です。空欄の外にある語も合わせて読みましょう。過去の規格・方式は出題当時の内容です。</p>
    <section class="past-term-source" aria-label="出典"><h4>元の過去問を確認する</h4><p>${esc(pastTermSourceLabel(source))}</p><div class="inline-links"><a href="./exam.html${hash}" target="_blank" rel="noopener noreferrer">原問を解く ↗</a><a href="./exam-explanation.html${hash}" target="_blank" rel="noopener noreferrer">大問の解説 ↗</a><a href="${esc(localPdf(source.problem, source.pages[0]))}" target="_blank" rel="noopener noreferrer">問題PDF（${source.pages.join('・')}ページ）↗</a><a href="${esc(localPdf(source.answer, source.answerPage))}" target="_blank" rel="noopener noreferrer">公式解答例PDF ↗</a></div></section>
    ${cards.length > 1 ? `<details class="term-occurrences"><summary>同じ解答語の収録箇所（${paperCount}回・${cards.length}箇所）</summary><p class="field-note">このクイズに収録した空欄の集計です。IPAの全出題回数ではありません。表記が異なる解答語は別に集計します。</p><ul>${cards.map(c => `<li>${esc(pastTermSourceLabel(c.source))} · ${esc(c.shortCode)}</li>`).join('')}</ul></details>` : ''}`;
}

function confidenceControls(card) {
  const selected = session.ratings[card.id];
  return `<section class="confidence-panel" aria-label="理解度の記録"><h3>答えを見て、どうでしたか？</h3><p>選んでも次へは進みません。解説を読み直して変更できます。</p><div class="confidence-options">${Object.entries(confidenceLabels).map(([value, label]) => button(`rate-${value}`, `<strong>${label}</strong><small>${confidenceHints[value]}</small>`, `confidence-button ${selected === value ? 'selected' : ''}`, `aria-pressed="${selected === value}"`)).join('')}</div><p class="confidence-status" role="status">${selected ? `「${confidenceLabels[selected]}」を記録しました。` : '記録は任意です。未選択でも次へ進めます。'}${!selected && state().questionStates[card.id]?.confidence ? ` 前回：${confidenceLabels[state().questionStates[card.id].confidence]}` : ''}</p></section>`;
}

function sources(card) {
  if (card.prediction) {
    const linked = card.technicalSources.length ? [card] : catalog.predictionCards.filter(c => card.relatedPredictionCodes.includes(c.code));
    const links = [...new Map(linked.flatMap(c => c.technicalSources).map(s => [s.url, s])).values()];
    return `<details class="sources"><summary>予想問題の根拠・関連資料</summary><p class="field-note">追加調査_2026-10-17 · ${esc(card.code)}「${esc(card.title)}」。独自教材で、IPA出題対応は未調査です。技術資料へのリンクは出題実績を示しません。</p><p>${esc(card.technicalEvidence || '複合演習は資料作成者による独自の条件・数値です。関連する短問の技術根拠を以下に示します。')}</p><p class="field-note">関連・既存との差分：${esc(card.difference)}</p><div class="inline-links">${links.map(s => { const url = safeUrl(s.url); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>` : ''; }).join('')}</div></details>`;
  }
  return `<details class="sources"><summary>出典と根拠を確認する <span>${card.sourceRefs.length}件</span></summary><p class="field-note">${card.editorialAdded ? '既存知識から編集した追加用語カードです。以下は元の知識の根拠であり、このカード自体のIPA出題を確認したものではありません。' : '独自編集の短問です。'}出題趣旨は公式の解答例PDFに含まれます。</p>${card.sourceRefs.map(source => `<article class="source-item"><strong>${esc(sourceLabel(source))}</strong><p>${esc(relationLabels[source.relationship] || source.relationship)} · ${source.countedForFrequency ? '直接出題回数に算入' : '直接出題回数には含めない'}${source.classification ? ` · 原問の分類 ${esc(source.classification)}` : ''}</p>${source.note ? `<p>${esc(source.note)}</p>` : ''}<div class="inline-links">${[['officialProblemUrl', '公式問題'], ['officialAnswerUrl', '公式解答例・出題趣旨'], ['officialCommentaryUrl', '公式採点講評']].map(([key, label]) => { const url = safeUrl(source[key]); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : ''; }).join('')}</div></article>`).join('')}<p class="field-note">知識の確認済み頻度：原設問 ${card.atom.frequency.subQuestionCount}件 / 大問 ${card.atom.frequency.majorQuestionCount}件 / 試験回 ${card.atom.frequency.examSessionCount}回。カード枚数とは異なります。</p></details>`;
}

function rememberStudyView() {
  const id = session.queue[sessionViewIndex(session)];
  const details = [...document.querySelectorAll('.question-card details')].map(d => ({ name: d.className, open: d.open }));
  session = { ...session, cardViews: { ...session.cardViews, [id]: { revealed, details } } };
}

function restoreStudyView(rethink = false) {
  const saved = session.cardViews[session.queue[sessionViewIndex(session)]];
  revealed = !rethink && saved?.revealed === true;
  render(true);
  if (revealed) for (const detail of saved.details) document.querySelector(`.question-card details.${CSS.escape(detail.name)}`)?.toggleAttribute('open', detail.open);
}

function showSessionQuestion(index) {
  if (!session || view !== 'study' || index === sessionViewIndex(session)) return;
  rememberStudyView();
  const next = reviewSession(session, index, hiddenIds());
  if (next === session) return;
  session = next;
  restoreStudyView(session.reviewIndex != null);
}

function study() {
  const viewedIndex = sessionViewIndex(session);
  const card = cardsById.get(session.queue[viewedIndex]);
  const position = viewedIndex + 1;
  const visited = session.queue.map((id, index) => ({ id, index })).filter(q => q.index <= session.index && !hiddenIds().has(q.id));
  const previous = visited.filter(q => q.index < viewedIndex).at(-1);
  const reviewing = session.reviewIndex != null;
  const isDiagram = /[┌┐└┘│─]|\+[-+]{2,}|\[.+\].*(?:--|→|->).+\[/.test(card.question);
  return `<div class="study-top"><div><p class="eyebrow">SHORT STUDY</p><h1>ひとつずつ、理解する。</h1></div><span class="progress-label">${position}<span> / ${session.queue.length} 問</span></span></div><progress value="${session.index}" max="${session.queue.length}" aria-label="学習の進捗"></progress>
    <nav class="session-navigation" aria-label="学習中の問題移動">${button('previous-question', '← 前の問題', 'button secondary', previous ? `data-index="${previous.index}"` : 'disabled')}<label for="session-position">問題を選ぶ<select id="session-position">${visited.map(q => `<option value="${q.index}" ${q.index === viewedIndex ? 'selected' : ''}>${q.index + 1}問目${q.index === session.index ? '（学習中）' : ''}</option>`).join('')}</select></label>${reviewing ? button('return-current', `元の${session.index + 1}問目に戻る`, 'button secondary') : ''}</nav>
    ${reviewing ? `<p class="review-notice" role="status">${position}問目を見直しています。学習の進捗は${session.index + 1}問目のまま保持しています。</p>` : ''}
    <section class="panel question-card"><div class="card-meta"><span class="category-pill">${esc(card.group.label)}</span><span>${esc(typeLabels[card.questionType])}${card.questionType === 'term' ? ` · ${card.termDirection === 'meaning' ? '用語 → 意味' : '説明 → 用語'}` : ''}${card.pastTerm ? '' : card.prediction ? ` · ${esc(card.code)} · ${card.kind === 'composite' ? '複合演習' : '短問'}` : ` · 難易度 ${card.difficulty}/3`}${card.level ? ` · Level ${card.level}` : ''}</span></div>${card.prediction ? '<p class="prediction-label">予想問題 · IPA出題対応は未調査</p>' : !card.atom.verified ? '<p class="unverified-label">IPA設問対応未確認の技術補充</p>' : ''}<p class="question-number"><span>QUESTION ${String(position).padStart(2, '0')}</span><span class="question-code">問題ID <code>${esc(card.shortCode)}</code></span></p>${card.pastTerm ? `<p class="past-term-stamp">${esc(pastTermSourceLabel(card.source))}<br><span>空欄前後を短く整理</span></p>` : ''}${renderQuestionContext(card, esc)}<h2 class="question-text ${isDiagram ? 'diagram' : ''}">${esc(card.question)}</h2><div class="answer-guide"><strong>答えること</strong><p>${esc(card.answerFocus)}</p></div>
    ${revealed ? `<section class="answer" aria-label="解答と解説"><p class="eyebrow">ANSWER</p><h3>${esc(card.answer)}</h3>${confidenceControls(card)}${card.pastTerm ? pastTermAnswer(card) : `<details class="explanation-details" ${card.questionType === 'term' ? '' : 'open'}><summary>短い解説と、午後につながる考え方</summary><p class="explanation">${esc(card.explanation)}</p><div class="trigger"><span aria-hidden="true">↳</span><div><strong>午後につながる思考トリガー</strong><p>${esc(card.thinkingTrigger || card.atom.thinkingTrigger)}</p></div></div></details>${renderDetailedExplanation(card, esc)}<details class="more-details"><summary>間違えやすい点・学習の目安</summary><p class="explanation">${esc(card.atom.commonTrap)}</p>${card.prediction ? `<p class="field-note">${card.kind === 'composite' ? '複合演習' : `学習順 ${esc(card.priority)}（独自の学習順で、出題確率ではありません）`}</p>` : `<p>重要度 <span class="stars">${'★'.repeat(card.importance)}</span>（${card.importance}/3） · 優先度 ${esc(card.priority)} · カードの分類 ${esc(card.classification)}</p><p class="field-note">K＝知識、R＝読解、KR＝両方。重要度・優先度・難易度・Levelは別の指標です。</p>`}</details> ${sources(card)}`}</section>` : `<div class="thinking-hint"><span aria-hidden="true">◎</span> ${card.questionType === 'term' ? '用語の名前や意味を、短く思い出してみましょう。' : '「答えること」を確認し、頭の中で答えてみましょう。'}</div>`}
    <div class="card-actions">${button('hide', 'この問題を非表示', 'button quiet')}${button(revealed ? 'next' : 'reveal', revealed ? `${reviewing ? `元の${session.index + 1}問目に戻る` : position === session.queue.length ? '結果を見る' : '次の問題へ'} <span aria-hidden="true">→</span>` : '答えを見る', 'button primary')}</div><p class="field-note">非表示はこのカードだけに適用され、一覧からいつでも戻せます。</p></section>`;
}

function result() {
  const ratings = Object.values(session.ratings);
  return `<section class="panel result-panel"><div class="completion-mark" aria-hidden="true">✓</div><p class="eyebrow">SESSION COMPLETE</p><h1>今日のひと積み、完了。</h1><p>覚えたことを、次の判断につなげましょう。</p><div class="result-stats"><div><strong>${session.completed}</strong><span>次へ進んだ問題</span></div><div><strong>${session.hidden}</strong><span>非表示にした問題</span></div></div><div class="confidence-results">${Object.entries(confidenceLabels).map(([value, label]) => `<div><strong>${ratings.filter(r => r === value).length}</strong><span>${label}</span></div>`).join('')}</div><p class="field-note">理解度は自己申告です。未選択 ${Math.max(0, session.completed - ratings.length)}問。正解数・正答率は推測しません。</p><div class="result-actions">${button('again', '同じ条件でもう一度 →', 'button primary')}${ratings.some(r => r !== 'understood') ? button('review-weak', 'わからない・知らないを復習', 'button secondary') : ''}${button('collection-home', '条件を変更する', 'button secondary')}</div></section>`;
}

function hidden() {
  const ids = hiddenIds();
  const cards = allCards().filter(c => ids.has(c.id));
  const unknown = ids.size - cards.length;
  return `<div class="page-heading"><p class="eyebrow">HIDDEN QUESTIONS</p><h1>非表示の問題</h1><p>覚えた問題はひと休み。必要になったら、また学習へ。</p></div><section class="panel"><div class="list-heading"><h2>${cards.length}問を非表示中</h2><span class="field-note">問題カードごとに保存</span></div>${unknown ? `<div class="notice">現在の教材にない問題IDが${unknown}件あります。保存状態は保持しています。</div>` : ''}${cards.length ? `<ul class="hidden-list">${cards.slice(0, hiddenLimit).map(c => `<li><div><span class="tiny-label">${esc(c.group.label)} · ${esc(c.shortCode)}</span><p>${esc(c.question)}</p><span class="field-note">${c.pastTerm ? '過去問の用語クイズ · 専用画面で出題' : c.prediction ? '予想問題 · 専用画面で出題' : `${!c.atom.verified ? '対応未確認 · ' : ''}${state().settings.enabledGroupIds.includes(c.group.id) ? '分野は有効' : '分野は無効'}`}</span></div>${button('restore', '復活する', 'button secondary', `data-id="${esc(c.id)}" aria-label="${esc(c.question)} を復活する"`)}</li>`).join('')}</ul>${cards.length > hiddenLimit ? button('more-hidden', 'さらに30問表示', 'button secondary') : ''}` : '<div class="empty-state"><span aria-hidden="true">◫</span><h3>非表示の問題はありません</h3><p>学習中の「非表示」で、覚えたカードを整理できます。</p><a href="#home">学習をはじめる →</a></div>'}<p class="field-note">復活しても、無効な分野や未確認OFFの設定は維持されます。</p></section>`;
}

function settings() {
  const groups = catalog.profile.groups;
  return `<div class="page-heading"><p class="eyebrow">LEARNING SETTINGS</p><h1>自分の範囲で、学ぶ。</h1><p>学習した分野を追加して、少しずつ広げましょう。</p></div><section class="panel settings-panel"><div class="list-heading"><h2>学習分野</h2><span class="save-indicator">${store.persistent ? '変更は自動保存' : 'この画面内で一時保存'}</span></div><p class="field-note">通常対象のカード数（原本と追加用語カード）を表示しています。非表示にしたカードはさらに除外されます。</p>${[true, false].map(initial => `<fieldset class="group-fieldset"><legend>${initial ? '基本の学習分野' : '追加して学ぶ分野'}</legend><div class="group-list">${groups.filter(g => g.defaultEnabled === initial).map(g => `<label class="group-choice"><input type="checkbox" data-group="${esc(g.id)}" ${state().settings.enabledGroupIds.includes(g.id) ? 'checked' : ''}><span>${esc(g.label.replace('追加学習：', ''))}</span><small>${catalog.cards.filter(c => c.group.id === g.id && c.defaultEnabled && c.atom.verified).length}問</small></label>`).join('')}</div></fieldset>`).join('')}</section>
    <section class="panel settings-panel"><h2>未確認の技術補充</h2><label class="supplement-choice"><input id="supplement" type="checkbox" ${state().settings.allowUnverifiedSupplement ? 'checked' : ''}><span>IPA設問対応が未確認の補充問題を含める</span></label><p class="field-note">RD・RT・DAI・IPSG・OSPF Type3・DHCPv6・IPv6 Packet Too Big・PMFの16問。出典確認済みには変わりません。有効な学習分野だけが対象です。</p></section>
    <section class="panel settings-panel"><h2>設定・非表示のバックアップ</h2><p>保存先は、このブラウザーと配信元URLです。別の端末やブラウザーへ移るときは、JSONを書き出して持ち運べます。</p><div class="backup-actions">${button('export', 'JSONをエクスポート', 'button secondary')}<label class="button secondary file-label">JSONをインポート<input id="import-file" type="file" accept=".json,application/json"></label></div><p class="field-note">2MBまで。読み込んだ内容を確認してから適用します。既存の問題IDの状態は同じIDだけ更新し、その他は保持します。現在のセッションの途中経過は含みません。</p>${pendingImport ? `<section class="import-preview"><h3>インポート内容の確認</h3><p>教材版：${esc(pendingImport.datasetVersion)}<br>有効分野：${pendingImport.settings.enabledGroupIds.length}件 / 非表示：${Object.values(pendingImport.questionStates).filter(s => s.hidden).length}件</p><p>分野と問題数は読み込んだ設定に置き換えます。同じ問題IDは読み込んだ状態を優先します。</p>${pendingImport.settings.allowUnverifiedSupplement ? '<label class="supplement-choice"><input id="import-supplement" type="checkbox">未確認の技術補充も有効にする</label>' : ''}<div class="backup-actions">${button('apply-import', 'この内容を適用する', 'button primary')}${button('cancel-import', '取り消す', 'button secondary')}</div></section>` : ''}</section>`;
}

function render(focus = false) {
  const activeId = document.activeElement?.id;
  const activeAction = document.activeElement?.dataset.action;
  if (!state().settings.enabledGroupIds.includes(filter.groupId)) filter.groupId = 'all';
  const screens = { home, predictions, 'past-terms': pastTerms, study, result, hidden, settings };
  app.innerHTML = shell(screens[view]());
  document.title = `${({ home: '学習をはじめる', predictions: '予想問題', 'past-terms': '過去問の用語クイズ', study: '学習中', result: '学習結果', hidden: '非表示の問題', settings: '学習設定' })[view]} | NWordBook`;
  if (focus) { document.querySelector('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  else if (activeAction) document.querySelector(`[data-action="${CSS.escape(activeAction)}"]`)?.focus({ preventScroll: true });
}

function navigate(page) {
  view = ['home', 'predictions', 'past-terms', 'hidden', 'settings'].includes(page) ? page : 'home';
  const collection = ['predictions', 'past-terms'].includes(view) ? view : 'exam';
  if (collection !== filter.collection) filter.review = 'all';
  filter.collection = collection;
  if (session && session.index < session.queue.length) message = '学習を中断しました。次回は新しい問題の組合せで開始します。';
  session = null;
  revealed = false;
  render(true);
}

function start() {
  const selected = selectStudyQuestions(candidates(), requestedCount(), filter.collection === 'past-terms' ? 'terms' : filter.collection === 'predictions' ? 'thinking' : filter.mode);
  if (!selected.length) { message = '条件に合う問題がありません。分野や非表示設定を見直してください。'; view = collectionHome(); render(true); return; }
  session = createSession(selected, filter, requestedCount());
  message = '';
  revealed = false;
  view = 'study';
  render(true);
}

app.addEventListener('click', event => {
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor) {
    event.preventDefault();
    const page = anchor.getAttribute('href').slice(1);
    if (page === 'main') { document.querySelector('#main').focus(); return; }
    if (location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);
    message = '';
    navigate(page);
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  message = '';
  if (action === 'start') return start();
  if (action === 'prediction-home') { navigate('predictions'); return; }
  if (action === 'collection-home' || action === 'interrupt') { navigate(collectionHome()); return; }
  if (action === 'home') { navigate('home'); return; }
  if (action.startsWith('preset-')) { filter.preset = action.slice(7); render(); return; }
  if (action.startsWith('mode-')) { filter.mode = action.slice(5); save({ ...state(), settings: { ...state().settings, studyMode: filter.mode } }); render(); return; }
  if (action.startsWith('count-')) { save({ ...state(), settings: { ...state().settings, [countSetting()]: action.slice(6) === 'all' ? 'all' : Number(action.slice(6)) } }); render(); return; }
  if (action === 'previous-question') { showSessionQuestion(Number(target.dataset.index)); return; }
  if (action === 'return-current') {
    if (!session || view !== 'study') return;
    rememberStudyView(); session = returnToCurrent(session); restoreStudyView(); return;
  }
  if (action === 'reveal') { revealed = true; render(); document.querySelector('.answer h3').setAttribute('tabindex', '-1'); document.querySelector('.answer h3').focus({ preventScroll: true }); return; }
  if (action.startsWith('rate-')) {
    if (!session || view !== 'study' || !revealed) return;
    const confidence = action.slice(5), id = session.queue[sessionViewIndex(session)];
    save(recordConfidence(state(), id, confidence));
    session = { ...session, ratings: { ...session.ratings, [id]: confidence } };
    const detailStates = [...document.querySelectorAll('.question-card details')].map(d => ({ name: d.className, open: d.open }));
    render();
    for (const detail of detailStates) document.querySelector(`.question-card details.${CSS.escape(detail.name)}`)?.toggleAttribute('open', detail.open);
    return;
  }
  if (action === 'hide' || action === 'next') {
    if (!session || view !== 'study') return;
    const wasReviewing = session.reviewIndex != null;
    rememberStudyView();
    if (action === 'hide') {
      const id = session.queue[sessionViewIndex(session)];
      save({ ...state(), questionStates: { ...state().questionStates, [id]: { ...state().questionStates[id], hidden: true } } });
      const ratings = { ...session.ratings }; delete ratings[id]; session = { ...session, ratings };
    }
    session = advanceSession(session, action, hiddenIds());
    if (wasReviewing) { restoreStudyView(); return; }
    revealed = false;
    if (session.index >= session.queue.length) view = 'result';
    render(true);
    return;
  }
  if (action === 'again') { filter = { ...session.filter }; start(); return; }
  if (action === 'review-weak') { filter = { ...session.filter, review: 'weak' }; start(); return; }
  if (action === 'restore') {
    const id = target.dataset.id;
    save({ ...state(), questionStates: { ...state().questionStates, [id]: { ...state().questionStates[id], hidden: false } } });
    message = '問題を復活しました。現在の学習分野・確認設定に従って出題されます。'; render(true); return;
  }
  if (action === 'more-hidden') { hiddenLimit += 30; render(); return; }
  if (action === 'export') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `nwordbook-state-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message = '現在の設定と問題の非表示状態を書き出しました。'; render(); return;
  }
  if (action === 'cancel-import') { pendingImport = null; render(); return; }
  if (action === 'apply-import' && pendingImport) {
    save(importState(state(), pendingImport, document.getElementById('import-supplement')?.checked === true));
    filter.mode = state().settings.studyMode || 'terms';
    filter.direction = state().settings.termDirection || 'both';
    pendingImport = null; message = '設定を読み込みました。既存の問題IDの状態も保持しています。'; render(true);
  }
});

app.addEventListener('change', async event => {
  const input = event.target;
  message = '';
  if (input.id === 'session-position') { showSessionQuestion(Number(input.value)); return; }
  if (input.id === 'past-term-year') { filter.pastTermYear = input.value; render(); return; }
  if (input.id === 'past-term-period') { filter.pastTermPeriod = input.value; render(); return; }
  if (input.id === 'prediction-scope') { filter.predictionScope = input.value; render(); return; }
  if (input.id === 'group') { filter.groupId = input.value; render(); }
  if (input.id === 'term-direction') { filter.direction = input.value; save({ ...state(), settings: { ...state().settings, termDirection: filter.direction } }); render(); }
  if (input.id === 'weak-only') { filter.review = input.checked ? 'weak' : 'all'; render(); }
  if (input.dataset.group) {
    const ids = new Set(state().settings.enabledGroupIds);
    if (input.checked) ids.add(input.dataset.group); else ids.delete(input.dataset.group);
    save({ ...state(), settings: { ...state().settings, enabledGroupIds: [...ids] } });
    // Update notices without replacing the checkbox that has keyboard focus.
    render(); document.querySelector(`[data-group="${CSS.escape(input.dataset.group)}"]`)?.focus({ preventScroll: true });
  }
  if (input.id === 'supplement') { save({ ...state(), settings: { ...state().settings, allowUnverifiedSupplement: input.checked } }); render(); }
  if (input.id === 'import-file') {
    try {
      const file = input.files[0]; if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) throw new Error('状態ファイルは2MB以下にしてください。');
      pendingImport = parseState(await file.text());
      message = 'ファイルを確認しました。内容を確認して「この内容を適用する」を押してください。';
    } catch (error) { pendingImport = null; message = error.message; }
    render(true);
  }
});

window.addEventListener('hashchange', () => { message = ''; navigate(location.hash.slice(1)); });

async function init() {
  try {
    const response = await fetch(new URL('../study-data/catalog.json', import.meta.url));
    if (!response.ok) throw new Error(`教材を取得できません（HTTP ${response.status}）。`);
    catalog = createCatalog(await response.json());
    allCards().forEach(c => cardsById.set(c.id, c));
    store = createStateStore(catalog);
    filter.mode = state().settings.studyMode || 'terms';
    filter.direction = state().settings.termDirection || 'both';
    navigate(location.hash.slice(1));
  } catch (error) {
    app.innerHTML = `<main id="main" class="loading"><p class="eyebrow">NWordBook</p><h1>教材を読み込めませんでした</h1><p>${esc(error.message)}</p><p>開発サーバーまたは配信URLから開き、通信を確認して再読込みしてください。</p><button class="button primary" id="reload">再読込みする</button></main>`;
    document.querySelector('#reload').addEventListener('click', () => location.reload());
  }
}
await init();
