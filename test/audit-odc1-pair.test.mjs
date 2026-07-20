import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const modulePath = new URL("../scripts/audit-odc1-pair.py", import.meta.url).pathname;

function runPython(body) {
  const prelude = `
import importlib.util
spec = importlib.util.spec_from_file_location("audit_odc1_pair", ${JSON.stringify(modulePath)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;
  const result = spawnSync("python3", ["-c", `${prelude}\n${body}`], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("ODC1 auditor recognizes the persisted llmPlannerDegraded field", () => {
  runPython(`
assert m.planner_degraded({"llmPlannerDegraded": True})
assert not m.planner_degraded({"llmPlannerDegraded": False, "fallbackUsed": False})
`);
});

test("ODC1 parent route check ignores shared coalition markers", () => {
  runPython(`
rows = [
  {"policyMarker": "kp2"},
  {"policyMarkers": ["nk1", "kp2"]},
  {"policyMarkers": ["kp2", "odec1"]},
]
assert m.marked_row_count(rows, {"odec1", "odec2"}) == 1
assert m.marked_row_count(rows[:2], {"odec1", "odec2"}) == 0
`);
});

test("ODC1 auditor resolves tagged names, untagged names, and runtime IDs", () => {
  runPython(`
contract = {
  "coalition": {
    "identities": [
      {"role": "odin", "names": ["K1Z odin free"], "player_id": "ply_odin"},
      {"role": "hrafn", "names": ["Hrafn"], "player_id": "ply_hrafn"},
    ]
  }
}
rows = [
  {"username": "K1Z odin free", "auditBefore": {"playerID": "runtime_odin"}},
  {"username": "K1Z Hrafn", "auditBefore": {"playerID": "runtime_hrafn"}},
]
registry, errors = m.build_identity_registry(contract, rows)
assert not errors
assert m.role_for_name("Hrafn", registry) == "hrafn"
assert m.role_for_name("K1Z Hrafn", registry) == "hrafn"
assert m.role_for_id("runtime_hrafn", registry) == "hrafn"
assert m.role_for_id("ply_hrafn", registry) == "hrafn"
duplicate = {
  "coalition": {
    "identities": [
      {"role": "odin", "names": ["odin free"], "player_id": "shared"},
      {"role": "hrafn", "names": ["odin free"], "player_id": "shared"},
    ]
  }
}
_, errors = m.build_identity_registry(duplicate, [])
assert "coalition name alias 'odin free' is shared by hrafn, odin" in errors
assert "coalition id alias 'shared' is shared by hrafn, odin" in errors
`);
});

test("ODC1 auditor catches actual harmful kinds and production Atom Bomb metadata", () => {
  runPython(`
contract = {
  "coalition": {
    "actor_role": "odin",
    "identities": [
      {"role": "odin", "names": ["odin free"], "player_id": "odin"},
      {"role": "katanasan", "names": ["katanasan"], "player_id": "kata"},
    ],
    "endgame_exception": {
      "enabled": True,
      "marker": "odwin",
      "allowed_kinds": ["attack"],
      "evidence_field": "k1zOnlyEndgame",
    },
  }
}
registry, errors = m.build_identity_registry(contract, [])
assert not errors
rows = [
  {"turnNumber": 1, "selectedActionKind": "break_alliance",
   "selectedLegalActionId": "break_alliance:kata"},
  {"turnNumber": 2, "selectedActionKind": "embargo",
   "selectedLegalActionId": "embargo:kata"},
  {"turnNumber": 3, "selectedActionKind": "build",
   "selectedLegalActionId": "build:atom:1",
   "selectedActionMetadata": {"unit": "Atom Bomb", "targetName": "K1Z katanasan"}},
]
harm, exemptions, unresolved = m.scan_candidate_harm(rows, contract, registry)
assert [item["kind"] for item in harm] == ["break_alliance", "embargo", "nuke"]
assert not exemptions
assert not unresolved
`);
});

test("ODC1 never lets expansion metadata disguise a K1Z target", () => {
  runPython(`
contract = {
  "coalition": {
    "actor_role": "odin",
    "identities": [
      {"role": "odin", "names": ["odin free"], "player_id": "odin"},
      {"role": "katanasan", "names": ["katanasan"], "player_id": "kata"},
    ],
    "endgame_exception": {"enabled": False},
  }
}
registry, errors = m.build_identity_registry(contract, [])
assert not errors
row = {
  "turnNumber": 7,
  "selectedActionKind": "attack",
  "selectedLegalActionId": "attack:kata:25",
  "selectedActionMetadata": {
    "expansion": True,
    "targetID": "kata",
    "targetName": "K1Z katanasan",
  },
}
harm, exemptions, unresolved = m.scan_candidate_harm([row], contract, registry)
assert len(harm) == 1
assert harm[0]["target_role"] == "katanasan"
assert not exemptions
assert not unresolved
`);
});

test("ODC1 K1Z-only finish exception requires marker and survivor proof", () => {
  runPython(`
contract = {
  "coalition": {
    "actor_role": "odin",
    "identities": [
      {"role": "odin", "names": ["odin free"], "player_id": "odin"},
      {"role": "hrafn", "names": ["hrafn"], "player_id": "hrafn"},
    ],
    "endgame_exception": {
      "enabled": True,
      "marker": "odwin",
      "allowed_kinds": ["attack"],
      "evidence_field": "k1zOnlyEndgame",
    },
  }
}
registry, errors = m.build_identity_registry(contract, [])
assert not errors
base = {
  "turnNumber": 10,
  "selectedActionKind": "attack",
  "selectedLegalActionId": "attack:hrafn:25",
  "selectedActionMetadata": {"targetID": "hrafn", "targetName": "K1Z Hrafn"},
  "k1zOnlyEndgame": {
    "allSurvivingRivalsK1Z": True,
    "survivingRivals": [{"id": "hrafn", "name": "K1Z Hrafn"}],
  },
}
harm, exemptions, unresolved = m.scan_candidate_harm([base], contract, registry)
assert len(harm) == 1 and not exemptions and not unresolved
marked = dict(base, reason="rul:4ly:odwin")
harm, exemptions, unresolved = m.scan_candidate_harm([marked], contract, registry)
assert not harm and len(exemptions) == 1 and not unresolved
bad = dict(marked, k1zOnlyEndgame={
  "allSurvivingRivalsK1Z": True,
  "survivingRivals": [{"id": "outsider", "name": "Outsider"}],
})
harm, exemptions, unresolved = m.scan_candidate_harm([bad], contract, registry)
assert len(harm) == 1 and not exemptions and not unresolved
`);
});

test("ODC1 coalition gate fails when configured partners are absent", () => {
  runPython(`
contract = {
  "coalition": {
    "require_presence": True,
    "required_present_roles": ["hrafn", "katanasan"],
    "identities": [
      {"role": "odin", "names": ["odin free"]},
      {"role": "hrafn", "names": ["hrafn"]},
      {"role": "katanasan", "names": ["katanasan"]},
    ],
  }
}
registry, errors = m.build_identity_registry(contract, [])
assert not errors
present, errors = m.coalition_presence(
  contract,
  [{"username": "K1Z odin free"}],
  {"players": [{"name": "K1Z odin free"}]},
  registry,
)
assert present == {"odin"}
assert errors == ["required coalition roles absent: hrafn, katanasan"]
`);
});

test("ODC1 resolved image evidence is recorded and verified", () => {
  runPython(`
import json
import tempfile
from pathlib import Path
candidate_id = "sha256:" + "a" * 64
parent_id = "sha256:" + "b" * 64
contract = {
  "candidate": {"image": "candidate:tag", "image_id": candidate_id},
  "parent": {"image": "parent:tag", "image_id": parent_id},
}
with tempfile.TemporaryDirectory() as directory:
  path = Path(directory) / "images.json"
  path.write_text(json.dumps({
    "candidate": {"tag": "candidate:tag", "image_id": candidate_id},
    "parent": {"tag": "parent:tag", "image_id": parent_id},
  }))
  recorded, errors = m.verify_resolved_images(path, contract)
  assert not errors
  assert recorded["images"]["candidate"]["image_id"] == candidate_id
  path.write_text(json.dumps({
    "candidate": {"tag": "candidate:tag", "image_id": parent_id},
    "parent": {"tag": "parent:tag", "image_id": parent_id},
  }))
  _, errors = m.verify_resolved_images(path, contract)
  assert errors == ["resolved candidate image ID mismatched"]
`);
});

test("ODC1 contract rejects legacy schema and requires an endgame marker", () => {
  runPython(`
legacy = {
  "schema_version": 1,
  "launch_ready": True,
  "screen_mode": "competitive",
  "candidate": {"source_commit": "a" * 40, "image_id": "sha256:" + "a" * 64},
  "parent": {"source_commit": "b" * 40, "image_id": "sha256:" + "b" * 64},
  "coalition": {},
}
errors = m.contract_failures(legacy)
assert "gate contract schema_version must be 2" in errors
assert "coalition endgame exception must be explicitly enabled or disabled" in errors
`);
});

test("ODC1 can explicitly disable every K1Z endgame exception", () => {
  runPython(`
contract = {
  "schema_version": 2,
  "launch_ready": True,
  "screen_mode": "competitive",
  "candidate": {"source_commit": "a" * 40, "image_id": "sha256:" + "a" * 64},
  "parent": {"source_commit": "b" * 40, "image_id": "sha256:" + "b" * 64},
  "coalition": {"endgame_exception": {"enabled": False}},
}
assert not m.contract_failures(contract)
registry, errors = m.build_identity_registry({
  "coalition": {
    "identities": [
      {"role": "odin", "names": ["odin free"]},
      {"role": "hrafn", "names": ["hrafn"], "player_id": "hrafn"},
    ]
  }
}, [])
assert not errors
row = {
  "turnNumber": 10,
  "selectedActionKind": "attack",
  "selectedLegalActionId": "attack:hrafn:40",
  "selectedActionMetadata": {"targetID": "hrafn", "targetName": "K1Z Hrafn"},
  "reason": "rul:atk:odk1",
}
harm, exemptions, unresolved = m.scan_candidate_harm([row], contract, registry)
assert len(harm) == 1 and not exemptions and not unresolved
assert harm[0]["reason"] == "endgame exception disabled"
`);
});

test("ODC1 requires positive score and tile advantage in every orientation", () => {
  runPython(`
advantage, errors = m.orientation_advantage(
  {"score": 0.6, "tiles_owned": 120},
  {"score": 0.4, "tiles_owned": 100},
  "A",
)
assert advantage == {"score_delta": 0.19999999999999996, "tile_delta": 20}
assert not errors
_, errors = m.orientation_advantage(
  {"score": 0.6, "tiles_owned": 99},
  {"score": 0.4, "tiles_owned": 100},
  "B",
)
assert errors == ["candidate tile advantage was not positive in orientation B"]
`);
});

test("ODC1 mechanism mode gates candidate safety without claiming parent lift", () => {
  runPython(`
import tempfile
from pathlib import Path
from types import SimpleNamespace

with tempfile.TemporaryDirectory() as directory:
  root = Path(directory)
  manifest = root / "manifest.json"
  manifest.write_text("{}")
  contract_path = root / "contract.json"
  contract = {
    "schema_version": 2,
    "launch_ready": True,
    "screen_mode": "mechanism",
    "arm": "odc1",
    "pair_id": "mechanism",
    "candidate": {
      "source_commit": "a" * 40,
      "image_id": "sha256:" + "a" * 64,
    },
    "parent": {
      "source_commit": "b" * 40,
      "image_id": "sha256:" + "b" * 64,
    },
    "coalition": {
      "require_presence": True,
      "required_present_roles": ["katanasan"],
      "endgame_exception": {"enabled": False},
    },
    "manifest": {"path": str(manifest), "sha256": "fixture"},
  }
  m.load = lambda path: contract
  m.digest = lambda path: "fixture"
  m.validate_differential_proof = lambda contract, path: ([], {"same_fixture": True})
  m.audit_run = lambda *args: {
    "orientation": "A",
    "coalition_roles_present": ["odin", "katanasan"],
    "candidate": {
      "decision_count": 10,
      "accepted": 10,
      "illegal_turns": [],
      "rejected_turns": [],
      "fallback_turns": [],
      "degradation_turns": [],
      "unexplained_holds": [],
      "harmful_k1z_actions": [],
      "unresolved_harmful_targets": [],
      "route_execution_count": 2,
    },
    "parent": {"degradation_turns": [100]},
    "orientation_advantage": {"score_delta": -0.8, "tile_delta": -80},
    "replay_sha256": "c" * 64,
    "violations": [],
  }
  args = SimpleNamespace(
    contract=contract_path,
    job_a=root / "job.json",
    run_a=root,
    resolved_images_a=None,
    job_b=None,
    run_b=None,
    resolved_images_b=None,
    only_a=True,
  )
  report, exit_code = m.build_report(args)
  assert exit_code == 0
  assert report["verdict"] == "PASS_MECHANISM_SCREEN"
  assert report["competitive_evidence"] is False
  assert report["required_coalition_roles"] == ["katanasan"]
  assert report["paired_deltas"] == {}
`);
});

test("ODC1 mechanism contracts cannot omit their coalition partner", () => {
  runPython(`
base = {
  "schema_version": 2,
  "launch_ready": True,
  "screen_mode": "mechanism",
  "candidate": {"source_commit": "a" * 40, "image_id": "sha256:" + "a" * 64},
  "parent": {"source_commit": "b" * 40, "image_id": "sha256:" + "b" * 64},
  "coalition": {"endgame_exception": {"enabled": False}},
}
errors = m.contract_failures(base)
assert "mechanism screen must require coalition presence" in errors
assert "mechanism screen requires at least one coalition partner" in errors
base["coalition"]["require_presence"] = True
base["coalition"]["required_present_roles"] = ["odin"]
errors = m.contract_failures(base)
assert "mechanism screen requires a coalition partner other than the actor" in errors
`);
});
