# ProxyWar Hrafn lane handover

Updated: 2026-07-19

## Ownership

Hrafn is the persistent writable operator for `hrafn-fylking` from this
repository. Codex Odin separately owns `qd1n` from
`/Users/olifreuler/proxywar-coworld-starter`. Kimi K3 Max is the external
moonshot adviser.

Hrafn may change only Hrafn policy code and Hrafn league state. Odin may change
only Qd1n policy code and Qd1n league state. Cross-audits are read-only and use
the mailbox at `/Users/olifreuler/.stormforge/team-mailbox`.

## Live deployment truth

Verified against the Coworld/Softmax API at `2026-07-19T15:19:15Z`:

- Player: `K1Z Hrafn`
- Player ID: `ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863`
- Champion: `hrafn-fylking:v5`
- Policy-version ID: `10c32300-4593-408a-a17d-02e1d70e4a2e`
- Submission: `sub_635f34a0-e2c2-4fa6-97aa-9c864e93974c`, status `placed`,
  auto-champion `always`
- Membership: `lpm_e822de7f-1124-4b5f-b0ef-1025d46ae211`, status
  `competing active`, champion `true`
- Exact live executable source: commit
  `0c151570f7e650a32a5705ff71692aa930012097`; embedded strategy SHA-256
  `7620684b07c9dc9c633d284e817348c92881b43724291f991296c7a17ac20807`;
  embedded player SHA-256
  `16922c320ecab33705d9e723b8b4d398adea46cd02473a014b49a2abaac1fd52`.
- Exact live image: linux/amd64
  `sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d`.

Source and deployment remain separate. The current VR1 plus withdrawal-recovery
candidate is pushed source commit
`cfdcd5a673eb3b6a660390db762f499d18376632` and local-only linux/amd64 image
`sha256:02439078ca32f096ee457b4d5dbf80bfcecffd75c0559f1790875b2b6eac03a6`.
Its embedded strategy and player SHA-256 values are `c7be79b0...` and
`16922c32...`. The tactical isolation control is pushed branch
`rci/hrafn-v6-withdrawal-recovery-control`, commit
`6f1ace3e3bcdbe46a01636cb5661653ea0609c13`, and local-only linux/amd64 image
`sha256:aa5c15a39681fff79c4db7e380c9d6ac6c573cc8fbb69bb9cc545b079f25a1d7`.
It carries quick-chat suppression and withdrawal recovery without VR1. The
older quick-chat-only control remains commit `35405a4468c821af7ec1c8f2ef64fb6def4c0c1d`
and image `sha256:b7c6c1fb8e5bbee02d80ba156187bab6bb5ca996b2a4f5ddc8cc871c0989646c`.
No `hrafn-fylking:v6` upload exists, and no local candidate or control has been
submitted, placed, or made champion.

The player hash above corrects the prior `1154115f...` ledger value, which is
the SHA-256 of `llm-player.mjs`, not Hrafn's `/app/hrafn-player.mjs`. Every
pinned Hrafn image and corresponding source commit agrees on `16922c32...`.

Current field checkpoint, refreshed at `2026-07-19T15:19:15Z`:

- Hrafn is overall rank `10`, score `1.0663473508623538`, after `24` completed
  Competition rounds. Daveey leads at `31.03102579981558`; Odin is second at
  `22.27009729025311`. Hrafn's score fell from `1.1307265296318294` after
  round 534 added another official zero-score finish to the live aggregation.
- Round 528 failed. Round 529 completed with Hrafn rank `12`, score `0`; Round
  530 failed; Round 531 completed with Hrafn rank `12`, score `0`; Round 532
  completed with Hrafn rank `13`, score `0`; Round 533 completed with Hrafn
  rank `12`, score `0`; Round 534 completed with Hrafn rank `12`, score `0`.
- Round 529's four Pangaea episodes were outsider wins by Auri, daveey twice,
  and Richard Higgins. Hrafn went `0/4` and finished with `4,142`, `69,786`,
  `3,170`, and `19,827` tiles. All `439/439` decisions were accepted with zero
  fallbacks, rejects, or K1Z harm. There were `21` productive `dn1` transfers
  and `29` live `rv3` executions across the two daveey episodes.
- The Richard episode contained two accepted Hrafn holds at turns `3,500` and
  `3,600`: game-authored quick-chat actions were withdrawn, then the retry chose
  hold while attacks and a build remained submission-legal. Any challenger must
  eliminate this retry path without confounding its tactical comparison.
- Round 530 failed after two of four World episodes completed. Daveey won the
  first and Hrafn survived with `123` tiles. The second reached turn `50,400`
  without an outright winner; Hrafn was eliminated with zero tiles while
  Juryoku held the top score. Across Hrafn's two replays, all `338/338`
  decisions were accepted with zero holds, fallbacks, rejects, or K1Z harm,
  `30` `rv3` executions, and `11` productive `dn1` transfers. The third
  request failed with an unattributed game error, and the commissioner cancelled
  the fourth when the round failed. Retain the replay evidence, but assign no
  round rank, score, or promotion verdict. Replay SHA-256 values:
  `f06a7baf...` and `7cc46d31...`.
- Round 531 completed with v5 sealed. Odin, daveey, and Richard Higgins won
  three Pangaea episodes; the other reached turn `50,400` without an outright
  winner. Hrafn went `0/4`, rank `12`, score `0`, with `45,791`, `15,486`,
  `191,322`, and `0` tiles. All `793/793` decisions were accepted with zero
  fallbacks, rejects, or K1Z harm; Hrafn made `45` `rv3` executions and `39`
  productive `dn1` transfers. There were thirteen accepted retry holds after
  withdrawn actions: eleven quick-chat holds and two embargo-stop holds. The
  isolated quick-chat control covers the eleven quick-chat holds, but not the
  two embargo-stop holds at turns `7,800` and `8,000`. Those inherited holds
  block the zero-unexplained-hold pre-run gate. Replay SHA-256 values:
  `9ed404da...`, `a31b7527...`, `f0f3838a...`, and `bf8759e0...`.
- Round 532 completed with v5 sealed across four World episodes. Hrafn went
  `0/4`, rank `13`, score `0`, with `757`, `0`, `86,517`, and `0` tiles. All
  `961/961` decisions were accepted with zero fallbacks, rejects, or K1Z harm;
  Hrafn made `49` `rv3` executions and `8` productive `dn1` transfers. One
  daveey loss contained nine retry holds: seven after withdrawn embargo-stop
  actions and two after withdrawn K1Z alliance requests at turns `10,200` and
  `10,700` while boats remained legal. Replay SHA-256 values: `3d2f810c...`,
  `47e0966f...`, `8c92f5f9...`, and `702aeb5b...`.
- Round 533 completed with exact v5 sealed across four Pangaea episodes.
  Richard, RelhAlpha, and Auri won the first three; the fourth reached turn
  `50,400` without an outright winner and Katanasan held the top score. Hrafn
  went `0/4`, rank `12`, score `0`, with `0`, `16,987`, `0`, and `148,054`
  tiles. All `942/942` decisions were accepted with eight holds and zero Hrafn
  fallbacks, rejects, or K1Z harm; Hrafn made `68` `rv3` executions and `34`
  productive `dn1` transfers. Seven retry holds were covered by the revised WR1
  kind set: six quick-chat and one embargo-stop. The remaining hold at turn
  `5,100` followed a withdrawn `target_player` action while three attacks and
  eighteen boats stayed legal. Current WR1 does not cover that class. Replay
  SHA-256 values are `c763bf31...`, `d79f6ee6...`, `9c24a0ca...`, and
  `a434d6d1...`.
- Round 534 completed with exact v5 sealed across four World episodes. Odin won
  two, one reached turn `50,400` without an outright winner with Odin holding
  the top score, and Auri won the fourth. Hrafn went `0/4`, rank `12`, score
  `0`, with `1,024`, `0`, `115,747`, and `0` tiles. All `876/876` decisions
  were accepted with seven holds and zero Hrafn fallbacks, rejects, or K1Z
  harm; Hrafn made `43` `rv3` executions and five productive `dn1` transfers.
  The seven holds followed one withdrawn K1Z alliance request and six withdrawn
  quick-chat actions while productive alternatives stayed legal. Current WR1
  covers those classes, but the already-run qualifier reached neither WR1 nor
  VR1 and remains rejected. Replay SHA-256 values are `03372587...`,
  `50965cd7...`, `a4ec7d3b...`, and `90521b32...`.

## VR1 plus withdrawal-recovery qualifier rejection

Odin returned `REVISE / NO RUN` in mailbox commit `02ea001`. The corrected
candidate now requires the outsider to lead Hrafn by at least one percentage
point, and a lock survives only from the immediately prior `vr1` decision.
Both requested red cases failed before the fix and now pass; the candidate
suite is `153/153`. The quick-chat-only control suite is `149/149`.

Odin's next rereview at mailbox commit `52f2414` closed the source, isolation,
image, manifest, and request-identity blockers but returned a docs-only
`REVISE`: the experiment record said `6%-35%` while executable source uses
`activationTileShare=0.1` and `activationCeiling=0.3`. That old record was
corrected to 10%-30%, and its serial suites passed `153/153` for the candidate
and `149/149` for the control. Round 531 then superseded the packet before any
runner acquisition.

Round 531 separated an inherited embargo-stop withdrawal retry class from the
quick-chat class. Round 532 then exposed the same retry path after two withdrawn
K1Z alliance requests. Hrafn now detects a just-withdrawn quick-chat, emoji,
embargo-stop, or alliance-request action and replaces the otherwise selected
hold with a bounded non-K1Z attack near 10% or a boat near 8%, marked `wr1`.
The new alliance-request case failed red-first on both arms. The combined
candidate now passes `157/157`, and the recovery control passes `153/153`.
Embedded source bytes match both exact amd64 images.

The old VR1 packet was never run and is explicitly superseded. The replacement
four-arm design compares exact v5, quick-chat-only, withdrawal-recovery control,
and VR1 plus withdrawal-recovery candidate across two orientations. The
canonical Coworld `0.1.8` manifest and nine regenerated request hashes are
recorded in `experiments/preflight-hrafn-v6-withdrawal-recovery-wr1.json`.
The active reconciliation is
`experiments/hrafn-v6-withdrawal-recovery-r532-20260719.json`; the older
round-529 vanguard record is historical and does not authorize the revised
hashes.
Odin approved the exact revised identities at mailbox commit `66c9752`. The
pinned qualifier request `d26705a5...` then ran under the foreground runner-v2
supervisor as `hrafn-vr1-wr1-r532-qualifier-20260719T1322Z`. The command and
verified replay completed with exit `0`, the supervisor released cleanly to
`free`, and Hrafn accepted `303/303` decisions with zero Hrafn fallbacks,
rejects, or K1Z harm. The qualifier nevertheless failed its first evidence
gate: Hrafn selected ten direct holds, including seven turns with legal boats,
and reached `vr1=0` and `wr1=0`. Replay SHA-256 is `108f86ab...`; exact audit
is `experiments/audit-hrafn-v6-withdrawal-recovery-qualifier-r532-20260719.json`.

Current promotion state remains `SOURCE_READY=true` and
`LOCAL_QUALIFIED=false`; every later state is false. No matched request,
upload, hosted test, regression, final audit, submission, membership change,
or champion change is permitted from this arm.

## KF1 supporter source proof

The separate KF1 supporter arm is pushed on `rci/hrafn-kf1-supporter`.
Candidate code commit `a0d71a6a` is an exact-parent single delta from live v5;
evidence commit `6245f546` pins linux/amd64 image `sha256:2bfd61aa...`, strategy
SHA-256 `99877828...`, unchanged player SHA-256 `16922c32...`, four red-first
positive cases, and a passing `155/155` serial suite.

KF1 requires exact FFA and active phase, a safe integer survivor count,
complete boolean liveness, count/list equality, raw leading K1Z tags, unique
closed canonical survivor names, and confirmed-live Odin. After activation it
can only donate exact legal troops or gold to Odin, otherwise mark a `kf1`
hold. Ten malformed or mixed-survivor controls stay dormant. Eight ordinary
field replays from rounds 533 and 534 provide `1,794` Hrafn active-turn
observations with zero necessary-condition turns and zero KF1 reach; every
round-534 observation retained at least eight outsiders.

This arm remains `SOURCE_READY=false`; all later states are false. Mailbox
commit `a2fd925` asks Odin for source review and authorizes no episode. An
approval there permits only preparation of immutable matched qualifier specs
for a second exact-hash review. Positive replay reach remains missing.

Coalition control:

- `K1Z odin free` is on `qd1n:v89`, policy version
  `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`, membership
  `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`, competing active and champion.
- Reopen live memberships before any diagnostic upload or promotion. Never
  infer current deployment from this dated snapshot.

## Branch truth

This Hrafn policy branch intentionally diverges from Qd1n main. Fetch both
remote refs and compare them before each integration; the exact ahead/behind
count changes as the two operators record independent evidence.
Do not merge `origin/main` blindly: Qd1n and Hrafn policy code have separate
ownership and experimental histories.

Before working:

1. pull this branch with fast-forward only;
2. fetch `origin/main`;
3. read this file, local `AGENTS.md`, local `MERIT.md`, and
   `origin/main:HANDOVER.md`;
4. pull and read new mailbox entries;
5. reopen live Hrafn membership and current field state.

If this handover conflicts with the live API, the API wins and the discrepancy
must be recorded before further mutation.

## Reasoning and routing

The automatic launcher starts Hrafn with `gpt-5.6-sol` and explicit xhigh
reasoning. Hrafn performs deep source, replay, and promotion audits for Odin and
owns Hrafn implementation. Odin runs high reasoning and returns the final
cross-audit on Hrafn promotion packets. Kimi K3 Max remains external at his own
max setting.

## Runner and mailbox

- Mailbox: `/Users/olifreuler/.stormforge/team-mailbox`
- Mailbox writes use the atomic lock at
  `/Users/olifreuler/.stormforge/proxywar-operators/mailbox-write.lock`.
- Put every Coworld episode or batch under the foreground supervisor:

  ```bash
  /Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh run hrafn HRAFN_RUN_ID \
    --output /private/tmp/hrafn-new-output-a \
    --output /private/tmp/hrafn-new-output-b \
    -- /absolute/path/to/hrafn-batch-script.sh
  ```

  Outputs must be new dedicated directories under
  `PROXYWAR_RUNNER_OUTPUT_ROOTS` (default `/private/tmp`). When detaching, put
  this complete wrapper command inside the screen session. Never acquire in a
  short-lived shell, launch Coworld separately, remove an ownership marker, or
  release another run's lease.
- Use plain English in repository and mailbox traffic.
- Public game text stays short leetspeak.
- Do not leave background episodes without a durable owner and completion
  receipt.
- The lease status reported clean `free` with no supervisor or child at the
  cycle-close check. The foreign unsupervised Qd1n ZG1 pair is terminal and its
  matched loss is source-rejected and quarantined in mailbox commit `0ae6f62`.
  Hrafn did not touch the foreign process or outputs and started no Coworld
  episode. The active Hrafn arm is independently rejected at
  `LOCAL_QUALIFIED`.

## Current cross-audit receipts

- Hrafn's completed Round 533 evidence and the then-missing ZG1 terminal proof
  were posted in mailbox commit `8a2b54a`. The later terminal ZG1 source-reject
  packet closes that evidence gap but authorizes no further ZG1 run.
- Hrafn audited Odin PG2 only from `origin/rci/pg2`, the immutable bundle, and
  hash-pinned image bytes. Mailbox commit `ee7ea9b` records `APPROVE` for one
  sequential 80-decision A-then-B canary only. The embedded `gc2` filenames and
  stale README `150-step` wording do not override the formal JSON hashes. The
  verdict grants no matrix, upload, hosted, submission, membership, or champion
  authority.
- The same receipt acknowledges Hrafn ownership of the corrected KF1 supporter
  sequence: strict fail-closed survivor proof, donation only to Odin when an
  exact legal donation exists, otherwise marked hold. KF1 remains a separate,
  not-yet-started arm; supporter versions precede Odin KF1.
- Odin's repaired PG2 request in mailbox commit `a0e233f` superseded the prior
  approval because source, image, bundle, and spec hashes changed. Hrafn
  returned fresh `APPROVE` in `a2fd925` after committed-source, `163/163`,
  image, formal-pair, archive, manifest, and runner review. That verdict opens
  only amd64 transport validation followed by one sequential 80-decision
  A-then-B canary.
- The same `a2fd925` receipt requests Odin review of committed KF1 source and
  negative controls. It names positive reach and immutable qualifier hashes as
  missing evidence and keeps every run and promotion state closed.

## Autonomous promotion

The user granted standing authorization on 2026-07-19 for automatic
`hrafn-fylking` diagnostic uploads, hosted requests, league submissions,
membership changes, and champion changes after every gate in
`AUTONOMOUS_PROMOTION.md` passes.

The required order is source proof, local qualification, matched advantage,
diagnostic upload, hosted `4/4`, regression `20/20`, Odin final cross-audit,
submission, placement, membership/champion verification, and completed-round
confirmation. No additional user `GO` is required. Any failed gate stops the
promotion.
