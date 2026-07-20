# Mickey Mouse intent entrant

## User directive

On 2026-07-20, Oli directly requested a new ProxyWar warrior named Mickey
Mouse and asked that it use intent-based control. This authorizes a separate
Softmax player, policy upload, and league entry. It does not authorize mutation
or retirement of Odin or Hrafn.

## Identity and isolation

- player display name: `K1Z Mickey Mouse`
- policy lineage: `mickey-mouse-intent`
- source branch: `codex/mickey-mouse-intent`
- source parent: exact live-v89 base plus the bounded ID1 source at `1e8386bf`
- credentials: dedicated `0700` HOME with a player-scoped active identity
- runner lane: `mickey`; never borrow `odin` or `hrafn`

Softmax rejected creation with HTTP 409 and the exact reason `Users are limited
to 2 active players`. The account's two active slots are Odin and Hrafn. This
is an external launch blocker, not permission to retire, rename, or disable
either player. Until Oli explicitly chooses a slot or supplies another account,
Mickey remains a source-complete candidate with no player ID, upload, or league
membership.

## Architecture

The LLM receives a compact board summary without legal action IDs or labels. It
may return exactly:

```json
{"intent":"grow|convert","targetID":null,"horizon":2}
```

`grow` requires a null target. `convert` requires an exact currently visible
player ID. Horizon must be an integer from 2 through 12. Unknown keys,
malformed values, stale plans, planner errors, active pressure, protected
targets, unsafe actions, and unavailable targets all return control to the
full-menu deterministic selector.

The selector alone chooses the exact server-offered legal action. Intent is
nonblocking and expires. `mm1g` and `mm1c` appear only when a valid intent
causes a real grow or convert action delta.

## Coalition guard

Mickey protects the stable IDs and canonical names of Odin, Hrafn, Katanasan,
and Gravity unless an observed incoming attack revokes protection. This is
one-way at launch: existing Odin and Hrafn policies do not yet recognize the
new Mickey player ID. Their policy source and memberships remain untouched.

## Launch gates

1. Full source and integration suite green.
2. Independent source RCI has no blocking finding.
3. Immutable source commit is pushed.
4. Exact linux/amd64 image is built and byte-checked.
5. Local qualifier/runtime proof has accepted decisions and zero K1Z harm.
6. Hosted Bedrock probe proves at least one nondegraded intent-backed decision,
   accepted legal actions, and zero K1Z harm.
7. The isolated mutation wrapper verifies the exact Mickey player before upload
   and submission.
8. Post-submit checks independently preserve Odin `qd1n:v89` and Hrafn
   `hrafn-fylking:v5`.

## RunPod CPU lane

RunPod CPU is the evaluation harness, not a way around the Softmax player cap.
The canonical credential-free amd64 bundle can run matched candidate/control
episodes on an isolated CPU pod. It does not carry RunPod, AWS, Coworld, or
Softmax credentials, and its receipt proves transport and artifact integrity
before any performance claim. Dynamic Bedrock intent is therefore not proven by
the credential-free RunPod rung; that rung exercises deterministic fallback
unless a separately reviewed local intent fixture is used. A real hosted probe
is still required for nondegraded planner evidence.

The first CPU diagnostic is a preregistered five-player Pangaea/Normal matched
pair at seed `20260720` and 80 decisions. Mickey occupies slot 1 in both arms;
arm A runs `mickey-intent`, while arm B replaces only that process with exact
`qd1n-v89`. Odin, Hrafn, Gravity, and Katanasan occupy identical slots in both
arms. This is a one-seed mechanism/safety screen, not promotion evidence.

The direct user instruction permits an experimental fresh-entry activation
after these source/runtime/safety gates. It is not a claim that Mickey passed
the standard `4/4` hosted performance or `20/20` regression promotion gates.
Those remain open and must be reported as open.
