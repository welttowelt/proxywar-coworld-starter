import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hostedPath = new URL(
  "../scripts/audit-odc1-rci2-hosted.py",
  import.meta.url,
).pathname;
const semanticPath = new URL("../scripts/audit-odc1-pair.py", import.meta.url).pathname;

function runPython(body) {
  const prelude = `
import importlib.util
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
h = load("hosted", ${JSON.stringify(hostedPath)})
s = load("semantic", ${JSON.stringify(semanticPath)})
registry, errors = s.build_identity_registry({"coalition": h.COALITION}, [])
assert not errors, errors
`;
  const result = spawnSync("python3", ["-c", `${prelude}\n${body}`], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("hosted audit treats submitted harmful identity as authoritative", () => {
  runPython(`
missing = {
  "turnNumber": 1,
  "selectedActionKind": "attack",
  "selectedActionMetadata": {"targetID": h.ODIN_PLAYER_ID},
  "result": {"submittedIntent": {"type": "attack"}},
}
conflicts, harm, unresolved = h.audit_submitted_execution([missing], registry, s)
assert not conflicts and not harm and unresolved

neutral = {
  "turnNumber": 2,
  "selectedLegalActionId": "expand:terra-nullius:35",
  "selectedActionKind": "attack",
  "selectedActionMetadata": {
    "targetID": None,
    "targetName": "Terra Nullius",
    "expansion": True,
  },
  "result": {
    "submittedIntent": {"type": "attack", "targetID": None, "troops": 35000}
  },
}
conflicts, harm, unresolved = h.audit_submitted_execution([neutral], registry, s)
assert not conflicts and not harm and not unresolved

partner = h.COALITION["identities"][1]["player_id"]
executed = {
  "turnNumber": 3,
  "selectedActionKind": "attack",
  "selectedActionMetadata": {"targetID": partner},
  "result": {"submittedIntent": {"type": "attack", "targetID": partner}},
}
conflicts, harm, unresolved = h.audit_submitted_execution([executed], registry, s)
assert not conflicts and harm and not unresolved
assert harm[0]["target_role"] == "katanasan"

targeted = {
  "turnNumber": 4,
  "selectedActionKind": "target_player",
  "result": {
    "submittedIntent": {"type": "targetPlayer", "target": "outsider-player-id"}
  },
}
conflicts, harm, unresolved = h.audit_submitted_execution([targeted], registry, s)
assert not conflicts and not harm and not unresolved
`);
});

test("hosted audit detects location conflicts and normalizes hold kinds", () => {
  runPython(`
rows = [
  {
    "turnNumber": 3,
    "selectedActionKind": "nuke",
    "selectedActionMetadata": {"targetTile": 111},
    "result": {"submittedIntent": {"type": "nuke", "tile": 222}},
  },
  {
    "turnNumber": 4,
    "selectedActionKind": "boat",
    "selectedActionMetadata": {"targetTile": 111},
    "result": {"submittedIntent": {"type": "boat", "dst": 222}},
  },
]
for row in rows:
    conflicts, _, _ = h.audit_submitted_execution([row], registry, s)
    assert conflicts
    assert "selected and submitted target locations differ" in conflicts[0]["reasons"]
assert h.normalized_kind("Hold") == "hold"
assert h.normalized_kind("HOLD") == "hold"
`);
});
