#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  HRAFN_INTENT_CAMPAIGN_ID,
  HRAFN_INTENT_MODEL,
  HRAFN_INTENT_MODEL_DIGEST,
  HRAFN_INTENT_OLLAMA_VERSION,
  HRAFN_INTENT_PLAYER_RUN,
  HRAFN_V5_OPPONENT_IMAGE_ID,
  verifyHrafnIntentImageReceipt,
} from "./create-hrafn-intent-image-receipt.mjs";

const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_IDENTITY = /(?:^|[^a-z0-9])(?:qd1n|odin)(?:$|[^a-z0-9])/i;
const SUBJECT_NAME = "K1Z Hrafn";
const OPPONENT_RUN = Object.freeze(["node", "/app/hrafn-player.mjs"]);
const OUTSIDER_NAMES = Object.freeze([
  "Frozen v5 Alpha",
  "Frozen v5 Beta",
  "Frozen v5 Gamma",
]);

export const HRAFN_INTENT_MANIFEST_SHA256 =
  "8feb5100ee63d5ccca66794c40e535f2715376e2a2cf8a3f8ed892880dfe65f3";
export const HRAFN_V5_OPPONENT_IMAGE_DIGEST = HRAFN_V5_OPPONENT_IMAGE_ID;
export const HRAFN_INTENT_CELLS = Object.freeze([
  Object.freeze({
    id: "pangaea-control",
    order: 0,
    role: "control",
    variant_id: "tournament-4p-pangaea",
    map: "Pangaea",
    seed: 240721,
    subject_slot: 1,
  }),
  Object.freeze({
    id: "pangaea-candidate",
    order: 1,
    role: "candidate",
    variant_id: "tournament-4p-pangaea",
    map: "Pangaea",
    seed: 240721,
    subject_slot: 1,
  }),
  Object.freeze({
    id: "asia-candidate",
    order: 2,
    role: "candidate",
    variant_id: "tournament-4p-asia",
    map: "Asia",
    seed: 240722,
    subject_slot: 2,
  }),
  Object.freeze({
    id: "asia-control",
    order: 3,
    role: "control",
    variant_id: "tournament-4p-asia",
    map: "Asia",
    seed: 240722,
    subject_slot: 2,
  }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function option(argv, name) {
  const exact = `--${name}`;
  const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
  if (inline) return inline.slice(exact.length + 1);
  const index = argv.indexOf(exact);
  return index >= 0 ? argv[index + 1] : null;
}

function assertImage(value, label) {
  if (!IMAGE_DIGEST.test(value ?? "")) {
    throw new Error(`${label} must be an exact sha256 image digest`);
  }
}

function assertNoForbiddenIdentityMaterial(value, label) {
  const serialized = JSON.stringify(value);
  if (typeof serialized === "string" && FORBIDDEN_IDENTITY.test(serialized)) {
    throw new Error(`${label} cannot contain qd1n or Odin identity material`);
  }
}

export function parsePinnedHrafnIntentManifest(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? "");
  if (sha256(bytes) !== HRAFN_INTENT_MANIFEST_SHA256) {
    throw new Error("manifest raw SHA-256 is not the pinned Coworld manifest");
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("pinned manifest is not valid JSON");
  }
  return manifest;
}

function cellFor({ variantID, subjectSlot, seed, intentEnabled }) {
  if (typeof intentEnabled !== "boolean") {
    throw new Error("intentEnabled must be boolean");
  }
  const role = intentEnabled ? "candidate" : "control";
  const cells = HRAFN_INTENT_CELLS.filter((cell) =>
    cell.variant_id === variantID &&
    cell.subject_slot === subjectSlot &&
    cell.seed === seed &&
    cell.role === role
  );
  if (cells.length !== 1) {
    throw new Error("HI1 job is not one exact preregistered map/seed/slot/role cell");
  }
  return cells[0];
}

function exactJobForCell(manifest, {
  cell,
  subjectImage,
  opponentImage,
} = {}) {
  const variant = manifest?.variants?.find((entry) => entry.id === cell?.variant_id);
  if (!variant || variant.game_config?.map !== cell?.map ||
    variant.game_config?.map_size !== "Compact" ||
    variant.game_config?.num_agents !== 4
  ) {
    throw new Error("pinned manifest does not expose the exact HI1 cell");
  }
  let outsiderIndex = 0;
  const names = Array.from({ length: 4 }, (_unused, slot) => {
    if (slot === cell.subject_slot) return { name: SUBJECT_NAME };
    return { name: OUTSIDER_NAMES[outsiderIndex++] };
  });
  const players = names.map((_player, slot) => {
    if (slot === cell.subject_slot) {
      return {
        type: "player",
        image: subjectImage,
        run: [...HRAFN_INTENT_PLAYER_RUN],
        env: {
          HRAFN_INTENT_ENABLED: cell.role === "candidate" ? "1" : "0",
          HRAFN_INTENT_ENDPOINT: "http://host.docker.internal:11434/api/generate",
          HRAFN_INTENT_TIMEOUT_MS: "4000",
          HRAFN_RV1: "1",
        },
      };
    }
    return {
      type: "player",
      image: opponentImage,
      run: [...OPPONENT_RUN],
      env: { HRAFN_RV1: "1" },
    };
  });
  return {
    manifest: structuredClone(manifest),
    game_config: {
      ...structuredClone(variant.game_config),
      players: names,
      seed: cell.seed,
      tokens: null,
    },
    players,
  };
}

function assertSubjectReceipt(receipt, { subjectImage, opponentImage }) {
  const report = verifyHrafnIntentImageReceipt(receipt);
  if (!report.valid) {
    throw new Error(`subject receipt is invalid: ${report.errors.join("; ")}`);
  }
  if (receipt.image.id !== subjectImage) {
    throw new Error("subject receipt image ID does not match subject image");
  }
  if (receipt.opponent.image_id !== opponentImage) {
    throw new Error("subject receipt opponent image does not match opponent image");
  }
  if (receipt.planner.model !== HRAFN_INTENT_MODEL ||
    receipt.planner.model_digest !== HRAFN_INTENT_MODEL_DIGEST ||
    receipt.planner.ollama_version !== HRAFN_INTENT_OLLAMA_VERSION
  ) {
    throw new Error("subject receipt planner binding is invalid");
  }
}

function differences(left, right, currentPath = "") {
  if (Object.is(left, right)) return [];
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray !== rightArray) {
    return [{ path: currentPath, control: left, candidate: right }];
  }
  if (leftArray) {
    const found = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      found.push(...differences(left[index], right[index], `${currentPath}[${index}]`));
    }
    return found;
  }
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (!leftObject || !rightObject) {
    return [{ path: currentPath, control: left, candidate: right }];
  }
  const found = [];
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    found.push(...differences(
      left[key],
      right[key],
      currentPath ? `${currentPath}.${key}` : key,
    ));
  }
  return found;
}

export function auditHrafnIntentJob(job, {
  role,
  subjectReceipt,
  subjectImage,
  opponentImage = HRAFN_V5_OPPONENT_IMAGE_ID,
  manifest,
} = {}) {
  const errors = [];
  try {
    assertNoForbiddenIdentityMaterial(job, "HI1 job");
    assertImage(subjectImage, "subject image");
    assertImage(opponentImage, "opponent image");
    if (opponentImage !== HRAFN_V5_OPPONENT_IMAGE_ID) {
      throw new Error("opponent image must be the audited exact-v5 rebuild");
    }
    if (subjectImage === opponentImage) {
      throw new Error("subject image must differ from frozen v5");
    }
    assertSubjectReceipt(subjectReceipt, { subjectImage, opponentImage });
    if (!Array.isArray(job?.players) || job.players.length !== 4 ||
      !Array.isArray(job?.game_config?.players) ||
      job.game_config.players.length !== 4
    ) {
      throw new Error("HI1 job must contain exactly four players");
    }
    if (manifest !== undefined && JSON.stringify(job.manifest) !== JSON.stringify(manifest)) {
      throw new Error("HI1 job embedded manifest differs from pinned raw manifest");
    }
    const subjectSlots = job.players.flatMap((player, slot) =>
      JSON.stringify(player?.run) === JSON.stringify(HRAFN_INTENT_PLAYER_RUN)
        ? [slot]
        : []
    );
    if (subjectSlots.length !== 1) {
      throw new Error("HI1 job must contain exactly one intent subject");
    }
    const subjectSlot = subjectSlots[0];
    const intentEnabled = role === "candidate";
    if (!["control", "candidate"].includes(role)) {
      throw new Error("HI1 role must be control or candidate");
    }
    const cell = cellFor({
      variantID: job?.game_config?.map === "Pangaea"
        ? "tournament-4p-pangaea"
        : job?.game_config?.map === "Asia"
          ? "tournament-4p-asia"
          : null,
      subjectSlot,
      seed: job?.game_config?.seed,
      intentEnabled,
    });
    const exactJob = exactJobForCell(manifest, {
      cell,
      subjectImage,
      opponentImage,
    });
    const exactDrift = differences(exactJob, job);
    if (exactDrift.length !== 0) {
      throw new Error(
        `HI1 job differs from exact reconstructed cell at ${exactDrift[0].path}`,
      );
    }
    const subject = job.players[subjectSlot];
    if (job.game_config.players[subjectSlot]?.name !== SUBJECT_NAME ||
      subject?.type !== "player" ||
      subject?.image !== subjectImage ||
      JSON.stringify(subject?.run) !== JSON.stringify(HRAFN_INTENT_PLAYER_RUN) ||
      JSON.stringify(subject?.env) !== JSON.stringify({
        HRAFN_INTENT_ENABLED: intentEnabled ? "1" : "0",
        HRAFN_INTENT_ENDPOINT: "http://host.docker.internal:11434/api/generate",
        HRAFN_INTENT_TIMEOUT_MS: "4000",
        HRAFN_RV1: "1",
      })
    ) {
      throw new Error("HI1 subject runtime contract is invalid");
    }
    if (job.game_config.map !== cell.map ||
      job.game_config.map_size !== "Compact" ||
      job.game_config.num_agents !== 4 ||
      job.game_config.tokens !== null
    ) {
      throw new Error("HI1 game cell contract is invalid");
    }
    let outsiderIndex = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      if (slot === subjectSlot) continue;
      const player = job.players[slot];
      if (job.game_config.players[slot]?.name !== OUTSIDER_NAMES[outsiderIndex] ||
        player?.type !== "player" ||
        player?.image !== opponentImage ||
        JSON.stringify(player?.run) !== JSON.stringify(OPPONENT_RUN) ||
        JSON.stringify(player?.env) !== JSON.stringify({ HRAFN_RV1: "1" })
      ) {
        throw new Error("HI1 outsider runtime contract is invalid");
      }
      outsiderIndex += 1;
    }
    return { valid: true, errors, subjectSlot, cell };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false, errors, subjectSlot: null, cell: null };
  }
}

export function buildHrafnIntentJob(manifest, {
  manifestSHA256,
  variantID,
  subjectImage,
  opponentImage,
  subjectReceipt,
  subjectSlot,
  seed,
  intentEnabled,
} = {}) {
  if (manifestSHA256 !== HRAFN_INTENT_MANIFEST_SHA256) {
    throw new Error("manifest raw SHA-256 is not pinned for HI1");
  }
  const cell = cellFor({ variantID, subjectSlot, seed, intentEnabled });
  assertImage(subjectImage, "subject image");
  assertImage(opponentImage, "opponent image");
  if (opponentImage !== HRAFN_V5_OPPONENT_IMAGE_ID) {
    throw new Error("opponent image must be the audited exact-v5 rebuild");
  }
  if (subjectImage === opponentImage) {
    throw new Error("subject image must differ from the frozen v5 opponent");
  }
  assertSubjectReceipt(subjectReceipt, { subjectImage, opponentImage });
  const job = exactJobForCell(manifest, {
    cell,
    subjectImage,
    opponentImage,
  });
  const report = auditHrafnIntentJob(job, {
    role: intentEnabled ? "candidate" : "control",
    subjectReceipt,
    subjectImage,
    opponentImage,
    manifest,
  });
  if (!report.valid) throw new Error(report.errors.join("; "));
  return job;
}

export function compareHrafnIntentJobs(control, candidate, options = {}) {
  const found = differences(control, candidate);
  const controlReport = auditHrafnIntentJob(control, {
    ...options,
    role: "control",
  });
  const candidateReport = auditHrafnIntentJob(candidate, {
    ...options,
    role: "candidate",
  });
  const allowed = controlReport.valid && candidateReport.valid &&
    controlReport.subjectSlot === candidateReport.subjectSlot &&
    controlReport.cell?.map === candidateReport.cell?.map &&
    found.length === 1 &&
    found[0].path ===
      `players[${controlReport.subjectSlot}].env.HRAFN_INTENT_ENABLED` &&
    found[0].control === "0" && found[0].candidate === "1";
  return { valid: allowed, differences: found };
}

async function main(argv) {
  const manifestPath = option(argv, "manifest");
  const outputPath = option(argv, "output");
  const variantID = option(argv, "variant");
  const subjectImage = option(argv, "subject-image");
  const opponentImage = option(argv, "opponent-image");
  const subjectReceiptPath = option(argv, "subject-receipt");
  const subjectSlotText = option(argv, "subject-slot");
  const seedText = option(argv, "seed");
  const intentText = option(argv, "intent-enabled");
  if (!manifestPath || !outputPath || !variantID || !subjectImage ||
    !opponentImage || !subjectReceiptPath || subjectSlotText === null ||
    seedText === null || !["0", "1"].includes(intentText)
  ) {
    throw new Error(
      "usage: build-hrafn-intent-job --manifest PATH --output PATH " +
      "--variant tournament-4p-pangaea|tournament-4p-asia " +
      "--subject-image sha256:DIGEST --opponent-image sha256:DIGEST " +
      "--subject-receipt PATH --subject-slot 1|2 --seed INTEGER " +
      "--intent-enabled 0|1",
    );
  }
  const manifestBytes = await readFile(manifestPath);
  const manifest = parsePinnedHrafnIntentManifest(manifestBytes);
  const subjectReceipt = JSON.parse(await readFile(subjectReceiptPath, "utf8"));
  const job = buildHrafnIntentJob(manifest, {
    manifestSHA256: sha256(manifestBytes),
    variantID,
    subjectImage,
    opponentImage,
    subjectReceipt,
    subjectSlot: Number(subjectSlotText),
    seed: Number(seedText),
    intentEnabled: intentText === "1",
  });
  await writeFile(outputPath, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
