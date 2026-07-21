import {
  chooseHrafnAction,
  publicHrafnReason,
  recordHrafnDecision,
} from "./hrafn-strategy.mjs";

const HRAFN_REASON_NAMESPACE = "[K1Z] r4vn:";

export const HRAFN_NEUTRAL_REASON_NAMESPACE = "[0UT] v5:";

export function chooseNeutralOpponentAction(
  actions,
  observation,
  history,
  { rv1Enabled = true } = {},
) {
  const chosen = chooseHrafnAction(actions, observation, history, {
    rv1Enabled,
    exactV5: true,
  });
  recordHrafnDecision(history, chosen, observation);
  return chosen;
}

export function publicNeutralOpponentReason(action) {
  const original = publicHrafnReason(action);
  if (!original.startsWith(HRAFN_REASON_NAMESPACE)) {
    throw new Error("exact-v5 reason namespace drifted");
  }
  return `${HRAFN_NEUTRAL_REASON_NAMESPACE}${original.slice(HRAFN_REASON_NAMESPACE.length)}`;
}
