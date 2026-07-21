import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const playerPath = process.argv[2] ?? "/app/llm-player.mjs";
const expectedInputSha256 = "1154115fdf5ebb89fa170bba6060d5a730615970d4cc23c00dbfa97e42b31563";
const source = readFileSync(playerPath, "utf8");
const inputSha256 = createHash("sha256").update(source).digest("hex");
if (inputSha256 !== expectedInputSha256) {
  throw new Error(`unexpected live player bytes: ${inputSha256}`);
}

const historyAnchor = "const history = []; // compact decision records appended after each decision\n";
const capture = `
let cb1RawRequestCaptured = false;

function maybeCaptureCb1RawRequest(message, observation, actions, state) {
  if (process.env.CB1_CAPTURE_RAW !== "1" || cb1RawRequestCaptured) return;
  if (state.mapFingerprint !== "Pangaea" || state.self.troopRatio < 0.9) return;
  const recent = history.slice(-4);
  if (recent.length < 4 || recent.some((entry) => entry.kind !== "upgrade_structure")) return;
  const shares = [state.self.tileShare, ...recent.map((entry) => Number(entry.tileShare))];
  if (shares.some((share) => !Number.isFinite(share))) return;
  if (Math.max(...shares) - Math.min(...shares) > 0.0005) return;
  if (!actions.some((action) => action.kind === "boat")) return;

  cb1RawRequestCaptured = true;
  process.stdout.write(\`CB1_RAW_REQUEST_V1 \${JSON.stringify({
    schemaVersion: 1,
    requestID: message.requestID,
    trigger: {
      mapFingerprint: state.mapFingerprint,
      ownTroopRatio: state.self.troopRatio,
      ownTileShare: state.self.tileShare,
      recentKinds: recent.map((entry) => entry.kind),
      recentTileShares: recent.map((entry) => entry.tileShare),
      legalBoatCount: actions.filter((action) => action.kind === "boat").length,
    },
    selectorHistory: recent,
    observation,
    legalActions: actions,
  })}\\n\`);
}
`;
const stateAnchor = "  const state = buildState(obs, actions, history);\n";

function replaceOnce(value, anchor, replacement) {
  const first = value.indexOf(anchor);
  if (first < 0 || value.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`expected exactly one anchor: ${anchor.trim()}`);
  }
  return value.slice(0, first) + replacement + value.slice(first + anchor.length);
}

let instrumented = replaceOnce(source, historyAnchor, historyAnchor + capture);
instrumented = replaceOnce(
  instrumented,
  stateAnchor,
  stateAnchor + "  maybeCaptureCb1RawRequest(message, obs, actions, state);\n",
);
writeFileSync(playerPath, instrumented);
const outputSha256 = createHash("sha256").update(instrumented).digest("hex");
process.stdout.write(`${JSON.stringify({ inputSha256, outputSha256 })}\n`);
