# Hrafn Studio handoff

Updated: 2026-07-20

## Authority and location

- Canonical Studio endpoint: `odin@100.86.99.100`
- Hrafn repository: `/Users/odin/proxywar-k1z-hrafn`
- Branch: `feature/k1z-hrafn-fylking`
- Studio is the sole Hrafn execution host after this handoff. The local
  `/Users/olifreuler/proxywar-k1z-hrafn` checkout is a recovery mirror and must
  not run Coworld concurrently.
- Hrafn never enters, edits, runs, uploads, or submits the Odin/Qd1n lane.
- Slack is frozen through `2026-08-09T11:27:17Z`.

## Replaced Studio slot

The user authorized Hrafn to replace Katanasan's completed Codex slot on
Studio. Katanasan stopped cleanly; preserve these recovery handles:

- Session: `019f5d20-2d75-73b1-a591-5b313104e3dc`
- Worktree:
  `/Users/odin/proxywar-coworld-starter/.worktrees/odin-kuroi-taiyo`
- Branch: `feature/odin-kuroi-taiyo`
- Preserved commit: `491485321d495d0f2a58b654d0470eb7e981d55e`

Do not delete or rewrite that worktree. The separate Gravity/Juryoku session on
`ttys001` remains active and out of scope. Leave the Katanasan mailbox watcher
untouched.

`ttys000` is the reserved replacement slot. Resume the stopped Hrafn session
`019f81bb-194d-7ff3-b963-f1247f98dec4` there only after Studio is
fast-forwarded to the exact pushed source. Never use `codex resume --last` and
never resume Katanasan's session ID.

Studio's shared `/Users/odin/.softmax` profile remains owned by Katanasan and
Gravity. Hrafn uses the isolated real home `/Users/odin/.hrafn-coworld-home`
through `HRAFN_SOFTMAX_HOME`; never overwrite or swap the shared profile. This
changes only the Coworld identity probe. Repository, mailbox, and runner lease
paths remain under the normal `/Users/odin` home.

## Current HI1 truth

HI1 revision r1 is terminally rejected. Its preserved Pangaea pair used source
`98288c8b9211513cfb71ceb88707de1721f351e3`; the exact result is recorded in
`experiments/hrafn-intent-i1-pangaea-98288c8b-r2-rejection-20260720.json` and
commit `d9f7c81a5b88a79c5c41383ac76e992f0b550d66`. Never reuse that pair or any
older HI1 attempt as a predecessor for r2.

Revision `hrafn-intent-i1-r2` is a transparent post-result revision frozen
before its first episode. It uses fresh seeds `240723` and `240724`, one causal
action delta at most per intent epoch, normal retirement for unavailable or
stalled intent, and a direct bounded convert affordance. The three sparring
players use an audited neutral exact-v5 derivative with `[0UT] v5` public
reasons; only the subject may emit `[K1Z] r4vn`.

The comparator independently replays the complete baseline and intent action,
generated marker roles, public reason, and epoch-delta state. Historical q10
transport markers normalize only inside the strict intent-v5 grammar. The
first-treatment check binds the complete prior prefix, full treatment
observation and legal menu, and the recomputed full baseline action. Coworld
0.1.28's same-row `auditBefore` is post-action, so it is intentionally excluded
at the treatment row.

## Exact Studio environment and source sync

Keep Studio's normal `HOME`. Export only the Hrafn-specific identity and Git
contexts:

```bash
export PATH=/usr/local/bin:/opt/homebrew/bin:/Users/odin/.local/bin:$PATH
export HRAFN_SOFTMAX_HOME=/Users/odin/.hrafn-coworld-home
export GIT_ASKPASS=/Users/odin/.hrafn-github/askpass.sh
export GIT_TERMINAL_PROMPT=0
export GH_CONFIG_DIR=/Users/odin/.hrafn-github

cd /Users/odin/proxywar-k1z-hrafn
git fetch origin \
  refs/heads/feature/k1z-hrafn-fylking:refs/remotes/origin/feature/k1z-hrafn-fylking
git merge --ff-only origin/feature/k1z-hrafn-fylking
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = \
  "$(git rev-parse origin/feature/k1z-hrafn-fylking)"
```

Do not use the mailbox's generic multi-branch `git pull`. Synchronize mailbox
`main` with an explicit `origin/main` refspec under the mailbox write lock.

## Exact r2 artifact build

Create one source-bound artifact directory and materialize the pinned manifest
from the now-committed Coworld source bytes:

```bash
SHORT=$(git rev-parse --short=8 HEAD)
ART=/private/tmp/hrafn-hi1-r2-$SHORT
mkdir -m 700 "$ART"
node scripts/materialize-hrafn-coworld-manifest.mjs \
  --output "$ART/coworld-manifest-0.1.28.json"
shasum -a 256 "$ART/coworld-manifest-0.1.28.json"
```

The manifest must hash to
`8feb5100ee63d5ccca66794c40e535f2715376e2a2cf8a3f8ed892880dfe65f3`.
Its runnable ProxyWar image must resolve on Studio to linux/amd64 image
`sha256:98cf744311d0da1cc6a1b5fee6ef588db984c66c0a0bd077a4a9a9c475f32cb4`.

```bash
GAME_IMAGE=$(jq -r '.game.runnable.image' "$ART/coworld-manifest-0.1.28.json")
PINNED_GAME_ID=sha256:98cf744311d0da1cc6a1b5fee6ef588db984c66c0a0bd077a4a9a9c475f32cb4
test "$GAME_IMAGE" = \
  'coworld/cow_236e7c2e-acdb-404a-b1b9-41852e5ac658/proxywar-0.1.10-1:downloaded'
test "$(docker image inspect "$GAME_IMAGE" --format '{{.Id}}')" = \
  "$PINNED_GAME_ID"
test "$(docker image inspect "$GAME_IMAGE" \
  --format '{{.Os}}/{{.Architecture}}')" = 'linux/amd64'
```

The neutral opponent is the exact locally sealed image
`sha256:0e0014ae54354ca2af327f9785c8c22d6a9e4c60390d02776a6fe3235b972b87`.
Its Docker configuration contains the original build timestamp, so an ordinary
Studio rebuild cannot reproduce the ID. Transfer it once with `docker
save/load`, then let the image receipt verify its committed wrapper bytes,
exact-v5 parent layers, linux/amd64 platform, and runtime. Do not replace that
check with a fresh digest. The image receipt and every downstream receipt also
bind the manifest tag to the exact game-image ID above.

Run this export on the recovery Mac. It transfers both the neutral wrapper and
the separately inspected exact-v5 parent in one checksummed archive:

```bash
set -euo pipefail
NEUTRAL=sha256:0e0014ae54354ca2af327f9785c8c22d6a9e4c60390d02776a6fe3235b972b87
PARENT=sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d
BUNDLE=/private/tmp/hrafn-hi1-r2-neutral-and-parent.tar
CHECKSUM=$BUNDLE.sha256
SSH_KEY=/Users/olifreuler/.ssh/id_ed25519
test "$(docker image inspect "$NEUTRAL" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}')" = \
  "$NEUTRAL linux/amd64"
test "$(docker image inspect "$PARENT" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}')" = \
  "$PARENT linux/amd64"
test ! -e "$BUNDLE" && test ! -e "$CHECKSUM"
docker image save --output "$BUNDLE" "$NEUTRAL" "$PARENT"
(cd "$(dirname "$BUNDLE")" && \
  shasum -a 256 "$(basename "$BUNDLE")" > "$(basename "$CHECKSUM")")
scp -o IdentitiesOnly=yes -i "$SSH_KEY" "$BUNDLE" "$CHECKSUM" \
  odin@100.86.99.100:/private/tmp/
```

Then run this import on Studio before creating the receipt:

```bash
set -euo pipefail
export PATH=/usr/local/bin:/opt/homebrew/bin:/Users/odin/.local/bin:$PATH
BUNDLE=/private/tmp/hrafn-hi1-r2-neutral-and-parent.tar
CHECKSUM=$BUNDLE.sha256
(cd "$(dirname "$BUNDLE")" && \
  shasum -a 256 -c "$(basename "$CHECKSUM")")
docker image load --input "$BUNDLE"
NEUTRAL=sha256:0e0014ae54354ca2af327f9785c8c22d6a9e4c60390d02776a6fe3235b972b87
PARENT=sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d
test "$(docker image inspect "$NEUTRAL" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}')" = \
  "$NEUTRAL linux/amd64"
test "$(docker image inspect "$PARENT" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}')" = \
  "$PARENT linux/amd64"
```

Build the subject from the clean committed archive, then discover and seal its
Studio-produced ID; the subject ID is not a source constant:

```bash
git archive HEAD | docker buildx build --platform linux/amd64 --load \
  -f Dockerfile.hrafn-intent -t "hrafn-intent-r2:$SHORT" -
SUBJECT_IMAGE=$(docker image inspect "hrafn-intent-r2:$SHORT" \
  --format '{{.Id}}')
node scripts/create-hrafn-intent-image-receipt.mjs \
  --repo "$PWD" --image "$SUBJECT_IMAGE" \
  --output "$ART/image-receipt.json"
```

Generate all four jobs with `scripts/build-hrafn-intent-job.mjs` in this exact
order: Pangaea control seed `240723` slot `1`, Pangaea candidate seed `240723`
slot `1`, Asia candidate seed `240724` slot `2`, Asia control seed `240724`
slot `2`. Use the pinned manifest, subject receipt, discovered subject ID, and
the exact neutral opponent ID for every call.

After Odin commits the one artifact-bound advisory identity window, generate
each stage's exact spec with
`scripts/build-hrafn-intent-preflight-spec.mjs`. The builder binds all four job
hashes, ordered predecessor receipts, output path, full Coworld argv, identity
window, and the Pangaea continuation report required before Asia.

```bash
node scripts/build-hrafn-intent-preflight-spec.mjs \
  --repo "$PWD" \
  --manifest "$ART/coworld-manifest-0.1.28.json" \
  --artifact-dir "$ART" \
  --identity-window /Users/odin/.stormforge/team-mailbox/ODIN_PACKET.json \
  --job-id pangaea-control \
  --attempt r2 \
  --output "$ART/pangaea-control-preflight-spec.json"
```

Change only `--job-id` and the unique spec output for later stages. Asia also
requires `--pangaea-report` pointing to the exact sealed Pangaea pair report.

## Episode order

Before the next episode:

1. Pull the latest pushed Hrafn branch and mailbox `main` explicitly.
2. Verify the local source is clean and run the full suite.
3. Verify the transferred exact neutral image, then build the subject from
   `git archive HEAD` and seal its observed Studio digest.
4. Generate a fresh live image receipt and four r2 jobs: Pangaea seed `240723`,
   slot 1, then Asia seed `240724`, slot 2.
5. Require exactly one current Odin `HI1_IDENTITY_WINDOW_READY` packet bound to
   those hashes; formal approvals consumed must remain zero.
6. Verify the active identity is exactly `K1Z Hrafn` and the Studio foreground
   runner lease is free.
7. Run the ordered chain: Pangaea control, Pangaea candidate, clean Pangaea
   pair audit, Asia candidate, Asia control. Asia runs only when the sealed
   Pangaea continuation gate permits it. Stop on the first failed preflight,
   operational receipt, audit, identity check, K1Z safety check, or campaign
   stop verdict.

Use the Hrafn-owned foreground wrapper:

```bash
"$HOME/proxywar-k1z-hrafn/scripts/proxywar-runner-lease.sh" status --json
```

No diagnostic result authorizes promotion. Hosted `4/4`, regression `20/20`,
and the single final Odin formal approval remain downstream gates.

## Persistent operator recovery

The terminal TUI is the sole Studio operator control plane. With the source
clean and synchronized, run this in `ttys000`:

```bash
cd /Users/odin/proxywar-k1z-hrafn
HRAFN_SOFTMAX_HOME=/Users/odin/.hrafn-coworld-home \
/Users/odin/.local/bin/codex resume \
  --strict-config \
  --disable apps \
  --dangerously-bypass-approvals-and-sandbox \
  --model gpt-5.6-sol \
  --config 'model_reasoning_effort="xhigh"' \
  --cd /Users/odin/proxywar-k1z-hrafn \
  019f81bb-194d-7ff3-b963-f1247f98dec4
```

Use the same exact UUID for recovery. Do not set `HOME`, install a Hrafn
LaunchAgent, or start a second operator while this TUI is alive.
