import { assertHrafnHostRunnerDeclaration } from "../hrafn-runtime-guard.mjs";

const declaration = assertHrafnHostRunnerDeclaration();
process.stdout.write(`${JSON.stringify({
  declaration_ok: true,
  advisory_only: true,
  lane: declaration.lane,
  player_id: declaration.playerID,
  player_name: declaration.playerName,
  run_id: declaration.runID,
  lease_directory: declaration.leaseDirectory,
  does_not_verify: [
    "supervisor_pid_or_start_time",
    "child_pid_or_start_time",
    "completion_receipt",
    "active_coworld_identity",
  ],
})}\n`);
