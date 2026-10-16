import { createCatalog, eligibleCards, selectStudyQuestions, createSession, advanceSession, recordConfidence, parseState, importState, safeUrl, sourceLabel, MAX_IMPORT_BYTES } from './domain.js';
import { createStateStore } from './storage.js';

// Only escaped text enters templates. Source content is never interpreted as HTML.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = document.querySelector('#app');
const typeLabels = { term: '用語', mechanism: '仕組み', case: '構成・判断', change: '構成変更', failure: '障害' };
const confidenceLabels = { understood: 'わかった', unclear: 'わからない', unknown: '知らない' };
const confidenceHints = { understood: '意味・理由を説明できる', unclear: '解説を見ても理解できない', unknown: '初めて知った・覚えていない' };
const modeLabels = { terms: '用語を覚える', thinking: '仕組み・判断', mixed: '両方を学ぶ' };
const relationLabels = { generalized_from_subquestion: '設問から一般化', prerequisite: '設問群の前提', problem_body_prerequisite: '本文の前提', related_prerequisite_only: '関連する前提', candidate_without_ipa_exam_mapping: '対応未確認の補充' };
let catalog, store, view = 'home', session = null, revealed = false, message = '', pendingImport = null, hiddenLimit = 30;
let filter = { groupId: 'all', preset: 'all', mode: 'terms', direction: 'both', review: 'all' };
const state = () => store.state;
const save = next => store.save(next);
const cardsById = new Map();
const hiddenIds = () => new Set(Object.entries(state().questionStates).filter(([, s]) => s.hidden).map(([id]) => id));
const candidates = () => eligibleCards(catalog, state(), filter);
const button = (action, label, cls = 'button', attrs = '') => `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;

function shell(content) {
  const inStudy = view === 'study';
  return `<header class="header"><div class="header-inner"><a class="brand" href="#home" aria-label="NWordBook ホーム"><span class="brand-mark" aria-hidden="true">N<span>↗</span></span><span>NWordBook<small>NETWORK SPECIALIST</small></span></a><span class="edition">午後対策 / SHORT STUDY</span></div></header>
    <div class="app-layout"><aside class="sidebar"><p class="nav-caption">MY STUDY</p><nav aria-label="メインメニュー">${inStudy ? button('interrupt', '← 中断して戻る', 'nav-item') : ['home', 'hidden', 'settings'].map((page, i) => `<a class="nav-item ${view === page ? 'active' : ''}" href="#${page}" ${view === page ? 'aria-current="page"' : ''}><span aria-hidden="true">${['▤', '◫', '⚙'][i]}</span>${['学習をはじめる', '非表示の問題', '学習設定'][i]}${page === 'hidden' ? `<span class="nav-count">${hiddenIds().size}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-note"><span class="tiny-label">ONE QUESTION AT A TIME</span><p>知識をつなぐ。<br>判断する力にする。</p><span>用語から、構成変更の理由まで。</span></div><p class="local-label"><span class="status-dot"></span>${store.persistent ? 'このブラウザーに保存' : '一時保存モード'}</p></aside>
    <main id="main" tabindex="-1">${store.notice ? `<div class="notice warning" role="status">${esc(store.notice)}</div>` : ''}<div id="feedback" role="status" aria-live="polite">${message ? `<div class="notice">${esc(message)}</div>` : ''}</div>${content}<footer>IPAの過去問から一般化した独自編集の短問です。IPAの公式・監修教材ではありません。<br><span>教材 ${esc(catalog.manifest.datasetVersion)} · NWordBook v0.2</span></footer></main></div>`;
}

function home() {
  const available = candidates();
  const normalCount = catalog.questions.filter(c => c.defaultEnabled).length;
  const enabledGroups = catalog.profile.groups.filter(g => state().settings.enabledGroupIds.includes(g.id));
  const count = state().settings.questionCount;
  return `<section class="hero"><div><p class="eyebrow"><span class="little-line"></span> NETWORK SPECIALIST / 午後Ⅰ・Ⅱ</p><h1>午後につながる、<br><span>ひと問。</span></h1><p class="hero-copy">通信の仕組みから、設定を変える理由まで。<br>すきま時間に、考える練習を。</p></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-node node-a">知識</div><div class="art-node node-b">仕組み</div><div class="art-node node-c">判断<span>→</span></div><div class="art-dot dot-a"></div><div class="art-dot dot-b"></div><span class="art-caption">CONNECT THE KNOWLEDGE</span></div></section>
    <section class="stats" aria-label="学習データ"><div><span>出題できる問題</span><strong>${available.length}<small> 問</small></strong></div><div><span>有効な学習分野</span><strong>${enabledGroups.length}<small> / ${catalog.profile.groups.length}</small></strong></div><div><span>非表示にした問題</span><strong>${hiddenIds().size}<small> 問</small></strong></div></section>
    <div class="home-columns"><section class="panel study-setup"><div class="section-title"><span class="step-number">01</span><div><p class="eyebrow">SET YOUR SESSION</p><h2>今日の学習を決める</h2></div><span class="small-badge">入力なし・タップで完結</span></div>
    <fieldset><legend>学び方</legend><div class="mode-options">${Object.entries(modeLabels).map(([mode, label]) => button(`mode-${mode}`, label, filter.mode === mode ? 'segment selected' : 'segment', `aria-pressed="${filter.mode === mode}"`)).join('')}</div><p class="field-note">${filter.mode === 'terms' ? '単語帳のように、用語の名前と意味・役割を覚えます。' : filter.mode === 'thinking' ? '構成や条件を読み、動作・理由・対処を答える練習です。' : '候補があれば、用語問題と考える問題をおよそ半分ずつ出します。'}</p></fieldset>
    ${filter.mode === 'terms' ? `<label class="field-label" for="term-direction">用語カードの向き</label><select id="term-direction"><option value="both" ${filter.direction === 'both' ? 'selected' : ''}>両方を混ぜる</option><option value="meaning" ${filter.direction === 'meaning' ? 'selected' : ''}>用語 → 意味・役割</option><option value="name" ${filter.direction === 'name' ? 'selected' : ''}>説明 → 用語名</option></select>` : ''}
    <label class="review-choice"><input id="weak-only" type="checkbox" ${filter.review === 'weak' ? 'checked' : ''}><span>「わからない」「知らない」だけを復習</span></label>
    <fieldset><legend>学習範囲</legend><div class="segmented">${button('preset-all', '有効な分野すべて', filter.preset === 'all' ? 'segment selected' : 'segment', `aria-pressed="${filter.preset === 'all'}"`)}${button('preset-first100', 'まず覚える100', filter.preset === 'first100' ? 'segment selected' : 'segment', `aria-pressed="${filter.preset === 'first100'}"`)}</div><p class="field-note">${filter.preset === 'first100' ? '優先度Aの100知識を対象に、現在の分野・非表示設定で絞り込みます。100問固定ではありません。' : '設定で有効にした分野だけが出題されます。'}</p></fieldset>
    <label class="field-label" for="group">分野</label><select id="group"><option value="all">全分野ランダム</option>${enabledGroups.map(g => `<option value="${esc(g.id)}" ${filter.groupId === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
    <fieldset><legend>問題数</legend><div class="count-options">${[5, 10, 20].map(n => button(`count-${n}`, `<strong>${n}</strong><span>問</span>${n === 10 ? '<small>おすすめ</small>' : ''}`, n === count ? 'count-option selected' : 'count-option', `aria-pressed="${n === count}"`)).join('')}</div></fieldset>
    <div class="session-summary"><span>今回の出題</span><strong>${Math.min(count, available.length)}問 <span>/ 候補 ${available.length}問</span></strong></div>
    ${available.length < count ? `<p class="shortage" role="status">${available.length === 0 ? (filter.review === 'weak' ? 'この条件で「わからない」「知らない」を記録した問題はありません。復習のチェックを外すか、学び方・分野を変更してください。' : '出題候補がありません。学び方・分野・非表示設定を確認してください。') : `条件に合う問題が${available.length}問のため、その件数で開始します。学び方・分野・復習・非表示・未確認設定で絞り込んでいます。`}</p><div class="inline-links"><a href="#settings">学習分野を見直す</a><a href="#hidden">非表示一覧へ</a></div>` : ''}
    ${button('start', `学習をはじめる <span aria-hidden="true">→</span>`, 'button primary start-button', available.length ? '' : 'disabled')}<p class="below-button">答えは頭の中で。自分のペースで進めましょう。</p></section>
    <aside class="home-notes"><section class="tip-card"><p class="eyebrow">HOW TO STUDY</p><h2>用語を覚える。<br>仕組みを理解する。</h2><ol><li><span>01</span><div><strong>答える対象を確認</strong><p>用語名か、意味か、理由かを確認。</p></div></li><li><span>02</span><div><strong>答えと比べる</strong><p>頭の中で答えてから解答を開く。</p></div></li><li><span>03</span><div><strong>理解度を記録</strong><p>わからない・知らない問題は後で復習。</p></div></li></ol></section><section class="data-note"><span class="tiny-label">YOUR QUESTION BANK</span><p><strong>${catalog.cards.length}</strong> 枚のカード</p><p>原本${catalog.questions.length}問（出典確認済み${normalCount}問）に、${catalog.editorial?.terms.length || 0}用語・${catalog.cards.filter(c => c.editorialAdded).length}枚を追加。未確認補充は初期OFFです。</p><a href="#settings">学習分野を設定する <span aria-hidden="true">↗</span></a></section></aside></div>`;
}

function confidenceControls(card) {
  const selected = session.ratings[card.id];
  return `<section class="confidence-panel" aria-label="理解度の記録"><h3>答えを見て、どうでしたか？</h3><p>選んでも次へは進みません。解説を読み直して変更できます。</p><div class="confidence-options">${Object.entries(confidenceLabels).map(([value, label]) => button(`rate-${value}`, `<strong>${label}</strong><small>${confidenceHints[value]}</small>`, `confidence-button ${selected === value ? 'selected' : ''}`, `aria-pressed="${selected === value}"`)).join('')}</div><p class="confidence-status" role="status">${selected ? `「${confidenceLabels[selected]}」を記録しました。` : '記録は任意です。未選択でも次へ進めます。'}${!selected && state().questionStates[card.id]?.confidence ? ` 前回：${confidenceLabels[state().questionStates[card.id].confidence]}` : ''}</p></section>`;
}

function sources(card) {
  return `<details class="sources"><summary>出典と根拠を確認する <span>${card.sourceRefs.length}件</span></summary><p class="field-note">${card.editorialAdded ? '既存知識から編集した追加用語カードです。以下は元の知識の根拠であり、このカード自体のIPA出題を確認したものではありません。' : '独自編集の短問です。'}出題趣旨は公式の解答例PDFに含まれます。</p>${card.sourceRefs.map(source => `<article class="source-item"><strong>${esc(sourceLabel(source))}</strong><p>${esc(relationLabels[source.relationship] || source.relationship)} · ${source.countedForFrequency ? '直接出題回数に算入' : '直接出題回数には含めない'}${source.classification ? ` · 原問の分類 ${esc(source.classification)}` : ''}</p>${source.note ? `<p>${esc(source.note)}</p>` : ''}<div class="inline-links">${[['officialProblemUrl', '公式問題'], ['officialAnswerUrl', '公式解答例・出題趣旨'], ['officialCommentaryUrl', '公式採点講評']].map(([key, label]) => { const url = safeUrl(source[key]); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : ''; }).join('')}</div></article>`).join('')}<p class="field-note">知識の確認済み頻度：原設問 ${card.atom.frequency.subQuestionCount}件 / 大問 ${card.atom.frequency.majorQuestionCount}件 / 試験回 ${card.atom.frequency.examSessionCount}回。カード枚数とは異なります。</p></details>`;
}

function study() {
  const card = cardsById.get(session.queue[session.index]);
  const position = session.index + 1;
  const isDiagram = /[┌┐└┘│─]|\+[-+]{2,}|\[.+\].*(?:--|→|->).+\[/.test(card.question);
  return `<div class="study-top"><div><p class="eyebrow">SHORT STUDY</p><h1>ひとつずつ、理解する。</h1></div><span class="progress-label">${position}<span> / ${session.queue.length} 問</span></span></div><progress value="${session.index}" max="${session.queue.length}" aria-label="学習の進捗"></progress>
    <section class="panel question-card"><div class="card-meta"><span class="category-pill">${esc(card.group.label)}</span><span>${esc(typeLabels[card.questionType])}${card.questionType === 'term' ? ` · ${card.termDirection === 'meaning' ? '用語 → 意味' : '説明 → 用語'}` : ''} · 難易度 ${card.difficulty}/3${card.level ? ` · Level ${card.level}` : ''}</span></div>${!card.atom.verified ? '<p class="unverified-label">IPA設問対応未確認の技術補充</p>' : ''}<p class="question-number">QUESTION ${String(position).padStart(2, '0')}</p><h2 class="question-text ${isDiagram ? 'diagram' : ''}">${esc(card.question)}</h2><div class="answer-guide"><strong>答えること</strong><p>${esc(card.answerFocus)}</p></div>
    ${revealed ? `<section class="answer" aria-label="解答と解説"><p class="eyebrow">ANSWER</p><h3>${esc(card.answer)}</h3>${confidenceControls(card)}<details class="explanation-details" ${card.questionType === 'term' ? '' : 'open'}><summary>解説と、午後につながる考え方</summary><p class="explanation">${esc(card.explanation)}</p><div class="trigger"><span aria-hidden="true">↳</span><div><strong>午後につながる思考トリガー</strong><p>${esc(card.thinkingTrigger || card.atom.thinkingTrigger)}</p></div></div></details><details class="more-details"><summary>間違えやすい点・学習の目安</summary><p class="explanation">${esc(card.atom.commonTrap)}</p><p>重要度 <span class="stars">${'★'.repeat(card.importance)}</span>（${card.importance}/3） · 優先度 ${esc(card.priority)} · カードの分類 ${esc(card.classification)}</p><p class="field-note">K＝知識、R＝読解、KR＝両方。重要度・優先度・難易度・Levelは別の指標です。</p></details> ${sources(card)}</section>` : `<div class="thinking-hint"><span aria-hidden="true">◎</span> ${card.questionType === 'term' ? '用語の名前や意味を、短く思い出してみましょう。' : '「答えること」を確認し、頭の中で答えてみましょう。'}</div>`}
    <div class="card-actions">${button('hide', 'この問題を非表示', 'button quiet')}${button(revealed ? 'next' : 'reveal', revealed ? `${position === session.queue.length ? '結果を見る' : '次の問題へ'} <span aria-hidden="true">→</span>` : '答えを見る', 'button primary')}</div><p class="field-note">非表示はこのカードだけに適用され、一覧からいつでも戻せます。</p></section>`;
}

function result() {
  const ratings = Object.values(session.ratings);
  return `<section class="panel result-panel"><div class="completion-mark" aria-hidden="true">✓</div><p class="eyebrow">SESSION COMPLETE</p><h1>今日のひと積み、完了。</h1><p>覚えたことを、次の判断につなげましょう。</p><div class="result-stats"><div><strong>${session.completed}</strong><span>次へ進んだ問題</span></div><div><strong>${session.hidden}</strong><span>非表示にした問題</span></div></div><div class="confidence-results">${Object.entries(confidenceLabels).map(([value, label]) => `<div><strong>${ratings.filter(r => r === value).length}</strong><span>${label}</span></div>`).join('')}</div><p class="field-note">理解度は自己申告です。未選択 ${Math.max(0, session.completed - ratings.length)}問。正解数・正答率は推測しません。</p><div class="result-actions">${button('again', '同じ条件でもう一度 →', 'button primary')}${ratings.some(r => r !== 'understood') ? button('review-weak', 'わからない・知らないを復習', 'button secondary') : ''}${button('home', '条件を変更する', 'button secondary')}</div></section>`;
}

function hidden() {
  const ids = hiddenIds();
  const cards = catalog.cards.filter(c => ids.has(c.id));
  const unknown = ids.size - cards.length;
  return `<div class="page-heading"><p class="eyebrow">HIDDEN QUESTIONS</p><h1>非表示の問題</h1><p>覚えた問題はひと休み。必要になったら、また学習へ。</p></div><section class="panel"><div class="list-heading"><h2>${cards.length}問を非表示中</h2><span class="field-note">問題カードごとに保存</span></div>${unknown ? `<div class="notice">現在の教材にない問題IDが${unknown}件あります。保存状態は保持しています。</div>` : ''}${cards.length ? `<ul class="hidden-list">${cards.slice(0, hiddenLimit).map(c => `<li><div><span class="tiny-label">${esc(c.group.label)}</span><p>${esc(c.question)}</p><span class="field-note">${!c.atom.verified ? '対応未確認 · ' : ''}${state().settings.enabledGroupIds.includes(c.group.id) ? '分野は有効' : '分野は無効'}</span></div>${button('restore', '復活する', 'button secondary', `data-id="${esc(c.id)}" aria-label="${esc(c.question)} を復活する"`)}</li>`).join('')}</ul>${cards.length > hiddenLimit ? button('more-hidden', 'さらに30問表示', 'button secondary') : ''}` : '<div class="empty-state"><span aria-hidden="true">◫</span><h3>非表示の問題はありません</h3><p>学習中の「非表示」で、覚えたカードを整理できます。</p><a href="#home">学習をはじめる →</a></div>'}<p class="field-note">復活しても、無効な分野や未確認OFFの設定は維持されます。</p></section>`;
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
  const screens = { home, study, result, hidden, settings };
  app.innerHTML = shell(screens[view]());
  document.title = `${({ home: '学習をはじめる', study: '学習中', result: '学習結果', hidden: '非表示の問題', settings: '学習設定' })[view]} | NWordBook`;
  if (focus) { document.querySelector('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  else if (activeAction) document.querySelector(`[data-action="${CSS.escape(activeAction)}"]`)?.focus({ preventScroll: true });
}

function navigate(page) {
  view = ['home', 'hidden', 'settings'].includes(page) ? page : 'home';
  if (session && session.index < session.queue.length) message = '学習を中断しました。次回は新しい問題の組合せで開始します。';
  session = null;
  revealed = false;
  render(true);
}

function start() {
  const selected = selectStudyQuestions(candidates(), state().settings.questionCount, filter.mode);
  if (!selected.length) { message = '条件に合う問題がありません。分野や非表示設定を見直してください。'; view = 'home'; render(true); return; }
  session = createSession(selected, filter, state().settings.questionCount);
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
  if (action === 'home' || action === 'interrupt') { navigate('home'); return; }
  if (action.startsWith('preset-')) { filter.preset = action.slice(7); render(); return; }
  if (action.startsWith('mode-')) { filter.mode = action.slice(5); save({ ...state(), settings: { ...state().settings, studyMode: filter.mode } }); render(); return; }
  if (action.startsWith('count-')) { save({ ...state(), settings: { ...state().settings, questionCount: Number(action.slice(6)) } }); render(); return; }
  if (action === 'reveal') { revealed = true; render(); document.querySelector('.answer h3').setAttribute('tabindex', '-1'); document.querySelector('.answer h3').focus({ preventScroll: true }); return; }
  if (action.startsWith('rate-')) {
    if (!session || view !== 'study' || !revealed) return;
    const confidence = action.slice(5), id = session.queue[session.index];
    save(recordConfidence(state(), id, confidence));
    session = { ...session, ratings: { ...session.ratings, [id]: confidence } };
    const detailStates = [...document.querySelectorAll('.question-card details')].map(d => ({ name: d.className, open: d.open }));
    render();
    for (const detail of detailStates) document.querySelector(`.question-card details.${CSS.escape(detail.name)}`)?.toggleAttribute('open', detail.open);
    return;
  }
  if (action === 'hide' || action === 'next') {
    if (!session || view !== 'study') return;
    if (action === 'hide') {
      const id = session.queue[session.index];
      save({ ...state(), questionStates: { ...state().questionStates, [id]: { ...state().questionStates[id], hidden: true } } });
      const ratings = { ...session.ratings }; delete ratings[id]; session = { ...session, ratings };
    }
    session = advanceSession(session, action, hiddenIds());
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
    catalog.cards.forEach(c => cardsById.set(c.id, c));
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
