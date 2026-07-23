import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const auditor = fileURLToPath(
  new URL("../scripts/audit-pg2-matrix-pair.py", import.meta.url),
);

function classify(decisions) {
  const script = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location('audit', ${JSON.stringify(auditor)})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(json.dumps(module.classify_holds(json.loads(sys.stdin.read()), {'hrafn'})))",
  ].join("; ");
  return JSON.parse(execFileSync("python3", ["-c", script], {
    input: JSON.stringify(decisions),
    encoding: "utf8",
  }));
}

test("PG2 hold audit ignores protected attacks and excluded Defense Posts", () => {
  const holds = classify([{
    selectedActionKind: "hold",
    turnNumber: 4900,
    reason: "dgd:err:h0d",
    legalActionIDsByKind: {
      attack: ["attack:hrafn:10", "attack:hrafn:25", "attack:hrafn:40"],
      build: ["build:Defense Post:224352"],
      donate_troops: ["donate_troops:hrafn"],
    },
  }]);
  assert.deepEqual(holds, []);
});

test("PG2 hold audit still flags a legal non-K1Z attack", () => {
  const holds = classify([{
    selectedActionKind: "hold",
    turnNumber: 4900,
    reason: "dgd:err:h0d",
    legalActionIDsByKind: { attack: ["attack:outsider:25"] },
  }]);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].tactical_actions[0].target_id, "outsider");
});
