import { readDataset } from './data.mjs';
import { createCatalog } from '../src/domain.js';
import { findQuestionByCode } from '../src/question-codes.js';

const card = findQuestionByCode(createCatalog(await readDataset()), process.argv[2]);
if (!card) {
  console.error('問題が見つかりません。例: node scripts/find-question.mjs Q001（予想問題P01・過去問の用語T001）');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    code: card.shortCode, questionId: card.id, collection: card.pastTerm ? '過去問の用語' : card.prediction ? '予想問題' : '通常問題',
    category: card.group.label, context: card.context, question: card.question, answer: card.answer,
    explanation: card.explanation, detailSections: card.detailSections, caution: card.atom.commonTrap,
    answerFocus: card.answerFocus, thinkingTrigger: card.thinkingTrigger || card.atom.thinkingTrigger,
    sourceRefs: card.sourceRefs, source: card.source, technicalSources: card.technicalSources,
  }, null, 2));
}
