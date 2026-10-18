export const EXAM_STORAGE_KEY = 'nwordbook:exam-answers:v1';
export const MAX_ANSWER_LENGTH = 10000;
export const MAX_EXAM_BACKUP_BYTES = 5 * 1024 * 1024;
export const periodLabel = period => period === 1 ? '午後Ⅰ' : '午後Ⅱ';
export const examLabel = (paper, question) => `${paper.year}年度 ${paper.session} ネットワークスペシャリスト ${periodLabel(paper.period)} 問${question.number}`;

export function validateExamCatalog(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.papers) || !data.papers.length) throw new Error('午後試験の教材形式が不正です。');
  const ids = new Set(), fields = new Set(), documents = new Set();
  for (const paper of data.papers) {
    if (!Number.isInteger(paper.year) || ![1, 2].includes(paper.period) || paper.id !== `${paper.year}-${paper.period}` || ids.has(paper.id)) throw new Error('午後試験の冊子IDが不正です。');
    ids.add(paper.id);
    if (paper.questions.length !== (paper.period === 1 ? 3 : 2)) throw new Error('大問数が一致しません。');
    if (paper.documents.length !== 3 || new Set(paper.documents.map(d => d.kind)).size !== 3) throw new Error('PDFの種類が一致しません。');
    for (const doc of paper.documents) {
      const url = new URL(doc.url);
      if (!doc.id || url.protocol !== 'https:' || url.hostname !== 'www.ipa.go.jp' || !/^[a-f0-9]{64}$/.test(doc.sha256) || doc.year !== paper.year || doc.period !== paper.period || !['problem', 'answer', 'commentary'].includes(doc.kind) || documents.has(doc.filename)) throw new Error('PDFの出典情報が不正です。');
      documents.add(doc.filename);
    }
    for (const [index, question] of paper.questions.entries()) {
      if (question.number !== index + 1 || !question.fields?.length) throw new Error('大問の構成が不正です。');
      for (const field of question.fields) {
        if (!field.id.startsWith(`${paper.year}/${paper.period}/${question.number}/`) || !field.label || !/^設問\d+$/.test(field.group) || fields.has(field.id)) throw new Error('回答欄のIDが不正です。');
        if (field.parts && (!Array.isArray(field.parts) || field.parts.some(p => typeof p !== 'string' || !p))) throw new Error('複合回答欄が不正です。');
        fields.add(field.id);
      }
    }
  }
  return data;
}

export function answerKeys(question) {
  return question.fields.flatMap(field => field.parts?.length ? field.parts.map((_, i) => `${field.id}#${i + 1}`) : [field.id]);
}

export function parseExamAnswers(raw, catalog) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_EXAM_BACKUP_BYTES) throw new Error('回答ファイルは5MB以下にしてください。');
  const data = JSON.parse(raw);
  if (data?.schemaVersion !== 1 || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) throw new Error('午後試験の回答ファイルではありません。');
  const valid = new Set(catalog.papers.flatMap(p => p.questions.flatMap(answerKeys)));
  const entries = Object.entries(data.answers);
  if (entries.some(([key, value]) => !valid.has(key) || typeof value !== 'string' || value.length > MAX_ANSWER_LENGTH)) throw new Error('対応していない設問ID、または長すぎる回答があります。');
  return { schemaVersion: 1, answers: Object.fromEntries(entries) };
}

export function createExamStore(catalog, getStorage = () => globalThis.localStorage) {
  let storage, persistent = true, notice = '', answers = {};
  try {
    storage = getStorage(); const raw = storage.getItem(EXAM_STORAGE_KEY);
    if (raw !== null) answers = parseExamAnswers(raw, catalog).answers;
  } catch {
    persistent = false; notice = '保存済みの回答を読み込めません。元の保存内容は上書きしません。回答は一時保存になるため、閉じる前にバックアップしてください。';
  }
  const valid = new Set(catalog.papers.flatMap(p => p.questions.flatMap(answerKeys)));
  const persist = () => {
    if (persistent) try { storage.setItem(EXAM_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, answers })); }
    catch { persistent = false; notice = '回答をブラウザーに保存できません。閉じる前に「回答をバックアップ」で保存してください。'; }
  };
  return {
    get answers() { return answers; }, get persistent() { return persistent; }, get notice() { return notice; },
    set(key, value) {
      if (!valid.has(key) || typeof value !== 'string' || value.length > MAX_ANSWER_LENGTH) throw new Error('回答を保存できません。');
      answers = { ...answers, [key]: value }; persist();
    },
    merge(data) { answers = { ...answers, ...parseExamAnswers(JSON.stringify(data), catalog).answers }; persist(); },
    export() { return JSON.stringify({ schemaVersion: 1, answers }, null, 2); },
  };
}

export function formatExamAnswers(paper, question, answers) {
  return `${examLabel(paper, question)}\n\n` + question.fields.map(field => {
    const entries = field.parts?.length ? field.parts.map((part, i) => [part, `${field.id}#${i + 1}`]) : [['', field.id]];
    return entries.map(([part, key]) => `${field.label}${part ? `［${part}］` : ''}${field.invalid ? '（公式の不備公表あり）' : ''}\n${answers[key]?.trim() || '（未回答）'}`).join('\n\n');
  }).join('\n\n');
}

export function parseExamSelection(hash, catalog) {
  const match = /^#?(\d{4})-([12])-([123])$/.exec(hash);
  const paper = match && catalog.papers.find(p => p.id === `${match[1]}-${match[2]}`);
  const question = paper?.questions.find(q => q.number === Number(match[3]));
  return question ? { paper, question } : { paper: catalog.papers[0], question: catalog.papers[0].questions[0] };
}

export async function identifyExamPdf(file, catalog, digest = bytes => globalThis.crypto.subtle.digest('SHA-256', bytes)) {
  if (!file || file.size > 32 * 1024 * 1024) throw new Error('PDFは1ファイル32MB以下にしてください。');
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error(`${file.name}: PDFではありません。`);
  const sha = [...new Uint8Array(await digest(bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const document = catalog.papers.flatMap(p => p.documents).find(d => d.sha256 === sha);
  if (!document) throw new Error(`${file.name}: 登録済みの公式PDFと内容が一致しません。別年度・変更済みのPDFでないか確認してください。`);
  return document;
}
