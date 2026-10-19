import { createExamEntries } from './exam-storage.js';
export const EXAM_STORAGE_KEY = 'nwordbook:exam-answers:v1';
export const MAX_ANSWER_LENGTH = 10000;
export const MAX_EXAM_BACKUP_BYTES = 5 * 1024 * 1024;
export const periodLabel = period => period === 1 ? '午後Ⅰ' : '午後Ⅱ';
export function examYearLabel(year) {
  const era = year >= 2019 ? '令和' : '平成';
  const eraYear = year >= 2019 ? year - 2018 : year - 1988;
  return `${era}${eraYear === 1 ? '元' : eraYear}年度`;
}
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
  if (data.answerLimits !== undefined) {
    const valid = new Set(data.papers.flatMap(p => p.questions.flatMap(answerKeys)));
    if (!data.answerLimits || typeof data.answerLimits !== 'object' || Array.isArray(data.answerLimits)) throw new Error('文字数制限の形式が不正です。');
    for (const [key, rule] of Object.entries(data.answerLimits)) {
      if (!valid.has(key) || !rule || (rule.max !== null && (!Number.isInteger(rule.max) || rule.max < 1 || rule.max > MAX_ANSWER_LENGTH)) || (rule.note !== undefined && (typeof rule.note !== 'string' || !rule.note || rule.note.length > 100)) || (rule.max === null && !rule.note)) throw new Error('文字数制限の回答欄・値が不正です。');
    }
  }
  return data;
}

export function answerLengthStatus(value, rule) {
  const count = [...value].length;
  const exceeded = rule?.max != null && count > rule.max;
  const text = rule?.max != null ? `${count}/${rule.max}字${exceeded ? '（上限超過）' : ''}` : `${count}字（${rule?.note || '字数指定なし'}）`;
  return { text, exceeded };
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
  const valid = new Set(catalog.papers.flatMap(p => p.questions.flatMap(answerKeys)));
  const entries = createExamEntries({ key: EXAM_STORAGE_KEY, valid, getStorage,
    decodeLegacy: raw => parseExamAnswers(raw, catalog).answers,
    validate: answers => parseExamAnswers(JSON.stringify({ schemaVersion: 1, answers }), catalog),
  });
  return {
    get answers() { return entries.entries; }, get persistent() { return entries.persistent; }, get notice() { return entries.notice; },
    refresh: entries.refresh,
    set(key, value) {
      if (!valid.has(key) || typeof value !== 'string' || value.length > MAX_ANSWER_LENGTH) throw new Error('回答を保存できません。');
      entries.write({ [key]: value });
    },
    merge(data) { entries.write(parseExamAnswers(JSON.stringify(data), catalog).answers); },
    export() { entries.refresh(); return JSON.stringify({ schemaVersion: 1, answers: entries.entries }, null, 2); },
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
