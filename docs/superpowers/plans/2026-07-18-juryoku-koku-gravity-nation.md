# Jūryoku-koku Gravity Nation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a new independent `juryoku-koku` player running `santai-juryoku`, allied with and harmless to both `odin free` and `katanasan`, then join the Proxywar league and coordinate reciprocal deployment.

**Architecture:** Branch from the tested katanasan v35 scorer, replace its single protected player with a normalized two-ally registry, and keep alliance/nuclear/hostility invariants in the synchronous local scorer. Claude remains a non-blocking high-level planner. Coworld identity switching is treated as a deployment transaction and verified before each upload.

**Tech stack:** Node.js ES modules, `node:test`, Docker, Coworld CLI, Git mailbox, macOS launchd.

## Task 1: Specify the three-body contract as failing tests

**Files:** `llm-player.test.mjs`

- Add fixtures for Odin, katanasan, and outsiders with stable player IDs.
- Add alliance request and alliance-observed fixtures.
- Prove both allies are protected by name normalization and ID.
- Prove retries are preferred until `isAllied=true` and stop afterward.
- Prove outsiders remain valid attack and nuclear targets.
- Run `npm test` and record RED before implementation.

## Task 2: Implement Gravity Nation's deterministic scorer

**Files:** `llm-player.mjs`, `llm-player.test.mjs`

- Replace the single `SHADOW_FRIEND` constant with protected ally descriptors.
- Normalize player names with Unicode NFKC and normalized whitespace.
- Resolve structured action target ID/name and reject all harmful actions against either ally.
- Prefer legal reciprocal alliance requests for each unallied protected player.
- Exclude both allies from target selection and planner targets.
- Retain safe outsider nukes, silo construction, anti-loop behavior, and strongest-outsider pressure.
- Rewrite strategy/public trace names for Jūryoku-koku / Santai Jūryoku.
- Run the focused test after each minimal change, then the full suite and syntax check.

## Task 3: Create and verify the independent player identity

**Operational state:** Coworld credentials, no source file.

- Record the current katanasan player ID.
- Create `juryoku-koku` and capture its returned player ID.
- Switch to that player and re-run `coworld player list --json`.
- Refuse deployment if the selected/default identity does not match Gravity Nation.

## Task 4: Build, upload, qualify, and submit Gravity

**Files:** existing `Dockerfile`, `launch.sh`

- Build/test locally for `linux/amd64`.
- Run `bash launch.sh santai-juryoku --yes` under the Gravity identity.
- Capture policy label and policy-version ID from machine-readable Coworld output.
- Submit to `league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42` with automatic champion selection.
- Verify membership belongs to the Gravity player and active version.

## Task 5: Add Gravity to katanasan's protection contract

**Files:** katanasan worktree `llm-player.mjs`, `llm-player.test.mjs`

- Switch Coworld back to player `ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba` before uploading.
- Add the exact Gravity player ID plus normalized name to the protected set.
- Add tests for reciprocal request, permanent protection, and outsider nuclear validity.
- Upload the next `tsukuyomi-no-kage` version and verify league champion state.

## Task 6: Coordinate Odin and automate mailbox checks

**Files:** shared mailbox directive; mailbox watcher script/tests/plist.

- Push a `to=Kimi-OdinFree` directive with exact Gravity identity/version evidence.
- Require Odin's deterministic scorer to ally with and never harm both coalition partners.
- Implement a 900-second launchd pull/check loop using a dedicated clean runtime clone.
- Detect both standalone Markdown messages and `TEAM_HANDOFF.md` changes addressed to katanasan.
- Verify plist syntax, bootstrap status, first pull, and log output.

## Task 7: Hosted evidence and RCI

- Poll league membership, recent submissions, replays, and mailbox receipts.
- Audit whether reciprocal requests produce `isAllied=true`, whether any harmful ally action occurs, and whether nuclear actions reach outsiders.
- Make only evidence-backed scorer adjustments, with a new failing regression test first.
- Report wins only from hosted result data; report unresolved platform timing separately.
