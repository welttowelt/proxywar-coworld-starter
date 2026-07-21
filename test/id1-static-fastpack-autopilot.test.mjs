import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts/run-id1-static-fastpack.mjs");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const writeExec = (file, body) => { writeFileSync(file, body); chmodSync(file, 0o755); };

function setup(verdict) {
  const base = mkdtempSync("/private/tmp/id1-auto-test-");
  const repo = path.join(base, "repo");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, "experiments"));
  copyFileSync(SOURCE, path.join(repo, "scripts/run-id1-static-fastpack.mjs"));
  const barrier = path.join(base, "barrier");
  const requestHashLog = path.join(base, "request-hashes");
  const runner = path.join(base, "runner.sh");
  writeExec(runner, `#!/bin/bash
set -e
if [[ $1 == status ]]; then echo '{"state":"free"}'; exit; fi
shift 3; while [[ $1 == --output ]]; do mkdir "$2"; shift 2; done; shift; exec "$@"
`);
  const coworld = path.join(base, "coworld.sh");
  writeExec(coworld, `#!/bin/bash
set -e; manifest="$1"; request="$2"; shift 2; out=""
while [[ $# -gt 0 ]]; do if [[ $1 == -o ]]; then out="$2"; shift 2; else shift; fi; done
[[ -n "$out" && "$UV_NO_PROGRESS" == 1 && "$NO_COLOR" == 1 ]]
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]));const r=JSON.parse(fs.readFileSync(process.argv[2]));if(JSON.stringify(m)!==JSON.stringify(r.manifest))process.exit(1)' "$manifest" "$request"
shasum -a 256 "$request" | awk '{print $1}' >> "$REQUEST_HASH_LOG"
echo x >> "$BARRIER"
for _ in $(seq 1 100); do [[ $(wc -l < "$BARRIER") -ge 4 ]] && break; sleep .02; done
[[ $(wc -l < "$BARRIER") -ge 4 ]]; echo '{}' > "$out/results.json"
`);
  const auditor = path.join(repo, "scripts/auditor.mjs");
  writeFileSync(auditor, `
import {createHash} from "node:crypto"; import {readFileSync,writeFileSync} from "node:fs";
const p=process.argv.at(-1),b=readFileSync(p),m=JSON.parse(b),ok=process.env.VERDICT==="PASS";
writeFileSync(m.receipts.local_audit_path,JSON.stringify({manifest_sha256:createHash("sha256").update(b).digest("hex"),verdict:ok?"PASS_FASTPACK":"FAIL_FASTPACK",failures:ok?[]:["stop"],league_mutation:false})+"\\n");
process.exitCode=ok?0:1;
`);
  const fixture = path.join(base, "coworld.json");
  const fixtureValue = { game: { name: "bound-fixture" } };
  writeFileSync(fixture, `${JSON.stringify(fixtureValue)}\n`);
  const jobs = [["a","control"],["a","candidate"],["b","control"],["b","candidate"]]
    .map(([orientation, arm], index) => {
      const job_path = `experiments/job-${index}.json`;
      const jobValue = {
        game_config: { marker: `job-${index}` },
        players: [{ type: "player", image: `image-${index}` }],
      };
      writeFileSync(path.join(repo, job_path), `${JSON.stringify(jobValue)}\n`);
      const requestBytes = Buffer.from(`${JSON.stringify({
        manifest: fixtureValue,
        ...jobValue,
      }, null, 2)}\n`);
      return { id:`${orientation}-${arm}`, orientation, arm, job_path,
        job_sha256:sha(path.join(repo, job_path)),
        derived_request_sha256:createHash("sha256").update(requestBytes).digest("hex"),
        output_dir:path.join(base, `out-${index}`) };
    });
  const manifest = { schema_version:1, experiment_id:"test", runtime:{coworld_version:"0.1.30"},
    coworld_manifest:{path:fixture,sha256:sha(fixture)}, runner:{lane:"odin",run_id:"id1-test"}, jobs,
    auditor:{path:"scripts/auditor.mjs",sha256:sha(auditor)}, receipts:{local_audit_path:path.join(base,"audit.json"),
      next_preflight_path:path.join(base,"handoff.json")}, next_stage:{league_mutation:false} };
  const manifestPath = path.join(repo, "experiments/pack.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  for (const args of [["init","-q"],["config","user.name","t"],["config","user.email","t@t"],
    ["add","."],["commit","-qm","fixture"]]) execFileSync("git", args, { cwd:repo });
  return { base, repo, runner, coworld, barrier, requestHashLog, manifest, manifestPath, verdict };
}

function run(pack) {
  return spawnSync(process.execPath,
    [path.join(pack.repo,"scripts/run-id1-static-fastpack.mjs"),"--manifest",pack.manifestPath],
    { encoding:"utf8", env:{...process.env, PROXYWAR_RUNNER_LEASE_SCRIPT:pack.runner,
      PROXYWAR_ID1_COWORLD_BIN:pack.coworld, BARRIER:pack.barrier,
      REQUEST_HASH_LOG:pack.requestHashLog, VERDICT:pack.verdict} });
}

test("four-way PASS emits a non-mutation handoff and resumes only from its receipt", () => {
  const pack = setup("PASS");
  try {
    const first = run(pack); assert.equal(first.status, 0, first.stderr);
    assert.equal(readFileSync(pack.barrier,"utf8").trim().split("\n").length, 4);
    assert.deepEqual(
      readFileSync(pack.requestHashLog, "utf8").trim().split("\n").sort(),
      pack.manifest.jobs.map((job) => job.derived_request_sha256).sort(),
    );
    const handoff = JSON.parse(readFileSync(pack.manifest.receipts.next_preflight_path));
    assert.equal(handoff.mutation_preflight, false); assert.equal(handoff.league_mutation, false);
    const resumed = run(pack); assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /PASS receipt resume/);
    assert.equal(readFileSync(pack.barrier,"utf8").trim().split("\n").length, 4);
  } finally { rmSync(pack.base, { recursive:true, force:true }); }
});

test("receipt-backed FAIL stops before handoff", () => {
  const pack = setup("FAIL");
  try {
    const result = run(pack); assert.equal(result.status, 1, result.stderr);
    assert.ok(existsSync(pack.manifest.receipts.local_audit_path));
    assert.equal(existsSync(pack.manifest.receipts.next_preflight_path), false);
  } finally { rmSync(pack.base, { recursive:true, force:true }); }
});
