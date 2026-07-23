import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const playerPath = process.argv[2] ?? "/app/llm-player.mjs";
const appRoot = playerPath.replace(/\/llm-player\.mjs$/, "");
const expected = {
  player: "1154115fdf5ebb89fa170bba6060d5a730615970d4cc23c00dbfa97e42b31563",
  strategy: "f2ee66d570033508c4158bcb83d56d81dc198cdcebb91098d7e67eefdc8e6a7a",
  chassis: "de45b447513ddcac5e9bf1be14417bfab0dd5e8e92156670539e8eda01478ca1",
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (path) => sha256(readFileSync(path));
const source = readFileSync(playerPath, "utf8");
const inputSha256 = sha256(source);
const strategyBefore = fileSha256(`${appRoot}/strategy-engine.mjs`);
const chassisBefore = fileSha256(`${appRoot}/strategy-chassis.mjs`);
if (inputSha256 !== expected.player) {
  throw new Error(`unexpected live player bytes: ${inputSha256}`);
}
if (strategyBefore !== expected.strategy || chassisBefore !== expected.chassis) {
  throw new Error(`unexpected live selector bytes: strategy=${strategyBefore} chassis=${chassisBefore}`);
}

const historyAnchor = "const history = []; // compact decision records appended after each decision\n";
const capture = `
let cb1RawRequestCaptureState = "idle";

function maybeCaptureCb1RawRequest(message, observation, actions, state, selectorHistory, planSnapshot, chosen) {
  if (process.env.CB1_CAPTURE_RAW !== "1" || cb1RawRequestCaptureState !== "idle") return;
  if (state.mapFingerprint !== "Pangaea" || state.self.troopRatio < 0.9) return;
  const recent = selectorHistory.slice(-4);
  if (recent.length < 4 || recent.some((entry) => entry.kind !== "upgrade_structure")) return;
  const shares = [state.self.tileShare, ...recent.map((entry) => Number(entry.tileShare))];
  if (shares.some((share) => !Number.isFinite(share))) return;
  if (Math.max(...shares) - Math.min(...shares) > 0.0005) return;
  if (!actions.some((action) => action.kind === "boat")) return;

  cb1RawRequestCaptureState = "pending";
  try {
    const line = \`CB1_RAW_REQUEST_V1 \${JSON.stringify({
      schemaVersion: 1,
      requestID: message.requestID,
      policyEngine: process.env.POLICY_ENGINE === "qd2n" ? "qd2n" : "qd1n",
      trigger: {
        mapFingerprint: state.mapFingerprint,
        ownTroopRatio: state.self.troopRatio,
        ownTileShare: state.self.tileShare,
        recentKinds: recent.map((entry) => entry.kind),
        recentTileShares: recent.map((entry) => entry.tileShare),
        legalBoatCount: actions.filter((action) => action.kind === "boat").length,
      },
      selectorState: state,
      selectorHistory,
      plan: planSnapshot,
      chosen: {
        id: chosen.id,
        kind: chosen.kind,
        policyMarker: chosen.policyMarker ?? null,
        policyMarkers: Array.isArray(chosen.policyMarkers) ? chosen.policyMarkers : [],
      },
      observation,
      legalActions: actions,
    })}\\n\`;
    process.stdout.write(line, (error) => {
      cb1RawRequestCaptureState = error ? "idle" : "done";
      if (error) console.error("CB1 raw capture write failed: " + (error.message || error));
    });
  } catch (error) {
    cb1RawRequestCaptureState = "idle";
    console.error("CB1 raw capture serialization failed: " + (error.message || error));
  }
}
`;
const sendAnchor = `  activeSocket.send(response, (error) => {
    if (!error) return;
    console.error(\`decision response failed: \${error.message || error}\`);
    activeSocket.terminate();
  });
`;
const captureAfterSend = `${sendAnchor}  const selectorHistory = history.slice(0, -1);
  const planSnapshot = plan === null ? null : { ...plan, avoidTargets: [...plan.avoidTargets] };
  setImmediate(() => maybeCaptureCb1RawRequest(
    message,
    obs,
    actions,
    state,
    selectorHistory,
    planSnapshot,
    chosen,
  ));
`;

function replaceOnce(value, anchor, replacement) {
  const first = value.indexOf(anchor);
  if (first < 0 || value.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`expected exactly one anchor: ${anchor.trim()}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + anchor.length);
}

let instrumented = replaceOnce(source, historyAnchor, historyAnchor + capture);
instrumented = replaceOnce(instrumented, sendAnchor, captureAfterSend);
writeFileSync(playerPath, instrumented);
const outputSha256 = sha256(instrumented);
const strategyAfter = fileSha256(`${appRoot}/strategy-engine.mjs`);
const chassisAfter = fileSha256(`${appRoot}/strategy-chassis.mjs`);
if (strategyAfter !== strategyBefore || chassisAfter !== chassisBefore) {
  throw new Error("instrumentation changed selector bytes");
}
process.stdout.write(`${JSON.stringify({
  inputSha256,
  outputSha256,
  strategySha256: strategyAfter,
  chassisSha256: chassisAfter,
})}\n`);
