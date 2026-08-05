import { defineEvalConfig } from "eve/evals";

/**
 * Defaults for every eval here. Deliberately bare: these are smoke evals asserting
 * BOOLEAN facts about a run — which tools were called, which were not, what the reply
 * contains — so none of them needs a judge model to grade prose.
 *
 * Add `judge: { model: … }` when an eval starts grading tone or explanation quality.
 */
export default defineEvalConfig({});
