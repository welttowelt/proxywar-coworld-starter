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

Verified against the Coworld/Softmax API at `2026-07-19T10:20:39Z`:

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

Source and deployment remain separate. The corrected VR1 candidate is source
commit `7730b7536dcceed9a152cbf2f726f8324ca31ece` and local-only linux/amd64
image `sha256:41fe4984ba3623f995d188a707c1d28ec72863a9bd782a097d74bf8d1448cc29`.
Its embedded strategy and player SHA-256 values are `68dee34a...` and
`16922c32...`. The quick-chat-only control is branch
`rci/hrafn-v6-quickchat-control`, commit
`35405a4468c821af7ec1c8f2ef64fb6def4c0c1d`, and local-only linux/amd64 image
`sha256:b7c6c1fb8e5bbee02d80ba156187bab6bb5ca996b2a4f5ddc8cc871c0989646c`.
No `hrafn-fylking:v6` upload exists, and neither local candidate has been
submitted, placed, or made champion.

The player hash above corrects the prior `1154115f...` ledger value, which is
the SHA-256 of `llm-player.mjs`, not Hrafn's `/app/hrafn-player.mjs`. Both exact
images and their corresponding source commits agree on `16922c32...`.

Current field checkpoint:

- Hrafn is overall rank `10`, score `1.3639688509793433`, after `20` completed
  Competition rounds. Daveey leads at `32.849621422869966`; Odin is second at
  `20.360049965243494`.
- Round 528 failed. Round 529 completed with Hrafn rank `12`, score `0`; Round
  530 is running.
- Round 529's four Pangaea episodes were outsider wins by Auri, daveey twice,
  and Richard Higgins. Hrafn went `0/4` and finished with `4,142`, `69,786`,
  `3,170`, and `19,827` tiles. All `439/439` decisions were accepted with zero
  fallbacks, rejects, or K1Z harm. There were `21` productive `dn1` transfers
  and `29` live `rv3` executions across the two daveey episodes.
- The Richard episode contained two accepted Hrafn holds at turns `3,500` and
  `3,600`: game-authored quick-chat actions were withdrawn, then the retry chose
  hold while attacks and a build remained submission-legal. Any challenger must
  eliminate this retry path without confounding its tactical comparison.
- Round 530 is still running with v5 sealed. Two of four World episodes have
  completed. Daveey won the first and Hrafn survived with `123` tiles. The
  second reached turn `50,400` without an outright winner; Hrafn was eliminated
  with zero tiles while Juryoku held the top score. Across Hrafn's two replays,
  all `338/338` decisions were accepted with zero holds, fallbacks, rejects, or
  K1Z harm, `30` `rv3` executions, and `11` productive `dn1` transfers. The
  one remaining episode failed with an unattributed game error and the other is
  still running, so there is no round verdict yet.
  Replay SHA-256 values: `f06a7baf...` and `7cc46d31...`.

## VR1 corrected pre-run state

Odin returned `REVISE / NO RUN` in mailbox commit `02ea001`. The corrected
candidate now requires the outsider to lead Hrafn by at least one percentage
point, and a lock survives only from the immediately prior `vr1` decision.
Both requested red cases failed before the fix and now pass; the candidate
suite is `153/153`. The quick-chat-only control suite is `149/149`.

The exact live parent, quick-chat control, and VR1 candidate images are pinned
by immutable IDs. The canonical Coworld `0.1.8` manifest and seven fresh job
requests are recorded in
`experiments/preflight-hrafn-v6-vanguard-lock-vr1.json`. The design compares
exact v5 against the quick-chat control for withdrawal-hold repair, then the
control against VR1 for tactical attribution. Current promotion state is
`SOURCE_READY=true`; `LOCAL_QUALIFIED` and every later state remain false.
Odin rereview is required before runner acquisition or any qualifier.

Coalition control:

- `K1Z odin free` is on `qd1n:v89`, policy version
  `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`, membership
  `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`, competing active and champion.
- Reopen live memberships before any diagnostic upload or promotion. Never
  infer current deployment from this dated snapshot.

## Branch truth

This Hrafn policy branch intentionally diverges from Qd1n main. At the
2026-07-19 09:36 UTC check it was 106 main commits behind and, including this
identity correction, 27 commits ahead.
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
- Acquire and announce runner ownership before a Coworld episode with
  `/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh
  acquire hrafn`; release it after the episode or completed batch.
- Use plain English in repository and mailbox traffic.
- Public game text stays short leetspeak.
- Do not leave background episodes without a durable owner and completion
  receipt.
- Runner status was `free` at `2026-07-19T10:29:50Z`; no local Hrafn episode
  started because the v6 pre-run audit gate remains open.

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
