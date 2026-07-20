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

Studio's shared `/Users/odin/.softmax` profile remains owned by Katanasan and
Gravity. Hrafn uses the isolated real home `/Users/odin/.hrafn-coworld-home`
through `HRAFN_SOFTMAX_HOME`; never overwrite or swap the shared profile. This
changes only the Coworld identity probe. Repository, mailbox, and runner lease
paths remain under the normal `/Users/odin` home.

## Current HI1 truth

Coworld's pinned external-agent request currently has seven root fields, but
only `legalActions` and `observation` are selector inputs. Hrafn accepts a plain
request object with unrelated root metadata, requires `legalActions` to be an
array and `observation` to be a plain object, then structured-clones exactly
those two fields. Duplicate detection and the independent auditor bind that
projected selector input. Missing or malformed selector fields fail closed.

The prior `hi1-pangaea-control-2c462243-r3` attempt is invalid and cannot be a
predecessor. It produced no result or replay. All artifacts tied to source
`2c462243` are obsolete.

Before the next episode:

1. Pull the latest pushed Hrafn branch and mailbox `main` explicitly.
2. Verify the local source is clean and run the full suite.
3. Build the exact linux/amd64 image from `git archive HEAD`.
4. Generate a fresh image receipt and the four fixed HI1 jobs.
5. Require exactly one current Odin `HI1_IDENTITY_WINDOW_READY` packet bound to
   those hashes; formal approvals consumed must remain zero.
6. Verify the active identity is exactly `K1Z Hrafn` and the Studio foreground
   runner lease is free.
7. Run the ordered chain: Pangaea control, Pangaea candidate, Asia candidate,
   Asia control. Stop on the first failed preflight, operational receipt, audit,
   identity check, K1Z safety check, or campaign stop verdict.

Use the Hrafn-owned foreground wrapper:

```bash
"$HOME/proxywar-k1z-hrafn/scripts/proxywar-runner-lease.sh" status --json
```

No diagnostic result authorizes promotion. Hosted `4/4`, regression `20/20`,
and the single final Odin formal approval remain downstream gates.
