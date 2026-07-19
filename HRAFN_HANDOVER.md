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

Verified against the Coworld/Softmax API at `2026-07-19T08:51:09Z`:

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
  `7620684b07c9dc9c633d284e817348c92881b43724291f991296c7a17ac20807`.
- Exact live image: linux/amd64
  `sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d`.

Source and deployment remain separate. Repository policy code is unchanged
from `bb7d9fffc862e5d51cf24f38d1731630275b4f27`; its current Hrafn strategy
comes from `38fca3074922dba35a5aa6083481f12874b564be` and is present in the
local-only linux/amd64 image
`sha256:816b734c205fad2452eaef3c076f27377939c4a78a4336fd63d7ae313b5be410`.
That image has not been uploaded, submitted, placed, or made champion.

Current field checkpoint:

- Hrafn is overall rank `10`, score `1.4586056014851456`, after `19` completed
  Competition rounds. Daveey leads at `32.3469131443621`; Odin is second at
  `20.956682450012572`.
- Round 527 completed with Hrafn rank `12`, score `0`. Round 528 failed and does
  not extend official-round evidence. Round 529 is running.
- The first two completed Round 529 Pangaea episodes were outsider wins by Auri
  and daveey. Hrafn scored zero in both and finished with `4,142` and `69,786`
  tiles. Across `205` Hrafn decisions, all were accepted with zero holds, zero
  fallbacks, zero rejects, and zero K1Z harm; eleven `dn1` transfers were
  productive. The live `rv3` mechanism reached fourteen times only in the
  daveey episode.

Coalition control:

- `K1Z odin free` is on `qd1n:v89`, policy version
  `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`, membership
  `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`, competing active and champion.
- Reopen live memberships before any diagnostic upload or promotion. Never
  infer current deployment from this dated snapshot.

## Branch truth

This Hrafn policy branch intentionally diverges from Qd1n main. At the
2026-07-19 RCI check it was 94 main commits behind and 22 commits ahead. Do not
merge `origin/main` blindly: Qd1n and Hrafn policy code have separate ownership
and experimental histories.

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
