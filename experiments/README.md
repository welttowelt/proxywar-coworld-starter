# Hosted policy experiments

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
