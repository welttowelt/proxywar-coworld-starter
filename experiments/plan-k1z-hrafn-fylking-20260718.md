# K1Z Hrafn: Implementation and Promotion Record

Status at 2026-07-18 16:47 CEST: the player, reciprocal protection, runtime,
tests, exact images, and three challenger versions exist. V3 finished its
diagnostic at `0/4` Odin firsts, then opened the exact-live confirmation at
`0/3`. Hrafn has no league submission or membership and v3 is rejected.

## Identity and role

| Field | Exact value |
| --- | --- |
| Player | `K1Z Hrafn` |
| Player ID | `ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863` |
| Policy | `hrafn-fylking` |
| Candidate | `hrafn-fylking:v3` |
| Candidate version ID | `4e4df3e4-b8b3-4409-9483-f6dc7a19e23b` |
| Policy ID | `e483e9fe-7c3a-4e7b-9e67-3140b17a3de2` |
| Role | adaptive outsider interceptor |
| Allegiance | Odin first; Katanasan and Gravity protected |

`Hrafn` is Old Norse for raven and an attested name element. `Fylking` is a
battle array or host. The public identity is visibly K1Z; no hidden affiliation
or private opponent data is used.

Sources:

- [University of Bergen ArcNames catalogue](https://arcnames.w.uib.no/files/2021/06/ArcNames-Catalogue-of-semantic-themes.pdf)
- [Old Norse Online: fylking](https://lrc.la.utexas.edu/eieol_english_meaning_index/norol/18)
- [Zoëga dictionary: hrafn](https://norse.ulver.com/dct/zoega/h.html)

## Live coalition snapshot

The official API snapshot taken after roster drift on 2026-07-18 shows:

| Player | Player ID | Live champion |
| --- | --- | --- |
| `K1Z odin free` | `ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c` | `qd1n:v89` |
| `K1Z katanasan` | `ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba` | `tsukuyomi-no-kage:v39` |
| `K1Z juryoku-koku` | `ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335` | `santai-juryoku:v3` |
| `K1Z Hrafn` | `ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863` | none |

Qd1n, Katanasan, and Gravity were promoted first with reciprocal Hrafn
protection. Hrafn itself remains a challenger so a weak kingmaker cannot dilute
the live roster.

## Implemented safety contract

1. Protect coalition members by exact player ID and canonical public name.
2. Canonicalize Unicode, separators, whitespace, case, and one optional K1Z
   prefix.
3. Never attack, invade, nuke, target, embargo, reject, or break an alliance
   with a protected member.
4. Prefer alliances with Odin, Katanasan, and Gravity without replacing a
   reliable combat action with a transient social action.
5. Make no donations; Gravity owns the relay role.
6. Use only the policy's public observation and legal actions.
7. Hold when no safe legal action exists.
8. Keep every player-controlled public reason short, ASCII, tagged, and
   leetspeak.

The current test suite has 147 passing tests, including coalition-name variants,
exact-ID protection, leader handoff, ratio floors, action reliability, and
public-reason checks.

## RCI sequence

### v1: generic strongest-outsider pin

- Version ID: `4b2b0074-c244-4225-b937-266364753b14`
- Hosted request: `xreq_d36a8049-d4c2-473b-a05a-f304f759e3a9`
- Result: Odin `0/4`; winners Auri, Auri, Richard, Auri.
- Reliability: all Hrafn decisions accepted, zero Hrafn holds or fallbacks,
  and zero K1Z harm.
- Diagnosis: Hrafn spent troops at weak ratios against whichever outsider was
  locally strongest and helped Auri convert the field.
- Verdict: rejected; no submission.

### v2: fixed Auri-first pressure

- Version ID: `cd13a53c-586a-438e-bef9-6975ab9a3dc9`
- Hosted request: `xreq_8f5d001e-dcd8-4fd1-a339-d0dda750f658`
- Result: Odin `0/4`; winners Richard, Richard, Richard, Auri.
- Reliability: all Hrafn decisions accepted, zero Hrafn holds or fallbacks,
  and zero K1Z harm.
- Diagnosis: Auri was suppressed, but the fixed target transferred the
  snowball to Richard.
- Verdict: rejected; no submission.

### v3: adaptive leader handoff

V3 begins with Auri pressure, then tracks the strongest outsider by visible tile
share. It switches only when the outsider leads Auri by more than five
percentage points. Direct attacks require a relative troop ratio of at least
1.35; otherwise Hrafn uses bounded `target_player` pressure. The mechanism is
tagged `rv3`.

Exact images:

- arm64: `sha256:3be7499dd241dbb04ddd271c0a6c11151025e201cb28e5a41bbfc7cfaf75bb93`
- amd64: `sha256:5925486bc37212f0e0ca15511a34e672d9f13bb735220b6d1cbfa067ae67da80`

Requests:

- `xreq_4ed65079-e5fd-443c-b892-e45a3524b809`: diagnostic created with
  `qd1n:v87` and `Eva-00:v25`; it finished `0/4` with daveey, Auri, Richard,
  and Richard wins. Hrafn executed `rv3` 26 times with all `216` Hrafn
  decisions accepted, zero Hrafn holds or fallbacks, and zero K1Z harm. Odin
  used fallback behavior in `373/385` decisions. Hrafn died in all four.
- `xreq_550333e2-38ff-4631-86d5-75b9a06fcd26`: exact-live gate with
  `qd1n:v89`, `Eva-00:v26`, Auri v42, daveey v22, Richard v7, Gravity v3, and
  Katanasan v39. Richard won its first three completed episodes with
  `875,938/868,209/874,679` tiles; Odin finished at
  `38,587/37,230/29,044`. Hrafn executed `rv3` 25 times and kept all `287`
  decisions clean. This confirmation cannot reopen v3 promotion after the
  diagnostic hard-fail.

V3 is rejected. The 20-episode request was not created and no Hrafn version was
submitted.

## Promotion gates

1. Exact-live four-episode gate: Odin first in `4/4`; `rv3` present in every
   episode; zero K1Z harm; all Hrafn decisions accepted; zero Hrafn holds,
   rejections, or fallbacks; every replay digest verified.
2. Exact-live 20-episode regression: the same conditions in `20/20`.
3. Switch the CLI to player `K1Z Hrafn` only after both gates pass.
4. Submit the passing version once with `--auto-champion always`.
5. Verify the exact submission and champion membership, then restore Odin as
   the default local player.
6. Audit Hrafn's first official replay before any successor version.

These gates qualify one live Hrafn submission. They do not count toward the
1,000-first-place streak; only completed official league rounds count.

The v3 diagnostic failed step 1, so steps 2-6 are closed for v3. A new Hrafn
version must begin a fresh gate sequence. The replay evidence also isolates the
larger fleet constraint: Hrafn handed pressure from Auri to Richard as designed,
but Odin's fallback-dominated chassis did not convert the support.

## Evidence contract

Every evaluated episode records the exact policy versions, image, roster, map,
seat, replay digest, winner, Odin result, Hrafn survival and tiles, `rv3`
executions and targets, K1Z mutual harm, accepted decisions, holds, rejections,
and fallbacks.

Source code, unit tests, an uploaded policy, or a dashboard badge never proves
deployment. A submission claim requires an official submission ID; a live
claim requires an official champion membership; dominance requires completed
round evidence.

## Operator-directed activation and roster repair

The operator later authorized a new Hrafn submission despite the earlier v3
outcome-gate rejection. The first submitted entry,
`hrafn-fylking-support:v1`, used `auto_champion=never`; it placed but never
entered the official champion roster. That inactive membership was retired.

The repaired entry re-uploaded the audited v4 executable as
`hrafn-fylking:v5` (`10c32300-4593-408a-a17d-02e1d70e4a2e`) and submitted it
with `auto_champion=always` as
`sub_635f34a0-e2c2-4fa6-97aa-9c864e93974c`. Qualifier Round 318 completed
successfully. Competition membership
`lpm_e822de7f-1124-4b5f-b0ef-1025d46ae211` is active, competing, and champion.
The CLI default was then restored to Odin.

Competition Round 506 sealed at `2026-07-18T17:00:18Z`; Hrafn became champion
at `2026-07-18T17:01:51Z`. Round 507 is therefore the first eligible official
roster check. Until that roster is sealed, the evidence proves activation but
not official Competition participation.
