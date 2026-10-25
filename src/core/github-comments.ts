import { validIdentifier } from './intake.js';

export type PlanComment =
  | { kind: 'plan'; revision: string; policyRevision: string; summary: string }
  | { kind: 'clarification'; revision: string; question: string }
  | { kind: 'rejection'; revision: string; reason: string };

const limit = (value: string, max: number): string => {
  if (!value || value.length > max || value.includes('\u0000')) throw new Error('Comment content is outside the allowed bounds.');
  return value;
};

export function formatPlanComment(comment: PlanComment): string {
  const revision = validIdentifier(comment.revision);
  if (comment.kind === 'plan') {
    return `Agentic Factory plan proposal\nRevision: ${revision}\nPolicy revision: ${validIdentifier(comment.policyRevision)}\n\n${limit(comment.summary, 4000)}\n\nOwner action: approve this exact revision through the authenticated control path.`;
  }
  if (comment.kind === 'clarification') return `Agentic Factory clarification\nRevision: ${revision}\n\n${limit(comment.question, 2000)}`;
  return `Agentic Factory plan rejected\nRevision: ${revision}\n\n${limit(comment.reason, 2000)}`;
}
