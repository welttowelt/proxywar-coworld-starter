import assert from "node:assert/strict";
import test from "node:test";

import {
  auditCaptainDecisions,
  classifyCaptainHold,
  compressCaptainReplay,
} from "../scripts/audit-captain-hosted.mjs";
import { gunzipSync } from "node:zlib";

test("generic Captain audit treats a tactical hold as unexplained", () => {
  const hold = classifyCaptainHold({
    turnNumber: 9000,
    selectedActionKind: "hold",
    legalActionIDsByKind: {
      boat: ["boat:123:8"],
      alliance_request: ["alliance:rival"],
      hold: ["hold"],
    },
  });
  assert.equal(hold.explained, false);
  assert.deepEqual(hold.tactical_kinds, ["boat"]);
});

test("generic Captain audit binds marker selection to WC6", () => {
  const audit = auditCaptainDecisions(
    [
      {
        turnNumber: 800,
        selectedLegalActionId: "boat:1003477:8",
        selectedActionKind: "boat",
        reason: "rul:b0t:wc6",
        result: { accepted: true },
        fallbackUsed: false,
        llmPlannerDegraded: false,
      },
      {
        turnNumber: 900,
        selectedLegalActionId: "boat:1003478:8",
        selectedActionKind: "boat",
        reason: "rul:b0t:wc5",
        result: { accepted: true },
        fallbackUsed: false,
        llmPlannerDegraded: false,
      },
    ],
    "wc6",
  );
  assert.equal(audit.decision_count, 2);
  assert.equal(audit.accepted_decision_count, 2);
  assert.equal(audit.marker_count, 1);
  assert.equal(audit.invalid_marker_count, 0);
});

test("generic Captain audit rejects degraded, rejected, or parsed-failure markers", () => {
  const audit = auditCaptainDecisions(
    [
      {
        selectedLegalActionId: "boat:1003477:8",
        selectedActionKind: "boat",
        reason: "rul:b0t:wc6",
        result: { accepted: false },
        fallbackUsed: true,
        llmPlannerDegraded: true,
        parseFailure: true,
      },
    ],
    "wc6",
  );
  assert.equal(audit.marker_count, 1);
  assert.equal(audit.invalid_marker_count, 1);
  assert.equal(audit.rejected_decision_count, 1);
  assert.equal(audit.fallback_count, 1);
  assert.equal(audit.degraded_count, 1);
  assert.equal(audit.parse_failure_count, 1);
});

test("generic Captain audit retains replay bytes in a compact deterministic envelope", () => {
  const raw = Buffer.from('{"replay":"captain"}\n'.repeat(100));
  const compressed = compressCaptainReplay(raw);
  assert.deepEqual(gunzipSync(compressed), raw);
  assert.ok(compressed.length < raw.length);
});
