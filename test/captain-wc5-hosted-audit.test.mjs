import assert from "node:assert/strict";
import test from "node:test";

import {
  auditCandidateDecisions,
  classifyHold,
} from "../scripts/audit-captain-wc5-hosted.mjs";

test("classifies a hold with only social and delete actions as explained", () => {
  const hold = classifyHold({
    turnNumber: 7400,
    reason: "rul:h0d",
    legalActionIDsByKind: {
      embargo: ["embargo:rival:start"],
      alliance_request: ["alliance:rival"],
      quick_chat: ["quick_chat:rival:misc.team_up"],
      delete_unit: ["delete_unit:1"],
      hold: ["hold"],
    },
  });
  assert.equal(hold.explained, true);
  assert.deepEqual(hold.tactical_kinds, []);
});

test("classifies a hold with a boat or build as unexplained", () => {
  assert.equal(
    classifyHold({
      legalActionIDsByKind: {
        boat: ["boat:123:8"],
        hold: ["hold"],
      },
    }).explained,
    false,
  );
  assert.equal(
    classifyHold({
      legalActionIDsByKind: {
        build: ["build:City:123"],
        hold: ["hold"],
      },
    }).explained,
    false,
  );
});

test("accepts an executed wc5 boat marker and reports clean runtime", () => {
  const audit = auditCandidateDecisions([
    {
      turnNumber: 1300,
      selectedLegalActionId: "boat:804503:8",
      selectedActionKind: "boat",
      reason: "rul:b0t:wc5",
      result: { accepted: true },
      fallbackUsed: false,
      llmPlannerDegraded: false,
      legalActionIDsByKind: {
        boat: ["boat:804503:8"],
        hold: ["hold"],
      },
    },
  ]);
  assert.equal(audit.decision_count, 1);
  assert.equal(audit.accepted_decision_count, 1);
  assert.equal(audit.marker_count, 1);
  assert.equal(audit.invalid_marker_count, 0);
  assert.equal(audit.unexplained_hold_count, 0);
});

test("rejects a degraded or unaccepted wc5 marker", () => {
  const audit = auditCandidateDecisions([
    {
      selectedLegalActionId: "boat:804503:8",
      selectedActionKind: "boat",
      reason: "rul:b0t:wc5",
      result: { accepted: false },
      fallbackUsed: false,
      llmPlannerDegraded: true,
    },
  ]);
  assert.equal(audit.marker_count, 1);
  assert.equal(audit.invalid_marker_count, 1);
  assert.equal(audit.rejected_decision_count, 1);
  assert.equal(audit.degraded_count, 1);
});
