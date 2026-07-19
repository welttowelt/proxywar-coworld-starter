# Hosted policy experiments

## Hrafn v6 vanguard-lock preflight, 2026-07-19

The live parent is `hrafn-fylking:v5`, exact source `0c151570`, exact
linux/amd64 image `sha256:3f427fd3...`. Round 529 supplies a direct tactical
cell and a separate quick-chat withdrawal-hold defect.

The daveey replay gives `vr1` a direct causal cell. At turn 7,400 Hrafn held
30% of land, daveey led with 46%, daveey was the only attackable rival at a
1.61 relative troop ratio, and 10/25/40 attacks were legal. Live v5 instead
donated 338,869 troops to Odin. The corrected candidate moves a legal leader
attack ahead of that donation only when the outsider leads Hrafn by at least
one percentage point and Hrafn is inside the executable 10%-30% activation
range. It retains that exact front only when the immediately prior decision was
`vr1` and the ratio remains at least 1.10.

Odin's first pre-run verdict was `REVISE / NO RUN`. Both requested VR1 red
cases failed before the correction and now pass. Round 531 then exposed two
embargo-stop withdrawal retries outside the quick-chat-only control. Two new
`wr1` recovery cases failed before the fix. Round 532 subsequently exposed the
same retry path after two withdrawn K1Z alliance requests, a class the first
WR1 revision did not cover. A new alliance-request test failed red-first on
both candidate and isolation control (`hold` instead of the legal 8% boat).

The revised combined candidate is exact source commit `cfdcd5a6`, passes
`157/157`, and is pinned to amd64 image `sha256:02439078...`. The tactical
isolation control is branch `rci/hrafn-v6-withdrawal-recovery-control`, commit
`6f1ace3e`; it passes `153/153` and is pinned to image `sha256:aa5c15a3...`.
Embedded strategy and Hrafn player bytes match both images. The control includes
quick-chat suppression and withdrawal recovery but not VR1.

Odin's corrected rereview accepted source, isolation, image, manifest, and job
identity, then returned a docs-only `REVISE` because this record described a
6%-35% activation range. Source actually uses `activationTileShare=0.1` and
`activationCeiling=0.3`. The record and preflight now pin the executable
10%-30% range. The old packet was never run and is superseded by the recovery
revision. The later round-532 extension retains those VR1 boundaries and changes
only the WR1 withdrawal kind set plus its red test; its current suite and image
identities are recorded above.

The canonical Coworld `0.1.8` manifest and nine regenerated requests are pinned
in `preflight-hrafn-v6-withdrawal-recovery-wr1.json`. The four-arm factorial
compares exact v5, quick-chat-only, withdrawal-recovery control, and VR1 plus
withdrawal-recovery candidate across two orientations. Odin approved the exact
revised source, images, manifest, and request hashes at mailbox commit
`66c9752`.

The pinned qualifier request `d26705a5...` completed under the foreground
runner-v2 supervisor with a verified replay and clean release to `free`. Hrafn
accepted `303/303` decisions with zero Hrafn fallbacks, rejects, or K1Z harm,
but selected ten holds and reached neither mechanism (`vr1=0`, `wr1=0`). Seven
holds retained legal boats, so the retry guard did not explain or recover them.
Replay SHA-256 is `108f86ab...`; the exact audit is
`audit-hrafn-v6-withdrawal-recovery-qualifier-r532-20260719.json`. The arm is
rejected at `LOCAL_QUALIFIED`: no matched request, upload, hosted `4/4`,
regression `20/20`, final audit, submission, placement, membership, or champion
state opened.

Round 530 failed after two live World replays completed. A third request failed
with an unattributed game error, and the fourth was cancelled with
`round_failed`. Daveey won the first; the second reached turn 50,400 without an
outright winner. Hrafn's `338/338` decisions were accepted with zero holds,
fallbacks, rejects, or K1Z harm, and the replays contain 30 `rv3` executions
plus 11 productive `dn1` transfers. Retain the replay evidence, but assign no
official rank, score, or promotion verdict to the failed round. Replay SHA-256
values: `f06a7baf...` and `7cc46d31...`.

Round 531 completed across four Pangaea replays. Odin, daveey, and Richard
Higgins won three; the other reached turn 50,400 without an outright winner.
Hrafn went `0/4`, official rank `12`, score `0`, with `45,791`, `15,486`,
`191,322`, and `0` tiles. All `793/793` decisions were accepted with zero
fallbacks, rejects, or K1Z harm, with 45 `rv3` executions and 39 productive
`dn1` transfers. Thirteen accepted retry holds followed withdrawn actions:
eleven quick-chat actions and two embargo-stop actions while productive actions
remained legal. The isolated quick-chat control covers the eleven quick-chat
holds. The two embargo-stop holds supplied the replay cell for `wr1`; source is
ready, but the pre-run audit gate remains closed, so no Hrafn runner episode
started. Replay SHA-256 values:
`9ed404da...`, `a31b7527...`, `f0f3838a...`, and `bf8759e0...`.

Round 532 completed across four World replays. Hrafn went `0/4`, official rank
`13`, score `0`, with `757`, `0`, `86,517`, and `0` tiles. Odin topped the
50,400-turn episode and won another; daveey and Auri won the other two. All
`961/961` Hrafn decisions were accepted with zero fallbacks, rejects, or K1Z
harm. Hrafn recorded 49 `rv3` executions and eight productive `dn1` transfers.
One loss contained nine accepted retry holds: seven after withdrawn
embargo-stop actions and two after withdrawn K1Z alliance requests at turns
10,200 and 10,700 while boats remained submission-legal. Those two requests
superseded Odin's approval before any run. Replay SHA-256 values:
`3d2f810c...`, `47e0966f...`, `8c92f5f9...`, and `702aeb5b...`. Detailed
evidence lives in `hrafn-v6-withdrawal-recovery-r532-20260719.json` and
`ledger-hrafn-live-v5-round532-20260719.ndjson`.

Round 533 remains incomplete at three of four Pangaea episodes. The completed
replays were won by Richard, RelhAlpha, and Auri; Hrafn accepted `439/439`
decisions with eight holds and zero Hrafn fallbacks, rejects, or K1Z harm. The
new Relh replay adds a `target_player` withdrawal retry at turn 5,100: Hrafn
held while three attacks and eighteen boats were legal. Current WR1 does not
cover that class. This partial live evidence does not reopen the qualifier-
rejected arm.

## Pangaea seat-2 A/B, 2026-07-12

Goal: test whether preserving an active favorable target finish across a Claude
plan refresh improves the recurring Pangaea seat-2 failure.

Both requests used `tournament-4p-pangaea` with the same pinned roster:

| Slot | Policy |
| ---: | --- |
| 0 | Auri, `proxywar-keystone:v4` |
| 1 | odin free, v11 baseline or v12 candidate |
| 2 | Richard Higgins, `proxywar-starter-b:v1` |
| 3 | James Boggs, `jamesboggs-warlord:v1` |

| Policy | Experience request | Wins | Final tiles | Fallbacks | Cost |
| --- | --- | ---: | --- | --- | ---: |
| v11 | `xreq_c7cca314-eba3-4952-96b3-5e51776de43c` | 1/2 | 0; 87,140 | 1; 13 | $0.038653 |
| v12 | `xreq_0f4e09cc-a1c9-4d4c-ba94-541be3fa01ba` | 2/2 | 85,795; 91,398 | 1; 1 | $0.028662 |

All four episodes completed. v12 recorded zero holds and zero rejected actions.
Its replays show the new rule preserving favorable attacks after the planner
switched targets, including attacks on Auri at 1.59x to 3.36x troop advantage
while the current plan named Richard Higgins. The small sample supports hosted
promotion but does not prove a deterministic effect because episode seeds and
Claude plans vary.

### Episode evidence

| Policy | Episode | Result | Replay SHA-256 |
| --- | --- | --- | --- |
| v11 | `8284cc62-88cb-45cd-8f55-2af4ff0f6b50` | loss, 0 tiles | `3fdc5b257767f70183cd80f96f21aa19b8aaf401c8d01b617c5d42704447c867` |
| v11 | `3b512e05-859a-40d3-9a45-9ad974d2fb7a` | win, 87,140 tiles | `34a9af2fc7861fcb6c915c8ff66eb4a5510d72caac86e53e0db02e7d1ae67b02` |
| v12 | `68e95f1f-4987-4ca7-a28a-377a4662696b` | win, 85,795 tiles | `8797a7b1b1c328d36809f934bfc25923fc15dbeec6376005a8fc5deb6627229f` |
| v12 | `1167f7a9-90db-475d-9bfb-93efec3ae8af` | win, 91,398 tiles | `6fbb5546614b7dad6a470b98ad756eaf877f16b0e52da5c27cf2c095cde77517` |

## Asia seat-4 alliance-race A/B, 2026-07-12

Goal: reproduce the Round 200 fallback hold and test whether keeping tactical
moves ahead of alliance requests removes the simultaneous-resolution race.

Both requests used `tournament-4p-asia` with Richard Higgins in slot 0, James
Boggs in slot 1, Auri in slot 2, and our baseline or candidate in slot 3.

| Policy | Experience request | Wins | Final tiles | Policy fallbacks | Holds | Cost |
| --- | --- | ---: | --- | --- | ---: | ---: |
| v12 | `xreq_dd739322-ef28-48c7-be1a-7f22d3210c2b` | 2/2 | 223,088; 214,487 | 24; 8 | 1 | $0.059173 |
| v13 | `xreq_78a13fb9-e3de-4abd-96ba-469009dd3515` | 2/2 | 219,452; 216,450 | 13; 16 | 0 | $0.033436 |

The v12 hold reproduced the Round 200 race at turn 2,200. v12 returned
`alliance:r5o3pta1` while nine attacks and 18 boats were legal; the alliance ID
disappeared during simultaneous resolution and the runtime substituted `HOLD`.
v13 selected no alliance request in either episode and recorded zero holds and
zero rejected actions. Hosted Qualifier Round 36 also completed successfully.

| Policy | Episode | Result | Replay SHA-256 |
| --- | --- | --- | --- |
| v12 | `53592caa-a7a9-49c8-8358-ff775a17f6f0` | win, 223,088 tiles | `02a3a910e8e928a3bcdcf5de074eaa5f6d0160076c836a29bdfbed81dfe993bc` |
| v12 | `f9d763e3-387c-4c5b-b786-109e75df7516` | win, 214,487 tiles; one hold | `8709ba7ad777fb20ef0223fc7b668e35f0ff68443fc728ec5fcdf1fcbfebefdd` |
| v13 | `ecc7830b-b2fb-4912-8f1f-f90609c7e0ec` | win, 219,452 tiles | `de52c2b411336cce41f9b9204c03ef941eb0e2eacbf33ea4e66693556b80bcbe` |
| v13 | `357ec50d-9cec-4bdf-87cf-69e4b665aede` | win, 216,450 tiles | `5ee3c736aae004bff87f86b3beb57878e318983e9f20b4a8cf81af1b3f43e074` |

## Pangaea seat-4 conversion A/B, 2026-07-12

Goal: test whether a favorable rival conversion should outrank the escape-boat
branch after neutral expansion stalls.

Both requests used `tournament-4p-pangaea` with Auri in slot 0, Richard Higgins
in slot 1, James Boggs in slot 2, and our baseline or candidate in slot 3.

| Policy | Experience request | Wins | Final tiles | Holds | Cost |
| --- | --- | ---: | --- | ---: | ---: |
| v13 | `xreq_faf27e95-c5d2-4102-9989-aeb0b85f4186` | 1/2 | 7,554; 88,348 | 0 | $0.041531 |
| v14 | `xreq_4b18ca01-e3fd-4eee-88d8-629ad2b3f4ae` | 1/2 | 14,020; 89,765 | 57* | $0.041255 |

The tactical branch moved in the intended direction. The v14 loss made 26 rival
attacks and 16 boat moves; the v13 loss made 13 rival attacks and 27 boat moves.
At turn 6,300, v14's external player timed out and did not reconnect. All 57
holds occurred afterward under the game's generic opportunistic fallback, not
under v14's selector. No policy logs were available, so the timeout remains
unclassified and v14 failed the promotion gate.

| Policy | Episode | Result | Replay SHA-256 |
| --- | --- | --- | --- |
| v13 | `99c87834-b30f-4948-8e6f-b3421cbbef21` | loss, 7,554 tiles | `3f4ceb88c8d622717f67c95ad8ce873834b009e9b3f8f3d56bb93ced571d2efb` |
| v13 | `552cbdba-4bf3-4e78-91b4-6b0a2860dced` | win, 88,348 tiles | `3756d712fc2fd52710f7061ee155eeccc52fdc56ea9c2b7141377057b6639f59` |
| v14 | `f0342f5c-4f67-40a9-803b-c16da9faaa24` | loss, 14,020 tiles; timeout | `ed20969b4f92f87ab5ba6eeff4c7d2bf915ddeaf2a6c6fcaf6d6113a357490ec` |
| v14 | `200241b8-1b07-4287-ab6a-8b086b73f617` | win, 89,765 tiles | `0ef083754d1ba9b262a701ea266063d7fd7ea85700bfdca15eb3e0809dbfccc0` |

### v14 reliability retry

Experience request `xreq_52ff88e9-5909-43fa-87fe-453de6d87ccb` repeated the
same pinned v14 seat-4 configuration after Round 203. v14 won both episodes
with 90,409 and 83,616 final tiles. Its 169 decisions included 92 rival or
neutral land attacks, 59 boats, 10 builds, two warship actions, and six spawn
records. Both episodes completed normally with zero holds, zero rejected
actions, zero timeouts, and zero socket disconnects. Planner fallbacks were
bounded at one and eight and did not transfer control to the game's generic
fallback brain. The total hosted cost was $0.031653.

| Episode | Result | Replay SHA-256 |
| --- | --- | --- |
| `ba381abc-f0bd-478a-9a26-a1204218095a` | win, 90,409 tiles | `f628352858f4743c95f71101694ea1c967b2ab991a596b73dba71426217ecded` |
| `2a4293c7-8bce-4cd0-935d-a2882dd5fec4` | win, 83,616 tiles | `f64886f226e26c8d9020e4ad52a8e35d6f76edb8272e131c35e9d27152dec1b4` |

The retry cleared the reliability blocker from the first v14 request. Round 204
locked v13 in its entrant list at 02:30:20 UTC. v14 was then promoted through
the league champion endpoint and verified as the sole active champion, leaving
the running Round 204 roster unchanged.

## Asia seat-3 pressure-override A/B, 2026-07-12

Goal: test whether incoming pressure should override a Claude `avoidTargets`
entry for a rival with at least a 1.15x favorable troop ratio. Both requests
used the exact Round 206 seat-3 roster: Richard Higgins in slot 0, James Boggs
in slot 1, our baseline or candidate in slot 2, and Auri in slot 3.

| Policy | Experience request | Wins | Final tiles | Holds | Cost |
| --- | --- | ---: | --- | ---: | ---: |
| v14 | `xreq_7ff69d17-d06c-4933-a433-8d9dfaa7c370` | 2/2 | 221,193; 225,038 | 0 | $0.044182 |
| v15 | `xreq_e6e9fbe4-8f41-4686-935c-2e3b042ad88d` | 0/2 | 4,048; 20,384 | 0 | $0.056909 |

All four episodes completed without rejected actions or a socket-disconnect
signal. v15 used 103 policy decisions with 17 planner fallbacks. Auri won both
v15 episodes, while v14 won both baseline episodes. The requests did not share
fixed seeds, so the result does not establish that the override caused the two
losses. It does reject promotion: v15 added behavioral risk without beating the
current champion on the targeted roster. v15 remains non-champion, and the
candidate rule was removed from the source branch.

| Policy | Episode | Result | Replay SHA-256 |
| --- | --- | --- | --- |
| v14 | `fbef5adf-178c-416f-b721-33ab22344895` | win, 221,193 tiles | `c96db9b8508aecdf19fe5896d9d1c5dd320b624797bc07055ccd96bf328e7a15` |
| v14 | `f2544cfb-f790-445b-95c4-18b2471e4351` | win, 225,038 tiles | `c0487310a5072874c8509be7e50a7774bf10c1eb43d57131318b17b14e58a53f` |
| v15 | `bde44a72-cbda-4cfa-861a-3e9764ff91c7` | loss, 4,048 tiles | `b1c90a5da4ba3c072b264aceb4376ef2bc0c654f45ebe6f08ab2834786c93529` |
| v15 | `3bd8d9b7-a1a3-48e8-9028-4a581abe8dcf` | loss, 20,384 tiles | `9dbd003655fcfae06d6b28b07ca449d423d3edc50def8f52e06b0c46f0a7f853` |

## Pangaea seat-2 survival probes, 2026-07-12

Goal: repair the weakest recurring profile without replacing v14 until a
candidate clears a same-roster gate. Both candidates used Pangaea seat 2 with
James Boggs in slot 0, the candidate in slot 1, Auri v4 in slot 2, and Richard
Higgins in slot 3.

| Policy | Experience request | Wins | Final tiles | Holds | Rejected | Cost |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| v17 / `v1drir-v0rn` | `xreq_fe4cd17a-ef22-4dea-8433-a0ed742075dc` | 0/4 | 264; 502; 0; 0 | 3 | 0 | $0.111916 |
| v18 / `ygg-v0rn` | `xreq_6a3bfe64-78ba-465a-add7-d033a1c58e96` | 0/4 | 484; 0; 656; 7,068 | 0 | 0 | $0.076936 |
| v19 / `hrafn-syn` | `xreq_bba92034-76eb-47fc-8129-14c437248034` | 1/4 | 386; 87,031; 19,940; 0 | 0 | 0 | $0.105125 |
| v14 baseline | `xreq_2fde5089-d10f-4e86-a623-dcd2c8a7a5b7` | 3/4 | not retained | not retained | not retained | not retained |

v17's retreat improvement did not solve the opening. Three episodes eventually
held once a late social action disappeared, and all four lost. v18 removed the
holds but never selected an alliance action. v19 also selected zero alliances
across eight exact audit opportunities and won only one episode. Hosted source
inspection explains the miss: the external request carries the full profile,
objective, strategic state, and legal-action metadata, but the server computes
`tacticalAffordances` only after the external response for the decision record.
The tactical recommendation was therefore never available to v18 or v19.

The three failed candidates also inherited 203 strategy lines added after the
exact v14 source at `dd8dbce`, so their same-profile collapse cannot isolate an
alliance effect. v19 is rejected. The next candidate starts from exact v14 and
changes only one wire-observable opening decision.

| Policy | Episode | Result | Replay SHA-256 |
| --- | --- | --- | --- |
| v17 | `49db144b-e808-4931-adbd-95339c094b3d` | loss, 264 tiles; James Boggs won | `3f2c3e9fa8ac917aa0ec6e62f792fba94272c50173daa9df51666521367e690d` |
| v17 | `c7edd934-6e62-4541-82ee-42bdc13beec6` | loss, 502 tiles; James Boggs won | `40c819b77ba25bf12a40c9ef50de1d785bb4364230fa5aa3cf754de4ff9986a5` |
| v17 | `a0a61f58-6e10-4ebc-bd9a-e8c7e88ed0b1` | loss, 0 tiles; Richard Higgins won | `28c45f32ef56b843c5f8f13f880d9c3e1700e3f7140175e20132ed84559f6982` |
| v17 | `f1c6a6f2-6deb-4d91-8a3b-95103db09d05` | loss, 0 tiles; James Boggs won | `1e1c238ed1d2a2c2e2d1a491bf9a7f093fcadbed36abc08deab443426cadefca` |
| v18 | `12bd5b75-521d-471c-96c6-240813660bb4` | loss, 484 tiles; James Boggs won | `88034a8703ccc07d9732838dd10bbb3c77532f178576f6c7da6587bc57653253` |
| v18 | `6a8bf08f-dfc1-4dbd-8192-230369761eed` | loss, 0 tiles; Auri won | `a15a388aec55ba3ddeec904d98e4992dc301f30adf9902aa1a895ad7db8c481f` |
| v18 | `168f708c-5703-4f1f-8029-9596807d0ecb` | loss, 656 tiles; James Boggs won | `1a585d320868eb53cb0803798a36b5f251e73d3c5217e60b0c4f8c8371177291` |
| v18 | `af68ae17-ef4c-45d8-a73e-faec2108b34c` | loss, 7,068 tiles; James Boggs won | `ed1c096e76cfc215d12ac6c3b0d3f0921bcbe1bc5fb2a8749e0ad9663ba40f72` |
| v19 | `034769f1-dfc9-4a5c-83f9-f32a65db411f` | loss, 386 tiles; Auri won | `7f4b4cc764c6dac6c7d9b961cfb43b3701e6fdc8dfdf7c40c69af09b8ea9f930` |
| v19 | `22aca3ad-d876-4ddb-ba59-8eb3d9b90a7e` | win, 87,031 tiles | `d33034cf07263ed1b3d84c353527efc4474d8d1ef19d60b204f65018ce48ba8a` |
| v19 | `06a7c787-8aaa-4594-9bbb-c5d2ab9c8ad9` | loss, 19,940 tiles; Richard Higgins won | `5eb0ebfe215a3a4a9fb2240c621c5c8dd2fc1e8a9dac0d4f7e9a94d8b25db4fb` |
| v19 | `bc16a277-c4ac-4875-a2cd-aaebfdf0d807` | loss, eliminated; James Boggs won | `8e4b7da94bc81ff8f634252f3491a0ec48cb36d8221e3a0c61302ae77b3ca59a` |

## Asia diplomatic opening candidate, 2026-07-12

v20 / `v1g-e1dr` restores the exact v14 selector and changes one decision: a
diplomatic agent with a live `build_alliance` objective follows its exact
`targetPlayerID` on the first active request. Opening relation `2` is allowed
only through this exact-target branch; v14's ordinary alliance filter remains
unchanged.

The four-seat local Asia run produced a declared winner at turn 6,800. All 268
decisions were accepted with zero holds and zero rejections. The diplomatic
seat selected `alliance:c4o8gv6v` at turn 400, matching both the objective and
the runtime's strongest-rival target, then made zero opening retries. Replay
SHA-256: `065c6c60d003c35cd9aa475785d6f0ff77f31a955a5b372cce94dc0cfe390e08`.

### Hosted result

Experience request `xreq_30f9629c-0018-47f7-8130-01cdb9a637f7` pinned v20 to
Asia seat 3 against Richard Higgins, James Boggs, and Auri v4 for four episodes.
The candidate won one episode with final tile counts of 224,612; 5,098; 32,105;
and 4,235. It recorded zero holds and zero rejected decisions.

The isolated mechanism executed exactly as designed. All four opening decisions
selected `alliance:c4o8gv6v` for Richard Higgins, matched the wire objective,
and were accepted. The result therefore rejects the strategy rather than its
reachability. In the single win, v20 attacked Auri 21 times. It never attacked
Auri in the three losses, and Auri won all three. The alliance did not produce
reliable leader pressure, so v20 is rejected and v14 remains champion.

| Episode | Result | Replay SHA-256 |
| --- | --- | --- |
| `6953a6cb-305f-4200-b0ff-703ce4977268` | win, 224,612 tiles | `2aa1b0823de93155a7d5dda5baded58bf10f34cd11be1269f8cdf217e4465337` |
| `5c935edb-f4b2-46e7-9ad6-900beec1b053` | loss, 5,098 tiles; Auri won | `b184d56ed16699417f688bb1268d896440a0af7fb62ee148d247e49a5ee0a51e` |
| `e0ba6d51-e1dc-4956-816c-69fc0cd1dab3` | loss, 32,105 tiles; Auri won | `9e8640719fc68105d475f3e20495d2ce31f2314bf4b8d152a6be8258e59e7269` |
| `00bd5caa-90a1-4adf-8a13-7f79f180a6d8` | loss, 4,235 tiles; Auri won | `3898ff5caf588a251071e484ad283d0f73082a97ef1d7c20ee620eb5aa75ac66` |

The machine-readable audit is archived in
`experiments/audit-v20-asia-seat3.json`.

## Asia seat-3 collapse-pressure candidate, 2026-07-12

Round 221 isolated the current champion's weakest repeated profile. v14 has
won one of six Asia seat-3 episodes. Auri won all five losses. Across those
losses, attacking Auri remained legal on 34-41 decisions, but v14 selected only
0-2 such attacks and chose neutral growth 19-25 times while Auri was still
legally reachable.

The Round 221 loss peaked at 55,872 tiles, selected two attacks on Auri, then
finished at 2,491 after 21 neutral boats. Auri selected 40 rival attacks and won
with 215,321 tiles. This rules out map geometry and points to v14's 0.9
runaway-leader troop-ratio floor plus neutral-growth fallback order.

v21 / `skuld-h0gg` starts from exact v14 and adds one collapse-only branch. It
selects a 10% attack on the exact leader named by an active Claude attack plan
when the target is the top rival, leads by at least 15 tile-share points, the
policy still holds at least 8% territory, and relative troop strength remains
at least 0.60. Reliable economic builds stay ahead of the branch. The first
hosted diagnostic is pinned in `experiments/gate-v21-asia-seat3.json`; v14
remains champion unless v21 clears that 4/4 diagnostic and a separate 20/20
regression gate.

The five-loss replay ledger and legal-action counts are archived in
`experiments/diagnosis-v21-asia-seat3.json`.

The full local Asia safety run completed at turn 5,700 with a declared winner,
224 accepted decisions, zero holds, and zero rejected decisions. Its replay
SHA-256 is `822ce70d031231998f5c3873c5aeab013d9f13d31fcea2e65b8a05efacacd971`.
Local Bedrock planning was unavailable, so 212 decisions used the deterministic
fallback path and the new plan-gated mechanism was not reachable. The run proves
container, protocol, and selector safety; only the hosted gate can prove the
mechanism and outcome.

The hosted diagnostic request
`xreq_f2b64577-49ae-4ccf-9210-a3a2b447ef20` completed four episodes against the
exact Round 221 roster. Auri v5 won all four; v21 won none and finished with
0, 2,444, 2,491, and 0 tiles. All 187 decisions were accepted with zero holds,
but the collapse-pressure branch executed zero times.

The failure is structural rather than a missing target signal. Claude named
Auri in 67 decisions and Auri was legally attackable in 64. Instead, v21
attacked Richard Higgins 42 times while following an Auri attack plan; 22 of
those attacks happened under incoming pressure. Auri attacked v21 64 times.
Lowering the same troop-ratio floor would repeat the failed mechanism, so v21
is rejected and the exact v14 selector remains champion. The machine-readable
audit is archived in `experiments/audit-v21-asia-seat3.json`.

## Asia seat-3 buffer-preservation candidate, 2026-07-12

v22 / `gr1mnir-vard` starts from exact v14 and changes one action class. If an
active Claude attack plan names the top rival, that leader remains legally
attackable, incoming pressure is active, and the ordinary selector would attack
a weaker rival, v22 preserves the weaker player as a second front. It retreats
an exposed front when possible; otherwise it uses a 10% neutral expansion.
Reliable defensive and collapse builds retain precedence.

The branch is bounded to the 22 observed hosted decisions where v21 attacked
Richard under incoming pressure while Claude named Auri. It does not change the
leader troop-ratio floor, attack scoring, build cadence, or unpressured play.
The first hosted diagnostic is pinned in
`experiments/gate-v22-asia-seat3.json`; v14 remains champion unless v22 clears
that diagnostic and the separate 20/20 regression gate.

The full local Asia run completed at turn 5,700 with a declared winner. All
224 decisions were accepted with zero holds, zero rejections, and zero parse
failures. Its replay SHA-256 is
`60a16b6bf7adf95c7025103651f136728552cc7ed73ee2bc09316aa9d6ccdb29`.
Local Bedrock planning was unavailable for 212 decisions, so this establishes
container, protocol, selector, and replay safety without claiming mechanism
reachability or competitive outcome.

The hosted diagnostic request
`xreq_450ab82b-0c1a-443e-85ab-19536b795501` completed all four episodes with
zero holds and zero rejected decisions. Auri v5 won 4/4; v22 won 0/4 and
finished with 33,720, 2,444, 37,435, and 2,196 tiles. Replay reconstruction
identified 14 buffer-preservation executions. Average final territory improved
from 1,234 in the v21 gate to 18,949, but Auri still averaged 217,032 tiles and
Richard survived only one episode versus two under v21. The buffer thesis is
rejected on both outcome and its intended second-front effect.

The same replays expose a stronger opening mechanism. Auri selected 128 hostile
attacks, 98 at 25%, and did not use 40% in the opening. v22 selected 28 attacks
at 40%; 27 occurred while its own troop reserve ratio was below 0.75. Its first
40% escalation began at turn 1,700, and Auri began attacking at turn 1,900 with
a 1.66 relative troop advantage. The next isolated candidate will preserve the
opening troop bank rather than alter target choice. Full evidence is archived
in `experiments/audit-v22-asia-seat3.json`.

## Asia seat-3 opening reserve candidate, 2026-07-12

v23 / `v1g-l0k` starts from exact v14 and changes only the opening commitment
schedule. Target continuity still opens at 10% and rises to 25%, but 40%
hostile attacks are unavailable during the first 20 active decisions. After
that window, v14's 40% finish rule is unchanged. Target scoring, attack floors,
build cadence, diplomacy, neutral growth, and all post-opening behavior remain
identical.

This isolates the earliest divergence from Auri v5. In every v22 Asia run, our
selector began 40% attacks on Richard at turn 1,700 and drove its troop reserve
ratio from 0.70 toward 0.43 before Auri's first attack. Auri used no opening 40%
attacks and began pressure at turn 1,900 with a 1.66 relative troop advantage.
The hosted diagnostic is pinned in `experiments/gate-v23-asia-seat3.json`; v14
remains champion unless v23 clears 4/4 plus the separate 20/20 regression gate.

The full local Asia run completed at turn 6,600 with 260 accepted decisions,
zero holds, zero rejections, and zero parse failures. Every seat exercised
hostile target continuity during active decisions 11-19, and no opening attack
exceeded 25%. Its verified replay SHA-256 is
`4ee98ba182a1bfa8c38ea1fa69e84d736932bd0c04f6ee1dcd2adb3d8869af94`.
Local Bedrock planning was unavailable for 248 decisions, so this proves the
deterministic commitment invariant and protocol safety, not competitive outcome.

The hosted request `xreq_2486d874-20a0-4f24-b7df-4a31b7bc6d06` completed four
episodes with zero holds and zero rejected decisions. v23 won one, Auri won two,
and James Boggs won one. v23 finished with 0, 2,491, 215,116, and 2,024 tiles.
The opening invariant held in every replay, but 1/4 fails promotion.

The reserve lock reduced Auri's first attack advantage from 1.66 under v22 to
1.31 in all four runs and changed Auri's first commitment from 25% to 10%.
That still exceeded Auri's observed 1.20 attack floor. The winning replay was
the only run where v23 mounted sustained leader pressure: 14 attacks on Auri,
while Auri attacked v23 only five times. The three losses selected 0, 0, and 2
attacks on Auri while receiving 13-14. v23 is rejected; the next candidate will
govern commitment from the live reserve ratio rather than elapsed decisions.
The complete evidence is in `experiments/audit-v23-asia-seat3.json`.

## Asia seat-3 live reserve candidate, 2026-07-12

v24 / `j4rn-l0k` starts from exact v14 and adds one feedback controller to
opening hostile commitment. During the first 20 active decisions, own troop
reserve below 0.75 restricts hostile attacks to 10%; reserve at or above 0.75
permits 25%. The candidate-action pool enforces the limit even when v14's
anti-repeat logic would otherwise force 40%. From decision 20 onward, exact v14
commitment and finish behavior resumes.

The mechanism targets the remaining v23 gap. A fixed 25% cap reduced Auri's
first advantage from 1.66 to 1.31 but allowed own reserve to fall from 0.76 to
0.59. The feedback floor should interrupt that decline and must put Auri below
its observed 1.20 attack threshold. The hosted diagnostic is pinned in
`experiments/gate-v24-asia-seat3.json`; v14 remains champion until 4/4 plus the
separate 20/20 regression gate.

The full local Asia run completed at turn 6,600 with 260 accepted decisions,
zero holds, zero rejections, and zero parse failures. All four seats exercised
both sides of the reserve controller and produced zero violations: sub-0.75
reserve attacks stayed at 10%, while recovered reserves permitted 25%. Its
verified replay SHA-256 is
`468c5efb5954245e777e87e21c9126617b999f63fd067998bd8d0e1d6abd8a48`.
Local Bedrock planning was unavailable for 248 decisions, so this proves the
feedback invariant and protocol safety without a competitive claim.

The hosted request `xreq_45044fe5-3f6d-46de-b470-8fb952176b5c` completed four
episodes with zero holds and zero rejected decisions. v24 won three and Auri
won one. v24 finished with 225,590, 222,499, 224,563, and 2,472 tiles. This is
the strongest isolated candidate gate so far, but 3/4 still fails promotion.

The opening feedback invariant held in all four and removed Auri's turn-1,900
attack. In the three wins Auri attacked v24 only 0-1 times while v24 attacked
Auri 27-32 times. The loss resumed v14's 40% commitments at turns 2,400 and
2,500, dropped reserve to 0.59, then gave Auri a 1.30 advantage at turn 3,200.
Auri attacked v24 20 times; v24 attacked Auri 10. v24 is rejected under the
hard gate. The next mechanism extends reserve feedback into midgame. Full
evidence is archived in `experiments/audit-v24-asia-seat3.json`.

## Asia seat-3 continuous reserve candidate, 2026-07-12

v25 / `j4rn-d0mr` starts from exact v14 and applies reserve feedback to every
hostile attack. Commitment is capped at 10% below 0.75 own reserve, at 25% from
0.75 through 0.89, and returns to exact v14 escalation at 0.90 or above. The
candidate-action pool enforces each band through anti-repeat. Target scoring,
attack eligibility, build cadence, diplomacy, neutral growth, and full-bank
finish pressure are unchanged.

This removes the exact v24 failure transition: 40% attacks at turns 2,400 and
2,500 immediately after the opening controller expired. The first gate remains
the pinned Asia seat-3 roster in `experiments/gate-v25-asia-seat3.json`; v14
remains champion unless v25 clears 4/4 and the separate 20/20 regression gate.

The full local Asia run completed at turn 6,800 with 268 accepted decisions,
zero holds, zero rejections, and zero parse failures. Across 97 hostile attacks,
all three reserve bands were exercised with zero commitment violations. Its
verified replay SHA-256 is
`687b008a6dd68bc62845cc648f86d19ad17e38ebd28fc3c312a375325fc47c5a`.
Local Bedrock planning was unavailable for 256 decisions, so this proves the
continuous reserve invariant and protocol safety without a competitive claim.

The pinned hosted gate completed 0/4. Auri won three episodes and James won
one; v25 averaged 2,166.5 final tiles and never produced a 40% hostile attack.
Across the four replays, v25 attacked Richard 52 times but Auri only nine times,
while Auri attacked v25 52 times. By comparison, the three v24 wins cleared
Richard with 40% attacks at turns 2,400 and 2,500, then attacked Auri 27-32
times. The continuous cap prevented that target finish, prolonged the weak
target lock, and surrendered the leader-pressure window. v25 is rejected and
exact v14 is restored. Full evidence is archived in
`experiments/audit-v25-asia-seat3.json`.

## Runaway-leader cadence candidate, 2026-07-12

v26 / `g4gnr4d-t4kt` starts from exact v14 and changes target arbitration rather
than commitment limits. When the current Claude plan names the top rival, that
rival leads by at least eight tile-share points, remains legally reachable, and
relative troop strength is at least 0.60, the selector inserts a 10% pressure
pulse after one recovery decision when v14 has no ordinarily eligible hostile
conversion. Vulnerable-target conversion, active finishes, and the existing
economy cadence retain precedence.

This isolates the repeated leader-pressure miss. In Round 226's two Pangaea
losses, Auri was legally attackable on 34 and 28 decisions but v14 selected one
attack in each. Claude named Auri on 12 and 24 of those opportunities. Across
the current 79-episode v14 sample, wins average 29.0 hostile attacks and losses
16.3. The candidate follows the already-available strategic signal without
reintroducing v25's all-game reserve cap.

The first hosted diagnostic is pinned to the weakest Asia diplomatic seat in
`experiments/gate-v26-asia-seat3.json`. v14 remains champion unless v26 clears
4/4 and a separate 20/20 map-seat regression gate.

The full local Asia run completed at turn 5,700 with 224 accepted decisions,
zero holds, and zero rejected decisions. Its verified replay SHA-256 is
`87d3d035ae29749256b018eea5eb6abb49bc416ac6cf492f1f4d91c7e9281a9a`.
Local Bedrock planning was unavailable on 212 decisions, so the pressure pulse
executed zero times. This proves the exact image, selector, protocol, and replay
path without making a competitive claim.

The pinned hosted gate completed 0/4; Auri won every episode. v26 finished with
0, 0, 2,293, and 2,491 tiles, including two eliminations. It attacked Auri four
times while Auri attacked it 67 times. The tagged mechanism executed four times
across two episodes, but anti-repeat raised the second pulse in each from 10% to
25% at only 0.63 relative strength. In the other two episodes, continued
eligible attacks on Richard prevented the fallback cadence from executing at
all. v26 is rejected and exact v14 is restored. Full evidence is archived in
`experiments/audit-v26-asia-seat3.json`.

## Frontier-kernel candidate, 2026-07-12

v27 / `s1gtyr-k3rn` changes architecture rather than another v14 threshold. It
derives from the canonical public Proxy War `0.1.5` game image and runs its
Commander-Executor `FrontierPolicyExecutor`, the same engine family used by
Keystone. The base image is pinned by digest in `Dockerfile.frontier`.

Only one documented off-by-default engine lever is enabled:
`PROXYWAR_TUNE_ECONOMY_BOOTSTRAP=1`. Before the first City and outside active
attack, it suppresses precautionary Defense Post spending and banks gold for a
City, then strongly prefers that City once offered. Binding commitment and
diplomacy directives, conversion-over-neutral enforcement, and the
behind-and-falling escape path retain their canonical defaults.

The first evidence gate is local same-engine comparison, not a hosted claim:
four Asia episodes with v27 fixed in the historically weak diplomatic slot
against three digest-identical Frontier executors with economy bootstrap off.
All seats use the mock Commander locally so only executor behavior differs. A
hosted Auri gate is allowed only if this arm beats the default executor from the
weak slot.

v27 won all four seeded candidate episodes from slot 2 at turn 6300 with
217,296 final tiles, zero fallbacks, and zero rejected decisions. Its first City
landed at turn 400 and its first Factory at turn 900. The same-seat all-default
counterfactual lost from slot 2 with 699 final tiles and three fallbacks; its
first City landed at turn 600, its first Factory at turn 1500, and the match did
not resolve until turn 14200. The mock planner converged on the same strategic
trace across the four candidate seeds, so this is a reproducible local mechanism
gate rather than four independent strategic trials. Evidence is archived in
`experiments/audit-v27-local-asia-seat2.json`; league promotion remains barred
until a hosted live-roster gate passes.

The hosted gate `xreq_0d877f8c-5b32-4d35-8d39-62b587812b9b` rejected v27. It
won 1/4 against James, Auri v5, and Richard, with final tiles of 2,320; 235,939;
31,468; and 44,426. The economy mechanism transferred: City landed at turn 400
in every replay and Factory at turn 900 or 1000. Execution integrity did not.
Transient alliance, break-alliance, target, and embargo selections repeatedly
expired before validation, causing 114 fallbacks and 111 holds. v28 therefore
changes request freshness only; behind-and-falling threshold tuning remains
deferred. Full evidence is archived in
`experiments/audit-v27-hosted-asia-seat2.json`.

v28 / `v4rdr-v4kt` kept v27's strategy and changed only request freshness. The
hosted request `xreq_215600f3-4d01-4b92-a74e-43eb679cc97e` reduced fallbacks from
114 to 25 and holds from 111 to 30, confirming that queued stale requests were a
real execution defect. It nevertheless went 0/4 with final tiles of 2,279;
8,726; 34,122; and 40,153. The repair stays in the candidate architecture, but
v28 is rejected as a policy. v29 applies the source-reviewed behind-and-falling
pair: rival dominance 1.3 instead of 1.5 and escape-bank cap one cycle instead
of two. Evidence is archived in `experiments/audit-v28-hosted-asia-seat2.json`.

v29 / `skuld-v4kn` went 0/4 in
`xreq_6b2f20e2-7709-4ae5-9ef3-ca4a96308136`, with final tiles of 43,716; 2,041;
37,021; and 22,619. Replay reconstruction confirmed the lower dominance band had
little reach: when it armed, Auri still held a sub-1.0 troop ratio against us, so
the strike credibility floor correctly blocked a forced feed. v29 is rejected.
The next arm follows the stronger reviewer finding: v30 temporarily vetoes a
one-shot social action when the same ID reappears in the next request, proving
the prior attempt failed under same-turn seat-order reservation.

v30 / `v4li-v3tr` exercised the veto in all four hosted episodes but went 0/4
in `xreq_eb65b6b1-2de1-4a66-b8e4-978c636edcca`. It marked 230 decisions, 211 of
which reranked to accepted non-hold actions, but broad recurring communication
IDs remained vetoed across long windows and 19 decisions still fell back. Final
tiles were 1,859; 23,211; 1,264; and 27,140. The mechanism was observable and
active but strategically negative. v30 is rejected and the Frontier branch is
closed until exact v14 completes a matched current-roster baseline. The revised
gate is documented in `experiments/PROTOCOL.md`.

## RCI matched champion baseline, 2026-07-12

Exact v14 returned to the current Asia seat-3 roster in
`xreq_f828169f-4885-48b9-9dcf-9287256ebb15`. Auri v5 won all four episodes;
v14 finished with 0, 2,175, 0, and 0 tiles. The wire stayed valid with zero
holds and zero rejected actions, but planner degradation produced 15 fallbacks.

The four openings were strategically identical. v14 escalated against Richard
to 40% at turn 1,700, reached only 0.48 troop reserve at turn 1,900, and let
Auri enter at a 1.66 relative troop advantage. v14 then attacked Auri zero
times while Auri attacked it 9-16 times per episode. This reproduces the
pre-v24 failure and restores the strongest prior arm to the evidence line: the
v24 live opening-reserve controller executed on 28 historical decisions,
removed Auri's turn-1,900 entry, and won 3/4 on the same roster. It remains a
diagnostic parent, not a promotion candidate. Full evidence is archived in
`experiments/audit-v14-current-asia-seat3.json`.

## Post-conversion bank-build candidate, 2026-07-12

v31 / `h3l-v4kt` names v24 as its exact parent. It retains the 28 observed
opening reserve interventions and changes one later arbitration. After the
first rival has been converted, if neutral expansion has stalled, reserve is
below 0.80, and the top rival leads by at least 12 tile-share points, a legal
economy build now precedes the first neutral boat. The replay marker is
`[h3l-v4kt:bank-build]`.

The arm is reachable in three v24 replays at turn 3,100. Each selected an 8%
neutral boat while City was legal, exposing 114,028-117,085 troops. The losing
episode and one winning episode had identical Odin actions through that turn
and near-identical state; Auri then chose Odin in the loss and James in the win.
This identifies opponent planner variance as the trigger and troop exposure as
the condition the child can change. It does not claim the counterfactual result.

The full local Asia run completed at turn 6,600 with 260 accepted decisions,
zero holds, zero rejections, and a verified replay SHA-256 of
`144cc548bda5fb642bf37e8fbade086efb7accdd37d8544a70f1cb58dcb359d5`.
Its strategic trace did not reach the bank-build condition, so local evidence
proves image and protocol safety only. Historical hosted reach, the preflight,
and the pinned gate are archived in `experiments/diagnosis-v31-asia-seat3.json`,
`experiments/preflight-v31.json`, and `experiments/gate-v31-asia-seat3.json`.

The hosted gate `xreq_9f0a8897-7380-4139-b50b-e9e9b6242588` rejected v31. It
won 1/4 with final tiles of 2,408; 2,462; 216,495; and 2,491. The inherited
opening reserve controller executed 28 times, but the new bank-build marker
executed zero times. Auri entered earlier than the historical reach window: its
first attacks arrived at turns 2,600-3,100 with 1.44-1.92 relative troop
strength. The branch was therefore too late to test its own counterfactual.

Four late holds also failed the integrity gate. The replay reasons show an
alliance or target ID disappearing before validation when only embargo-all,
delete-unit, and hold remained; the runtime substituted hold. v31 is rejected,
exact v14 source is restored, and the sole league membership stays on v14.
Full evidence is archived in `experiments/audit-v31-hosted-asia-seat3.json`.

RCI also killed the immediate follow-up before upload. A 25% efficient finish
would have covered Richard's full troop count in all four old v24 episodes and
preserved about 149,000 troops each time. In the four current v31 episodes, the
same turn left Richard at 4-8% land and only 1.62-3.19 times weaker; 25% covered
the target's troop count zero times. Because v31's own marker never fired, these
episodes are v24-equivalent behavior and bring the combined parent result to
4/8. The arm had stale reach and was not uploaded. Evidence is archived in
`experiments/no-go-v32-lean-finish.json`.

## Frontier parity-pressure candidate, 2026-07-12

The current v28 parent control completed on the exact Asia seat-3 roster in
`xreq_7ec6308b-cf9f-421b-95ab-bf711b619b40`. Auri v5 won all four episodes;
v28 finished with 2,041; 34,930; 3,783; and 4,600 tiles. The request had zero
rejected decisions but 45 holds and 43 planner-degraded decisions.

Three independent parent traces expose a current pressure window. Odin held at
least 20% land, Auri led by 8-22 points, own-to-Auri troop strength was at least
0.90, no incoming attack was active, and `attack:28k1hctz:10` was legal. v28
instead selected an alliance at turns 3,200 and 3,800 and a warship at turn
9,900. The recorded ratios were 0.97, 0.95, and 0.99. This is current hosted
reach, not an older favorable trace.

v32 / `hrafn-s4r` keeps v28's economy bootstrap and request coalescing, removes
the rejected v29/v30 arms, and changes one arbitration. A non-hostile choice is
replaced with a 10% strike on the non-allied land leader only inside that parity
window. Active incoming pressure, a troop ratio below 0.90, a gap above 0.22,
or a leader strike in the prior two decisions blocks the pulse. Existing
hostile attacks are never replaced. The replay marker is
`[hrafn-s4r:r1ft]`.

The commitment is grounded in the v24 comparison rather than invented from the
loss alone: each of its three same-roster wins opened Auri pressure with 10% at
0.91-0.93 relative troop strength. The comparison supports timing and size; it
does not prove the v32 counterfactual.

Canonical local self-play completed at turn 11,000 with 407 accepted decisions,
zero holds, zero rejections, and zero degraded decisions. The strategic trace
did not enter the registered window, so this proves runtime and replay safety
only. Replay SHA-256 is
`2f224fbd0a9c029ecbc871a8a0e64ba3b5763d229ca65e465e4bcf876d28c251`.
Evidence and the valid preflight live in
`experiments/diagnosis-v32-asia-seat3.json` and
`experiments/preflight-v32.json`.

The RCI validator now distinguishes a candidate that is ready for a hosted gate
from one eligible for promotion. Promotion remains false until structured
hosted `4/4` and separate `20/20` results both pass with zero holds and zero
rejections.

The hosted request `xreq_67cf6f10-9400-4e7e-ae1a-28c1fc81d280` moved the
matched result from v28's `0/4` to v32's `3/4`, with final tiles of 29,583;
219,622; 213,955; and 213,995. All 15 marked parity pulses executed as accepted
10% attacks on Auri. Planner-degraded decisions fell from 43 to 11 and no
decision was rejected.

The arm still fails both hard hosted criteria. Eight unknown social action IDs
became holds even though each current menu contained productive legal actions.
In the losing replay, four pulses held Auri at ratios from 1.00 to 1.20, but the
0.22 leader-gap ceiling stopped the mechanism after turn 4,200. Odin then chose
three neutral boats while still holding a 1.17-1.27 troop edge; Auri converted
the gap and won. v32 is rejected and v14 remains the sole league membership.
Full evidence is in `experiments/audit-v32-hosted-asia-seat3.json`.

## Current-menu wire salvage candidate, 2026-07-12

v33 / `g4lga-v4rd` names v32 as its exact parent and changes only invalid wire
choices. All eight v32 holds returned an action ID absent from the current legal
menu; every one still exposed productive attacks, retreats, boats, or builds.
Every legal v32 choice remains untouched.

The salvage order first keeps a productive legal batch alternative, then uses a
credible 10% leader attack, an active-pressure retreat, a boat retreat, a safe
economy build, or the smallest neutral expansion. One-shot social actions are
not fallback candidates. Hold remains possible only when the current menu has
no productive action. The marker is `[g4lga-v4rd:w1re]`.

The losing v32 trace proves tactical reach at turn 4,600. The unavailable Auri
alliance became HOLD while a 10% Auri attack was legal; snapshot troops were
1,934,623 vs 1,701,152, a 1.137 own-to-Auri ratio. v33 would select that attack.
This does not prove the win counterfactual.

Canonical local self-play completed at turn 11,000 with 407 accepted decisions,
zero holds, zero rejections, and zero degradation. No unknown action occurred,
so the local trace proves runtime safety only. Replay SHA-256 is
`4335ba620b766a678c3894638c0bcafa891289059549363b0548a0c3d7866b73`.
The diagnosis and preflight are archived in
`experiments/diagnosis-v33-asia-seat3.json` and
`experiments/preflight-v33.json`.

The hosted gate `xreq_2666b188-163f-470b-844b-c4a48bb46c8d` rejected v33. It
matched v32 at `3/4`, finishing with 218,588; 228,082; 218,310; and 27,546
tiles. The replay audit found eight holds, zero rejected decisions, seven
accepted parity pulses, and zero wire-salvage markers. The brain had already
normalized unavailable source actions to `hold` before the adapter ran, so the
new branch could not observe its registered condition.

The loss exposed a smaller tactical failure. Odin allied with Auri at turn
2,700, then left `break_alliance:28k1hctz` unused on 21 later decisions while
Auri's lead grew from 10 to 35 tile-share points. v33 is rejected, its dead
fallback ladder is removed, and any next arm is limited to severing an allied
leader inside the existing parity window. Full evidence is archived in
`experiments/audit-v33-hosted-asia-seat3.json`.

## Allied-leader sever candidate, 2026-07-12

v34 / `n1dh0ggr` names v33 as its exact parent and has one behavioral delta.
When the current tile leader is our ally inside the existing 0.08-0.22 parity
window, and our troop ratio remains at least 0.90 with no incoming attack, a
legal low-risk alliance break replaces a non-hostile order. Existing hostile
attacks and the v32 parity strike stay unchanged. The marker is
`[n1dh0ggr:s3vr]`.

The rule has four current parent decisions, all in v33's only loss and none in
its three wins. At turns 3,000, 3,100, 4,100, and 4,500, Auri led by 10-21
tile-share points, Odin held 0.976-1.066 of Auri's troops, and
`break_alliance:28k1hctz` was legal. The parent expanded or built instead. This
proves reach and isolation, not the win counterfactual.

The runtime was reduced before the trial. Two post-processors became one and
the dead 172-line wire-salvage ladder was deleted, cutting helper code from 281
to 145 lines. The full local four-container Asia run completed at turn 11,600
with all 431 decisions accepted globally. Odin's 108 decisions had zero
rejections and zero fallbacks, but Auri won, Odin selected three intentional
holds, and neither registered clamp branch fired. Local evidence therefore
proves transport safety only. Replay SHA-256 is
`c24de5eacf937e314cc31211b5b35f8c6247b8009a8f6cb97ebeb20d9dc3fd03`.
Current reach and the local record are archived in
`experiments/diagnosis-v34-asia-seat3.json`.

The hosted gate `xreq_b8157cd6-8daa-4b9d-a4ce-10b5e7104f80` rejected v34 with
an Auri sweep. Odin finished with 28,543; 31,434; 20,739; and 32,388 tiles.
The audit found 25 holds, 29 degraded decisions, eight accepted parity strikes,
and zero leader-sever marks.

The zero reach has a direct source cause. `LegalActionBuilder` assigns every
`break_alliance` action `risk.level = high`, while v34 accepted only a low-risk
break. Removing that filter exposes 16 exact parent decisions across three
independent traces; every one names the allied tile leader and preserves the
same share, troop-ratio, incoming-pressure, and non-hostile-parent gates. v34
is rejected. The next arm removes only that impossible filter.

## Authoritative leader-sever candidate, 2026-07-12

v35 / `f3nr1r` names v34 as its exact parent and removes only the risk-level
exclusion from the leader's legal `break_alliance` lookup. It adds no helper,
fallback, or tunable. All share, gap, troop-ratio, incoming-pressure, and
existing-hostile-action gates remain unchanged. The marker is
`[f3nr1r:s3vr]`.

The parent supplies 16 reachable decisions across three hosted traces, with
leader gaps of 0.09-0.21 and own-to-Auri troop ratios of 0.945-1.289. The
`break_alliance` ID is present in the current menu on every one. Unit and audit
fixtures pass `65/65`, including the server-classified high-risk break. The
full local episode was stopped and skipped on Oli's instruction; no local
strategic claim is made. Evidence is archived in
`experiments/diagnosis-v35-asia-seat3.json`.

The hosted gate `xreq_3ef632d2-7454-48a6-b272-5f5cb8e0d00e` finished `1/4`,
with 221,857; 37,946; 5,942; and 14,776 tiles. It recorded 25 holds, 28
degraded decisions, ten accepted parity strikes, and zero sever marks. The last
episode went to Auri, triggering Oli's explicit retirement rule for this lane.

The eight latest v33-v35 replays leave one durable opponent finding. Auri begins
direct pressure on Odin at roughly 1.31-1.34 relative home-troop strength.
Odin's wins held Auri to zero or one direct attack and produced 31-38 hostile
attacks of their own; losses absorbed 6-11 Auri attacks while Odin produced only
9-20 hostile attacks and spent more turns on alliances, boats, and holds. The
Frontier counter lane is closed. Its runtime patch, Dockerfile, and dedicated
tests are removed; at that checkpoint v14 remained the sole league version.

## Qd1n reciprocal-targeting RCI, 2026-07-15

Rounds 366 and 367 supplied eight current-version replays. Across them qd1n
attacked katanasan 46 times while katanasan attacked qd1n zero times. The
clearest Pangaea loss sharpened the error: Auri attacked qd1n 21 times and won,
while qd1n attacked Auri zero times and katanasan 16 times.

Rci-2 adds conditional reciprocal restraint for katanasan, immediate revocation
after any incoming attack, a 35% finishing release, peaceful-partner preference
when an alliance is already the survival action, and bounded retaliation weight
for land and naval targets. It changes no public game text and makes no blind
donation.

The focused strategy suite passed `47/47`; the full suite passed `81/81`; the
container build and module smoke passed. Two mirrored current `0.1.8`
eight-player Pangaea runs both ended at turn 10,800 with seat three winning.
The parent won the first and the candidate won the inverted roster. All 1,442
decisions were accepted with zero rejections; each image recorded one hold
across the pair. The official local roster uses generic names, so the named
reciprocal branch could not fire. This is regression evidence, not promotion
evidence. The machine-readable record is
`experiments/diagnosis-qd1n-reciprocal-rci-20260715.json`.

## Qd1n no-feed RCI and live v76 submission, 2026-07-15

Round 373's second Pangaea episode isolated a terminal naval loop. Qd1n stopped
at 135,564 tiles while Richard Higgins reached 284,542. Qd1n launched 107 boats
at Richard with an average relative troop ratio of 0.376 and a range of
0.27-0.46. After turn 28,900, qd1n made 115 more decisions: 88 boats, 17 warship
moves, seven warship builds, and three retreats, with no territory conversion.
Historical telemetry sharpened the cutoff: 464 naval invasions appeared in
qd1n's winning episodes from rounds 348-367, and none were below 0.50. Losing
episodes contained 168 below 0.50.

Rci-3 rejects a desperate rival invasion below 0.50, orders utility actions
before desperation, and suppresses a rival after six boats in the last ten
decisions fail to add more than 0.2 percentage points of territory. It preserves
the 1.15 favorable invasion path, the 1.00 forced-conversion path, productive
same-target pressure, and the emergency land fallback. Four new strategy cases
cover the floor, ordering, cooldown, and productive release; the full suite
passed `85/85`.

The current `0.1.8` Pangaea mirror reached the mechanism in both seat
assignments. Seat three won each replay, producing a `1-1` image split. Across
the pair, the candidate recorded zero sub-0.50 rival boats against five for the
parent, 62 rival boats against 78, and 46 utility actions against 25. All
`1,371/1,371` decisions were accepted; candidate and parent holds were two and
one. This is direct mechanism evidence with no seat-independent win advantage.

The first upload attempt exposed an arm64 packaging error and changed no remote
state. The identical source at commit `f9d50fe` was rebuilt as linux/amd64,
passed module smoke, and matched the worktree hashes for all four runtime files.
It uploaded as `qd1n:v76`, submission
`sub_bbface4c-2afc-4170-b3af-0f7540bbf563`, with automatic champion promotion.
Qualification passed and membership `lpm_807274c0-0f71-4c13-8990-3dc932a9f7e5`
became champion; `qd1n:v2` became benched. This was an explicit operator override
of the usual hosted `4/4` plus regression `20/20` gate after the operator required
an actual public update. Goal credit remains closed at `0/1000` until official
first-place finishes begin. Full evidence is in
`experiments/diagnosis-qd1n-nofeed-rci-20260715.json`.

## Qd1n sub-two-percent World breakout RCI, 2026-07-16

World seat four went `0/6` through round 407 while choosing 1,219 neutral boats
and zero naval invasions. In the latest loss, qd1n held 0.646 percent of the map
and closed with twelve straight neutral boats despite legal attacks, upgrades,
retreats, warships, and warship movement. The existing stalled-boat conversion
interrupt was disabled below two percent territory.

Rci-4 lowers only that floor to 0.2 percent. It preserves the final neutral
escape route below the new boundary, and adds no selector or public game text.
The red regression failed before the source edit; the full suite passes `87/87`
after it. The linux/arm64 local image built and passed module smoke.

One current `0.1.8` eight-player World mirror finished at turn 14,900 with all
`1,040/1,040` decisions accepted. The candidate won slot four, and recorded one
hold against two for the parent. A non-winning candidate seat reached the
low-share condition and chose several alternatives to stalled neutral boats.
Because the winning seat never reached the new branch and local Bedrock was
unavailable, this is runtime and directional evidence rather than causal proof.
The verified replay hash is
`abc0a9c170e091911e685f71f601e2d2ead9519cff9499fca5930257d51d57cb`.
Machine-readable evidence is in
`experiments/diagnosis-qd1n-world-breakout-rci-20260716.json`.

The exact committed source was rebuilt for linux/amd64 and uploaded as
`qd1n:v77` (`c0213724-8fb6-40d3-97da-fd1b080971f7`). Submission
`sub_e94102ad-0853-4166-bfe8-7519403ec569` passed qualification and promoted
membership `lpm_6eb28046-ebef-4127-a5b6-7653a72ce73b` to Competition. V77 is
the sole qd1n champion and v76 is benched. The operator explicitly ordered this
relaunch before the standard hosted `4/4` and `20/20` strategic gates were
complete.

## Qd1n early-conversion RCI rejection, 2026-07-16

Rounds 411-418 gave qd1n `5/24` wins (`20.8%`) while daveey recorded `11/31`
(`35.5%`). Replay telemetry exposed 100 points in eleven losing episodes where
qd1n selected neutral land even though the official conversion affordance
recommended a rival, exposed an executor-ready action at at least `1.30x`
troops, and qd1n held 5-15 percent of the map. Winning episodes contained only
three such points.

Rci-7 tested the narrow causal claim. Between five and twelve percent land, it
placed a ten-percent rival probe ahead of neutral land at `1.30x` or better and
tagged the order `cv2`. The candidate passed `83/83` tests and a current-package
qualifier with `34/34` accepted orders.

The alternating-seat eight-player Pangaea gate reached `cv2` twelve times and
accepted all `660/660` orders, so reach and execution were not ambiguous. The
candidate won no seat. Parent slot eight won at turn 12,400 with 377,432 tiles;
the best surviving candidate held 42,903. RCI therefore rejected the causal
claim: ratio alone is not enough to choose the conversion target. The selector
and its test were removed, v77 was restored, and no image was uploaded or
submitted. The full record is
`experiments/diagnosis-qd1n-early-conversion-rci-20260716.json`.

## Qd1n attacker-attribution RCI, 2026-07-16

Round 420 placed qd1n third on Asia with one win in four episodes. In the
current eight-round field, qd1n won `5/26` appearances (`19.23%`), while daveey
and Auri each won `9/31` (`29.03%`). A bounded audit of the four round-420
replays led to the current ProxyWar `0.1.8` protocol contract. It exposes the
incoming-attack count at `ownState.incomingAttacks`, but sends the attacker IDs
through `combat.incomingAttackPlayerIDs` and `visiblePlayers[].incomingAttack`.
Qd1n tried to derive identities from the numeric count, leaving its existing
retaliation, betrayal, and survival-history controls without named attackers.

Rci-8 merges the current-protocol IDs and visible-player fallback into the
existing history model. It adds no new broad selector. The `ia1` marker records
only a selected rival attack against a currently attributed attacker. The red
regression selected the softer bystander before the repair and the aggressor
after it; the complete suite passed `84/84`. The current-package qualifier
accepted `34/34` decisions with zero holds and zero rejections.

Two local `tournament-8p-asia` mirrors swapped candidate and parent seats. The
candidate won both orientations, at slots six and seven, with 865,104 and
884,820 tiles. The parent won neither. `ia1` executed fourteen times across
five candidate seats; all `1,082/1,082` decisions were accepted with zero holds
and zero rejections. The generated payoff matrix records two candidate pair
advantages and zero parent advantages.

This is a direct mechanism and matched local advantage, but it is not promotion
eligible. Local Bedrock was unavailable for both arms, the comparison parent is
the current workshop baseline rather than the exact live-v77 image, and the
hosted `4/4` plus `20/20` map-and-seat gates remain open. No image was uploaded,
no policy was submitted, and qd1n:v77 remains the sole live champion. Evidence:
`experiments/diagnosis-qd1n-attacker-attribution-rci-20260716.json`,
`experiments/ledger-qd1n-attacker-attribution-rci-20260716.ndjson`, and
`experiments/payoff-qd1n-attacker-attribution-rci-20260716.json`.

An exact-parent follow-up rebuilt only the attacker-attribution diff on deployed
v77 commit `b0c205c`. The isolated candidate passed `89/89` tests and a `34/34`
qualifier, then defeated the exact local v77 image in both seat-swapped Asia
orientations. It won slots six and seven with 873,409 and 909,275 tiles.
`ia1` executed ten times across five candidate seats; all `905/905` decisions
were accepted with zero holds and zero rejections. Candidate mean final
territory was 240,029 versus 2,379.75 for v77. This closes the exact-parent
Asia gate only. World/Pangaea and the full `4/4` plus `20/20` gates remain open,
so no image was uploaded or submitted. Exact evidence is in
`experiments/exact-live-qd1n-attacker-attribution-rci-20260716.json`.

The architecture-matched World gate rejected the universal successor. Both
arms ran as linux/amd64. The board reached turn 40,400 without an 80-percent
winner; exact v77 led at score `0.3655` and 238,147 tiles, while the best
candidate seat reached `0.2132` and 138,931. Candidate mean score was `0.0875`
against `0.1625`, and mean final territory was 57,034.5 against 105,867.75.
`ia1` reached five times across two candidate seats, all `2,294/2,294` orders
were accepted, and neither arm held or rejected an order. Three attributed
responses attacked at only `0.91x`, `1.03x`, and `1.05x` relative troops. The
skill rejected `ia1` as a universal v78 successor, restored executable main to
exact v77, and retained the candidate only as an Asia population arm. The next
bounded hypothesis requires at least `1.10x` before attribution can influence
attack selection. World evidence is in
`experiments/ledger-qd1n-attacker-attribution-exact-v77-world-20260717.ndjson`
and `experiments/payoff-qd1n-attacker-attribution-exact-v77-world-20260717.json`.

The `sr1` follow-up gated attribution weight and its marker below `1.10x`.
Its red regression proved a real unit boundary, and the isolated suite passed
`90/90`; the amd64 qualifier accepted `34/34` decisions. In the identical
World field, `sr1` reached twice at `1.44x` and `1.12x`, but all 2,294 selected
action IDs and the complete final score vector were identical to the rejected
`ia1` run. The base attack selector still chose the sub-1.10 targets after the
attribution bonus disappeared. RCI retired `sr1` as a dead layer without a
reverse orientation. The next arm must block the near-parity rival action
itself and mark the replacement action. Evidence is in
`experiments/ledger-qd1n-safe-retaliation-exact-v77-world-20260717.ndjson` and
`experiments/payoff-qd1n-safe-retaliation-exact-v77-world-20260717.json`.

The selector-level `rf1` follow-up then blocked ordinary rival attacks below
`1.10x` and marked the replacement expansion or economy action. Its red
regression displaced a real `0.92x` leader attack, the isolated suite passed
`87/87`, and the amd64 qualifier accepted `34/34` decisions. In the controlled
World field, `rf1` reached thirteen times across three candidate seats; all
`1,054/1,054` decisions were accepted with zero holds and zero rejections.
Exact v77 nevertheless won outright at turn 15,500 with 522,343 tiles. The
candidate averaged score `0` and 12,591.25 tiles versus the parent's `0.25` and
150,311. Direct reach plus a decisive matched regression rejects the universal
reserve floor without a reverse orientation. Main and the live champion remain
exact v77; no upload, submission, membership, or relaunch changed. Evidence is
in `experiments/diagnosis-qd1n-reserve-floor-rci-20260717.json`,
`experiments/ledger-qd1n-reserve-floor-exact-v77-world-20260717.ndjson`, and
`experiments/payoff-qd1n-reserve-floor-exact-v77-world-20260717.json`.

## Qd1n decisive pressure-counter RCI, 2026-07-17

The refreshed rounds 421-428 contained six near-parity 10-percent attacks
against a current attacker while incoming pressure was active. Five of six
lost territory by the next decision, averaging -5,172 tiles. The sole observed
40-percent counter in the same bounded state gained 8,249 tiles and won. The
`pc1` arm therefore changes only the commitment level when exact v77 already
selects a current attacker at `1.00-1.09x` while incoming pressure exists.

The red regression moved that decision from 10 to 40 percent and marked it
`pc1`; calm attacks and bystander targets remained 10-percent probes. The full
suite passed `90/90`, and the amd64 qualifier accepted `34/34` decisions. In
two seat-swapped World mirrors, the candidate won both directions with 632,072
and 532,198 tiles. The first orientation had no branch reach and was not treated
as causal proof. The reverse reached `pc1` twice, including once in the winning
seat; both orders were server-accepted. Across World, candidate mean score was
`0.25` versus `0`, mean territory was 159,560.6 versus 3,341.6, and candidate
seats had zero holds or rejections.

Pangaea rejected universal promotion. `pc1` reached once and was confirmed,
but that candidate seat was eliminated; exact v77 won with 355,670 tiles.
Candidate mean territory was 15,542 versus 89,541.75. Direct reach without
matched improvement triggered the stop rule, so no reverse Pangaea orientation
or broader promotion gate ran. The World arm remains reproducible locally;
main and the live champion remain exact v77. No image was uploaded, no policy
was submitted, and no membership or relaunch changed. Evidence is in
`experiments/diagnosis-qd1n-pressure-counter-rci-20260717.json`,
`experiments/ledger-qd1n-pressure-counter-exact-v77-20260717.ndjson`, and
`experiments/payoff-qd1n-pressure-counter-exact-v77-20260717.json`.

## Qd1n map-composition RCI, 2026-07-17

The two replay-proven counter arms only fired on their own maps, so rci-11
composed them behind a map fingerprint derived from the policy-visible
`ownState.spawnTile`: current-protocol attacker attribution (`ia1`) only on
Asia, the active near-parity 40-percent pressure counter (`pc1`) only on
World, and byte-exact v77 on Pangaea and unknown maps. The Normal-map spawn
sets were validated against 717 cached official replays with zero cross-map
overlap; Compact maps expose no validated spawn set and fail closed to exact
v77.

Mx1 was rejected because spawn legal-action sentinel IDs are resolved inside
the game layer and never reached the policy. Mx2 passed every local gate but
its source-isolation review narrowed string-form attacker parsing to Asia
only, producing the mx3 source and image
(`proxywar-agent-llm:qd1n-v77-mx3-amd64`,
`sha256:e97d89814b18771357b90ba5daedf50796a11568d0dd966f6978535d35cea472`)
plus a Pangaea regression test. The isolated suite passed `95/95`, and the
amd64 qualifier accepted `34/34` decisions with zero holds and zero
rejections.

Six exact-image matched trials ran the mx3 image against the exact v77 image
in alternating even/odd seats. The candidate won both Asia orientations
(slots 6 and 7) and both World orientations (slots 4 and 3). Pangaea
reproduced the same physical winner and trace after labels swapped, including
the same two slot-5 holds under each label; those holds reproduce under the
exact parent at the same seat and trace and are therefore explained. Across
48 seats the candidate won 5 matches against the parent's 1, with `ia1`
reaching ten times (five audit-confirmed), `pc1` twice, `2,278/2,278`
candidate decisions accepted, and zero rejections. Mean final territory was
240,029 versus 2,379.75 on Asia and 159,560.6 versus 3,341.6 on World.

The exact amd64 image was uploaded as `qd1n:v78`
(`348cab68-a00d-483d-ba94-67c8e00d469e`) for hosted testing while v77 stayed
live. The matched parent baseline
`xreq_8cced59b-77f1-4887-86da-f5e0b27fb8c6` finished `0/4` on
tournament-8p-asia (proxywar `0.1.9`) against the current Competition field.
The candidate diagnostic `xreq_53a20fc0-3334-4495-9bfe-a03b454b3c17` finished
`1/4`: it won its first episode with 1,015,250 tiles and four `ia1`
executions, then lost to `proxywar-keystone:v42`,
`co-gas-proxywar-richard:v6`, and `tsukuyomi-no-kage:v34`. All `682`
candidate decisions were accepted with zero holds and zero rejections, and
`ia1` executed six times with three audit confirmations, while the parent
emitted no markers from the same seat. The hosted `4/4` gate failed, so the
verdict is NO SUBMIT: the `20/20` regression was not run, no submission was
made, no membership changed, and qd1n:v77 remains the sole live champion.
The mx3 source stays committed as a local population arm only. Evidence:
`experiments/diagnosis-qd1n-map-composition-rci-20260717.json`,
`experiments/ledger-qd1n-map-composition-exact-v77-20260717.ndjson`,
`experiments/payoff-qd1n-map-composition-exact-v77-20260717.json`, and
`experiments/preflight-qd1n-map-composition-mx3.json`.

## Qd1n pile-on discipline RCI, 2026-07-17

The three hosted mx3 losses shared one mechanic. Under multi-attacker
pile-ons, qd1n kept spending 25-40 percent counters at 1.01-1.21 ratios: in
episode two it lost 94,000 tiles in seven hundred turns while Auri, daveey,
and Sefirot attacked together; in episode three Richard Higgins landed ten
unanswered attacks while qd1n built and countered Auri. The winning episode
ran the opposite shape: one attacker at a time and counters at 1.3-6x. The
`pd1` guard therefore fires only on Asia and only when two distinct attackers
are attributed in the current observation or the last twelve decisions; if
the best rival ratio is below 1.3, the rival attack is suppressed and the
replacement action is marked `pd1`. Strong-ratio counters, the ia1/pc1
routes, and every non-Asia behavior are untouched.

The first, current-only attribution variant (mx4) never fired: all six
matched runs reproduced the mx3 traces decision-for-decision with zero `pd1`
reach, so it was superseded before upload. The windowed mx5 passed `101/101`
tests and a `34/34` amd64 qualifier with zero holds and zero rejections, then
won both Asia mirrors at 884,022 tiles (slot six) and 874,107 tiles (slot
seven) with `pd1` executing fourteen times across three candidate seats.
`ia1` executed five times and `pc1` twice, preserving the mx3 arms. World and
Pangaea trials ran the mx4 image whose decision streams are byte-identical to
mx3; mx5 changes only an Asia-gated condition, so that evidence carries over.
Across the 48 evaluated seats the candidate won five matches against the
parent's one, with `2,310/2,310` decisions accepted, zero rejections, and two
Pangaea slot-5 holds that reproduce under the exact parent at the same seat
and trace (explained). Candidate mean final territory was 149,941.1 versus
26,967.3 for the parent.

The exact amd64 image is
`proxywar-agent-llm:qd1n-v77-mx5-amd64`
(`sha256:f4546d41b3496a37010051e335952b1c815de0588ab28e452a45ce25119a9fc5`),
built from commit `a92890d3ad452b284d6c80ddcba3bc05c879278a`. No image was
uploaded or submitted; qd1n:v77 remains the sole live champion. The next gate
is a hosted diagnostic against the same Competition roster and variant as
`xreq_8cced59b-77f1-4887-86da-f5e0b27fb8c6`, whose v77 `0/4` baseline is the
matched control. Evidence:
`experiments/diagnosis-qd1n-pile-on-discipline-rci-20260717.json`,
`experiments/ledger-qd1n-pile-on-discipline-exact-v77-20260717.ndjson`,
`experiments/payoff-qd1n-pile-on-discipline-exact-v77-20260717.json`, and
`experiments/preflight-qd1n-pile-on-discipline-mx5.json`.

The exact amd64 image was uploaded as `qd1n:v79`
(`34345f8f-12dc-46b5-a6c8-f33ad9461519`) for hosted testing while v77 stayed
live. The diagnostic `xreq_4660c5cb-c0ab-46ad-97d6-6db432d88cad` ran the same
roster, variant, seat, and episode count as the mx3 diagnostic, reusing the
v77 `0/4` baseline `xreq_8cced59b-77f1-4887-86da-f5e0b27fb8c6` as the matched
control. The candidate finished `1/4`: it won at 865,675 tiles with two `pd1`
executions, then lost to `co-gas-proxywar-richard:v6` twice and
`tsukuyomi-no-kage:v34` once. `pd1` executed eleven times and `ia1` seven,
with three audit confirmations; all `406` candidate decisions were accepted
with zero holds and zero rejections. Nine of the eleven `pd1` stands came in
the katanasan loss, where the seat was already doomed by an early snowball —
direct reach without outcome improvement over the mx3 `1/4`. The population
stop rule therefore rejects the arm: no `20/20` regression was run, no
submission was made, no membership changed, and qd1n:v77 remains the sole
live champion. The falsified hypothesis is preserved in the ledger; the
remaining hosted failure class is the early snowball, not the pile-on bleed.

## Qd1n opening-economy RCI, 2026-07-17

Reading the twelve hosted episodes from the mx3 and pd1 diagnostics by
winner, the opening profile is mechanical. Every Auri, Richard Higgins, and
katanasan win spent its first thirty decisions on 22-25 neutral attacks, all
at 35 percent, with zero to three rival probes, reaching 174,594-265,674
tiles by turn 3000. Qd1n mixed 10/20/35 percent neutral attacks with nine to
eleven rival probes and reached 72,308-106,196. No opening probe in any
episode produced a kill, and each probe reset the 10/10/20/35 neutral
cadence.

The `ef1` arm suppressed the opening probes on Asia while tile share stayed
below 0.12 with no active threat, preserving retaliation against current
attackers. It passed `101/101` tests, a `34/34` qualifier, and won both Asia
mirrors at 889,486 and 934,015 tiles with 76 `ef1` executions. Hosted as
`qd1n:v80` (`4e2b3d0d-db42-4807-b52f-d31580438a2a`), the diagnostic
`xreq_7eb566ff-04d0-4ebb-9c15-765bde6781ca` finished `0/4`: the probes were
removed exactly as designed, but opening territory fell to 54,032-63,869
tiles because the suppressed probes had been profitable pokes, and five
unexplained holds appeared beside them. Direct reach with a worse outcome
than the mx3 `1/4`; the arm is rejected and reverted.

The `ef2` arm then forced the remaining difference, a flat 35 percent neutral
grind with no cadence warm-up and no avoid-set fallback. It passed `101/101`
tests and a `34/34` qualifier, won asia-b at 895,806 tiles, but flipped
asia-a to the exact parent at 902,769 with every candidate seat starved
between 281 and 6,879 tiles. A split mirror with starved candidate seats is
a regression, so the arm was rejected before any upload and reverted.

Four deterministic guards have now failed against the current Competition
field: the map composition (hosted `1/4`), pile-on discipline (hosted `1/4`),
probe suppression (hosted `0/4`), and the opening grind (lost local mirror).
Executable source is restored to exact mx3 behavior, no submission was made,
and qd1n:v77 remains the sole live champion. Evidence:
`experiments/diagnosis-qd1n-economy-first-rci-20260717.json`,
`experiments/ledger-qd1n-economy-first-exact-v77-20260717.ndjson`,
`experiments/payoff-qd1n-economy-first-exact-v77-20260717.json`,
`experiments/preflight-qd1n-economy-first-mx6.json`,
`experiments/diagnosis-qd1n-opening-grind-rci-20260717.json`,
`experiments/ledger-qd1n-opening-grind-exact-v77-20260717.ndjson`, and
`experiments/payoff-qd1n-opening-grind-exact-v77-20260717.json`.

## Qd1n planner-doctrine RCI, 2026-07-17

The guard campaign left one untested lever: the Bedrock planner that steers
hosted target selection. The `sp1` arm rewrote three STRATEGY sentences to
the hosted winner profile — strongest-commitment Terra Nullius opening with
no rival attacks before 12 percent land unless attacked first, rivals only at
relativeTroopRatio 1.3 or better, 35 percent neutral commitment, and no
second front under attack. The selector stayed byte-identical to mx3, proven
by both Asia mirrors reproducing the mx3 decision streams exactly, with the
candidate winning both and zero holds or rejections across a `34/34`
qualifier and 453 matched decisions.

Uploaded as `qd1n:v81` (`3f7d3e16-0c3f-4e2a-89ac-409909aea573`), the
diagnostic `xreq_4f9ab61a-83d7-4234-bcef-493b4f0d74f0` finished `0/4`
against the standard roster. The decisive measurement was not the loss but
the shape of it: Bedrock was throttled in 224 of 390 candidate decisions
(57 percent), so the doctrine barely played, and the deterministic fallback
kept the cadence-mixed opening and the surviving Sefirot probes. The arm is
inconclusive on doctrine terms and failed on outcome terms. All `390`
decisions were accepted with zero rejections and three unexplained holds.

This closes the bounded-arm campaign. Five consecutive gates — map
composition `1/4`, pile-on discipline `1/4`, probe suppression `0/4`, opening
grind lost locally, planner doctrine `0/4` — each fired as designed and none
moved the hosted score, while the v77 baseline is `0/4` on the same roster.
Incremental variants of this policy do not currently clear this field. No
submission was made, no membership changed, and qd1n:v77 remains the sole
live champion. Evidence:
`experiments/diagnosis-qd1n-planner-doctrine-rci-20260717.json`,
`experiments/ledger-qd1n-planner-doctrine-exact-v77-20260717.ndjson`, and
`experiments/preflight-qd1n-planner-doctrine-sp1.json`.

## Winner decision-logic comparison, 2026-07-17

Following the closed bounded-arm campaign, the sixteen hosted episodes were
re-read by winner. The three dominant policies share one chassis: a flat 35
percent neutral grind through the opening (198-266k tiles by turn 3000),
rival attacks only at 25-40 percent commitment afterward, active alliance
play, and almost no mid-game boats. Qd1n inverts all four: a 10-percent
probe ladder, cadence resets, 346 mid-game boats, and 7 alliance requests
against the field's 16-46. The bounded arms failed because each changed one
rule while the edge lives in the sequence. The recommendation is a fresh
minimal deterministic policy (qd2n) implementing the chassis, gated through
the same pipeline. Full analysis and counted evidence:
`experiments/winner-decision-logic-20260717.md`.

## Qd2n winner-chassis evaluation and decisive A/B, 2026-07-18

The chassis rewrite built qd2n as a fresh minimal deterministic policy:
flat 35 percent opening grind above a 100k troop floor, retaliation-first
contact at 25 percent minimum, sticky target finishing, capped boats, and
probe-before-hold. Two iterations each finished 2/6 in the mirrored gates
with Asia and Pangaea split by dominant seats and World lost 0/4; candidate
holds fell from 51 (ch1) to 14 (ch2). The mirrors reject the chassis; it was
never uploaded. A final decisive A/B then extended the standard-roster
diagnostics to twelve episodes per arm: v77 finished 0/12 and mx3 (v78)
1/12. That edge is noise at this sample, the hosted 4/4 gate stays unmet,
and no ship case exists. qd1n:v77 remains the sole live champion. Evidence:
`experiments/diagnosis-qd2n-winner-chassis-20260718.json` and the
`decisive_ab` block in
`experiments/diagnosis-qd1n-map-composition-rci-20260717.json`.

The ship question was then tested against the actual league field (the round
471/472 roster including `co-gas-proxywar-relhalpha:v1`, `Eva-00:v23`,
`jamesboggs-warlord:v1`, and the current `daveey-proxywar:v22` and
`co-gas-proxywar-richard:v7`): eight episodes per arm finished v77 `0/8` and
mx3 `0/8`, with `richard:v7` taking nine of sixteen. There is no ship case in
either arena. qd1n:v77 remains the sole live champion; the champion's losses
are structural against the three climbing opponents, who are also iterating
faster.

The architecture project's hybrid (ch2 chassis on Asia/Pangaea, mx3 route on
World) finished 4/6 with every trace byte-identical to its donor code: World
went 2-0 for the candidate, but Asia split 1-1, which fails the
mirrored-advantage gate — and mx3's 5/6 with both Asia mirrors dominates the
hybrid outright. The project stops by its own pre-registered rule: the mx3
composition remains the best measured policy, and mx3 has no ship case over
v77 on either hosted roster. qd1n:v77 remains the sole live champion.
Evidence: `experiments/diagnosis-qd2n-winner-chassis-20260718.json` and
`experiments/qd2n-architecture-blueprint-20260718.md`.

## Qd1n kingmaker contract, 2026-07-18

The operator declared katanasan a 100% supporter and kingmaker. Three
deterministic, LLM-proof rules now carry the contract. `kp1` protects
katanasan unconditionally with no tile-share cutoff (the old restraint let
qd1n first-strike him at 0.35+, which happened in three recorded wins) and
breaks only if he attacks first. `kp2` selects any legal alliance_request
targeting him immediately — a reverse request accepts his pending offer —
and retries on a six-decision cooldown until the observation confirms
`isAllied`, then stops. `nk1` builds one missile silo after the economy
trio and fires Atom Bombs only at unprotected, SAM-free, worthwhile
targets, never at him. Break, reject, embargo, target, and boat channels
are excluded by construction; matching uses normalized name plus player ID.

The evidence: `122/122` unit tests including the spec's four proof cases;
`34/34` qualifier with zero holds and zero rejections; both Asia mirrors
won (asia-a byte-identical to the mx3 run, asia-b at 908,254); the hosted
diagnostic `xreq_6fe7820d-7776-4580-9a3b-b6df6ec248e3` with
`tsukuyomi-no-kage:v34` in the roster recorded **zero harmful actions
against katanasan in all four episodes** (and none from him); and a local
smoke game against a katanasan-named seat sent fourteen kp2 requests with
zero holds and zero harmful actions. The diagnostic finished `0/4` on
wins, so the standing promotion gates remain unmet. Uploaded as `qd1n:v83`
(`09fce37f-6f9b-4163-a411-d0e0ecc679de`, codename k1zuna) as the
handshake artifact; qd1n:v77 remains the sole live champion. Evidence:
`experiments/diagnosis-qd1n-kingmaker-rci-20260718.json` and
`experiments/preflight-qd1n-kingmaker-km1.json`.

## Qd1n k1zuna promotion, 2026-07-18

By explicit operator directive, `qd1n:v83` was promoted to live champion:
submission `sub_f25b48b7-1100-4055-805d-7ab9319321b5` placed with
qualification passed, and membership `lpm_5c3f41eb-7a50-4342-a136-172466376eb9`
is the sole active champion with `qd1n:v77` benched. This is an
operator-directed relaunch like the v76 and v77 promotions before it: the
standard hosted `4/4` and `20/20` strategic gates were not completed, and
that is recorded. The kingmaker contract (kp1 peace, kp2 alliance
acceptance with cooldown, nk1 proper nukes) now plays every official round.
The first completed round with v83 in the roster will be recorded here as
the deployment confirmation.

## K1zuna debut, round 493 (2026-07-18)

Round 493 gave odin free one of four episodes (Pangaea). The bond worked
exactly as specified: katanasan requested the alliance at turn 400, v83
accepted with `kp2` at 500, and katanasan extended it at turn 3200. Zero
harmful actions between the allies in both directions.

The game itself was the old loss mode: odin free peaked at 26,196 tiles by
turn 2100, then Ron SWGY (from turn 1000), Sefirot, and RelhAlpha converged
and eliminated him by turn 4600; he survived in retreat mode to 656 final
tiles. RelhAlpha ground out the win at 391,334; katanasan peaked at 79,677
and was also eliminated. Zero rejected decisions and one hold in the
episode. Official first-place streak: `0/100` (and `0/1000`). One
appearance is not a pattern; round 494 is the next measurement, with the
pile-on cell flagged as the binding constraint if it repeats.
