# merit ledger

## active seat

| Policy | State | Evidence |
| --- | --- | --- |
| `hrafn-fylking:v5` | champion | live API verification `2026-07-19T15:35:56Z`: policy version `10c32300-4593-408a-a17d-02e1d70e4a2e`, submission `sub_635f34a0-e2c2-4fa6-97aa-9c864e93974c` placed with auto-champion, membership `lpm_e822de7f-1124-4b5f-b0ef-1025d46ae211` competing active and champion; exact source `0c151570`, linux/amd64 image `sha256:3f427fd3...`; no v6 upload or submission exists |
| `qd1n:v89` | coalition champion | live API verification 2026-07-19: policy version `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`, submission `sub_d159efaa-f3f1-4641-acd0-51bba2e04a72` placed, membership `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6` competing active and champion |

Merit is replay-backed progress toward sustained FFA control. A policy earns no
credit for a name, an upload, a local anecdote, or a leaderboard snapshot alone.

## proof order

1. A mechanism must execute in replay telemetry.
2. A same-seat control must establish direction.
3. The pinned hosted diagnostic must finish `4/4` with zero rejected actions and
   zero unexplained holds.
4. A `20/20` map-and-seat regression gate must pass before league promotion.
5. The rolling FFA target remains at least `99%`; the streak target remains
   `1000` wins, with a declared interim milestone of `100` consecutive
   official first-place finishes starting from the k1zuna debut (round 493).
   Neither target is currently achieved; the streak is `0/100` and `0/1000`
   and must never be reported as achieved before the official completed-round
   sequence proves it.

## current record

| Mark | Evidence | Verdict |
| --- | --- | --- |
| K1Z direct line v1.1 | one sealed JSON coordination format and one NDJSON game-learning format; canonical content and exact-file SHA-256 are separately labeled and independently verified; legacy packets are identity-ineligible; raw-byte UTF-8/JSON verification rejects newline, BOM, duplicate-key, contract, content, and packet/byte drift; exact replay/source/image binding; matched territory and post-cap deltas; duplicate formal approval rejection; `21/21` focused and `400/400` full tests; Odin runner commit `9b67e845`, `23/23` runner tests | Odin reproduced both hashes and yielded the Hrafn identity window in mailbox commit `9864d01`; protocol interoperability passed; no gameplay merit, upload, submission, membership, or champion change |
| daveey cross-game audit | official API snapshot `2026-07-20T17:33:17Z`: rank one in six of thirteen games and top three in nine; `89/200` unweighted recent first-place ranks across ten games; rapid version cadence in Proxywar and CTF; Proxywar v22 winner rows show higher opening/conversion adherence, lower conversion/finish holds, stronger attack ratios, and adaptive retargeting; exact divisions, caveats, and local tables in `experiments/daveey-cross-game-pattern-20260720.json` | copy the empirical loop, not hidden code or one universal tactic; research direction only, no gameplay merit or promotion evidence |
| hrafn C3 crossover diagnostic | two foreground-leased Pangaea orientations, `624/624` accepted each, zero fallback/degradation; images swapped but exact `0.621288/0.378712` scores, `61,935/37,753` tiles, results hash, and stripped per-slot traces followed the fixed names; C3 reached `hks1=0`; 86 legal Warship chances were preempted in slot zero by 82 neutral-growth and four Defense Post actions, while seven more were preempted by Defense Posts in slot one; exact evidence in `experiments/hrafn-c3-crossover-invalid-design-20260720.json` | original C3 and the asymmetric match design rejected; no policy lift, upload, submission, or champion change; precedence-changing repair registered as new C4 arm, which must bind equally tagged identities to arms and prove branch reach before outcomes |
| hrafn C4 local registration | C4 runs bounded `hks1.hncap` before ordinary post-cap recovery; red regressions prove it replaces both Defense Post and stalled neutral-35 recovery while exact C2 retains `hg35.hncap`; equally K1Z-tagged names now remain bound to candidate and control images across seat swaps; `31/31` focused and `400/400` full tests | source/test registration passed; new arm, not a C3 repair; no match outcome, gameplay merit, upload, submission, membership, or champion change until fresh two-orientation reach evidence |
| hrafn v5 Round 535 partial | running Pangaea round with two of four replay payloads complete; one turn-cap episode with Odin top and one Ron win; Hrafn tiles `125,167` / `0`; `576/576` accepted, zero holds/fallbacks/rejects/K1Z harm; `20` productive `dn1` transfers; `rv3` reached `55` times; KF1 necessary condition reached zero times across `570` active Hrafn turns with at least eight outsiders; replay SHA-256 `534bea86...` / `009436cd...` | partial replay evidence only; no official round rank, score, or promotion verdict while Round 535 remains running |
| hrafn v5 Round 534 final | four completed World episodes; Odin / Odin / no outright winner with Odin top / Auri; Hrafn tiles `1,024` / `0` / `115,747` / `0`; `876/876` accepted, seven holds, zero Hrafn fallbacks/rejects/K1Z harm; five productive `dn1` transfers; `rv3` reached `43` times; the holds followed one withdrawn K1Z alliance request and six withdrawn quick-chat actions; replay SHA-256 `03372587...` / `50965cd7...` / `a4ec7d3b...` / `90521b32...` | Hrafn went `0/4`, official rank `12`, score `0`; current WR1 covers these retry classes, but its qualifier remains rejected after zero WR1/VR1 reach |
| hrafn v5 Round 533 final | four completed Pangaea episodes; Richard / RelhAlpha / Auri wins, then no outright winner with Katanasan top; Hrafn tiles `0` / `16,987` / `0` / `148,054`; `942/942` accepted, eight holds, zero Hrafn fallbacks/rejects/K1Z harm; `34` productive `dn1` transfers; `rv3` reached `68` times; six quick-chat and one embargo-stop retry are covered by current WR1, but the Relh replay added one hold after a withdrawn `target_player` action while three attacks and eighteen boats stayed legal; replay SHA-256 `c763bf31...` / `d79f6ee6...` / `9c24a0ca...` / `a434d6d1...` | Hrafn went `0/4`, official rank `12`, score `0`; `target_player` retry class is not covered and the qualifier-rejected arm stays closed |
| hrafn v5 Round 532 final | four completed World episodes; no outright winner with Odin top / daveey / Odin / Auri; Hrafn tiles `757` / `0` / `86,517` / `0`; `961/961` accepted, nine holds, zero fallbacks/rejects/K1Z harm; `8` productive `dn1` transfers; `rv3` reached `49` times; seven holds followed withdrawn embargo-stop actions and two followed withdrawn K1Z alliance requests while boats stayed legal; replay SHA-256 `3d2f810c...` / `47e0966f...` / `8c92f5f9...` / `702aeb5b...` | Hrafn went `0/4`, official rank `13`, score `0`; the alliance-request retries superseded Odin's approval of the prior WR1 hashes before any run |
| hrafn v5 Round 531 final | four completed Pangaea episodes; Odin / daveey / no outright winner / Richard Higgins; Hrafn tiles `45,791` / `15,486` / `191,322` / `0`; `793/793` accepted, thirteen holds, zero fallbacks/rejects/K1Z harm; `39` productive `dn1` transfers; `rv3` reached `45` times; eleven holds followed withdrawn quick-chat actions and two followed withdrawn embargo-stop actions while productive actions stayed legal; replay SHA-256 `9ed404da...` / `a31b7527...` / `f0f3838a...` / `bf8759e0...` | Hrafn went `0/4`, official rank `12`, score `0`; the two embargo-stop retries blocked the old VR1 packet and forced the separate `wr1` recovery arm |
| hrafn v5 Round 530 final | official round failed after two of four World episodes completed; daveey won the first and Hrafn survived with `123` tiles; the second reached turn `50,400` without an outright winner and Hrafn was eliminated; a third failed with an unattributed game error and the fourth was cancelled with `round_failed`; `338/338` accepted, zero holds/fallbacks/rejects/K1Z harm; `11` productive `dn1` transfers; `rv3` reached `30` times; replay SHA-256 `f06a7baf...` / `7cc46d31...` | retain the two completed replays, but assign no official rank, score, or promotion verdict to the failed round |
| hrafn v5 Round 529 checkpoint | four completed Pangaea episodes, Auri / daveey / Richard / daveey wins; Hrafn tiles `4,142` / `69,786` / `3,170` / `19,827`; `439/439` accepted, two holds, zero fallbacks/rejects/K1Z harm; `21` productive `dn1` transfers; `rv3` reached `29` times across both daveey episodes; the two holds followed withdrawn quick-chat actions while attacks/build stayed legal; replay SHA-256 `87b56e19...` / `ebd76d3d...` / `5830ee29...` / `ff3b3e1c...` | coalition contract passes, but v5 went `0/4` and retains a quick-chat retry hold defect; baseline only |
| hrafn v6 `vr1+wr1` qualifier | Round 532's alliance-request retry cases were added red-first; candidate `cfdcd5a6` passes `157/157` on exact amd64 image `sha256:02439078...`, control `6f1ace3e` passes `153/153` on `sha256:aa5c15a3...`; Odin exact-hash approval `66c9752`; supervised qualifier request `d26705a5...` completed with replay `108f86ab...`; Hrafn accepted `303/303` with zero Hrafn fallbacks/rejects/K1Z harm, but selected ten holds, seven with legal boats, and reached `vr1=0`, `wr1=0` | rejected at `LOCAL_QUALIFIED`; no matched request, upload, hosted `4/4`, regression `20/20`, final audit, submission, placement, membership, or champion change |
| hrafn KF1 supporter source proof | exact live-v5 parent; code `a0d71a6a`, evidence `6245f546`, exact amd64 image `sha256:2bfd61aa...`; four red-first positive cases; `155/155`; ten dormant malformed/mixed-roster cases; rounds 533-534 supply `1,794` active-turn ordinary controls with zero necessary-condition turns and zero `kf1` reach; Odin review requested in mailbox `a2fd925` | `SOURCE_READY=false`; source review pending, immutable qualifier hashes absent, positive replay reach absent; no episode, upload, submission, membership, or champion action |
| v14 champion | only active league membership after stale-seat retirement | hold |
| v27 local | `4/4`, City 400, Factory 900, 217,296 tiles; same-seat control lost with 699 | mechanism passed locally |
| v27 hosted | `1/4`, tiles 2,320 / 235,939 / 31,468 / 44,426; 114 fallbacks; 111 holds | rejected |
| v28 hosted | `0/4`; fallbacks 114→25; holds 111→30 | transport repair kept, policy rejected |
| v29 hosted | `0/4`; new dominance band had no credible strike window | rejected |
| v30 hosted | `0/4`; veto fired on 230 decisions, 211 productive reranks | mechanism active, policy rejected |
| RCI protocol | preflight validates reach, trace independence, marker, baseline, `4/4`, and `20/20` | enforced |
| v14 current control | `0/4`; Auri `4/4`; reserve 0.48 at Auri's 1.66x turn-1900 entry in every episode | weak-seat opening confirmed |
| v24 requalified parent | 28 replay-derived reserve interventions; prior `3/4` on the same roster | diagnostic parent only |
| v31 hosted | `1/4`; opening reserve fired 28 times; bank-build fired zero times; four holds | rejected, no league change |
| lean-finish no-go | old reach `4/4`, current reach `0/4`; combined v24-equivalent parent `4/8` | killed before upload |
| v28 current control | `0/4`; tiles 2,041 / 34,930 / 3,783 / 4,600; 45 holds; three current parity-window traces | tactical parent only |
| v32 local | 407 accepted; zero holds/rejections/degradation; parity marker `0`; verified replay | runtime proof only |
| v32 hosted | `3/4`; 15/15 parity pulses accepted; eight holds; no rejections | directional gain, rejected |
| v33 local | 407 accepted; zero holds/rejections/degradation; salvage marker `0`; verified replay | runtime proof only |
| v33 hosted | `3/4`; tiles 218,588 / 228,082 / 218,310 / 27,546; eight holds; salvage marker `0` | rejected, dead layer removed |
| Fable review | correct server-menu boundary and request-freshness diagnosis; tactical derivatives `0/4`, `0/4`, then zero markers | forensics retained, tactical authority retired |
| v34 local | full four-container path; 108/108 candidate decisions accepted; zero rejections/fallbacks; Auri won; sever marker `0` | runtime proof only, tactical gate pending |
| v34 hosted | `0/4`; Auri sweep; tiles 28,543 / 31,434 / 20,739 / 32,388; 25 holds; sever marker `0` | rejected, impossible risk gate found |
| v35 preflight | one risk-filter deletion; 16 parent decisions across three traces; `65/65` fixtures; full local episode skipped by user | hosted diagnostic only |
| v35 hosted | `1/4`; tiles 221,857 / 37,946 / 5,942 / 14,776; final episode lost to Auri; 25 holds; sever marker `0` | lane retired by explicit user rule |
| Auri counter | attacks Odin after reaching about `1.31-1.34x`; Odin wins allow 0-1 such attacks and produce 31-38 hostile attacks | retained opponent evidence |
| promotion validator | hosted-ready is separate from hosted `4/4` and regression `20/20` completion | false promotion claim closed |
| qd1n rci-1 local | `75/75` tests; four Pangaea runs; mirrored score `1-1`; 1,226/1,226 accepted; zero holds/rejections; eight conversion marks; planner failures `17->10` in mirrored seats | operational gain only; no upload or league change |
| qd1n rci-2 local | rounds 366-367: qd1n attacked nonhostile katanasan `46` times and received `0`; `81/81` tests; two current `0.1.8` 8P Pangaea mirrors; score `1-1`; `1,442/1,442` accepted; one hold per image; zero rejections; named branch absent under generic local names | bounded workshop candidate; no upload or league change |
| qd1n rci-3 local | round 373: 107 boats into Richard at 0.27-0.46 after conversion stalled; historical wins had `0/464` invasions below 0.50; `85/85` tests; paired Pangaea score `1-1`; `1,371/1,371` accepted; candidate `0` versus parent `5` sub-0.50 invasions | no-feed mechanism passed; no seat-independent win lift |
| qd1n v76 live | linux/amd64 image matched commit `f9d50fe`; submission `sub_bbface4c-2afc-4170-b3af-0f7540bbf563`; qualification passed; membership `lpm_807274c0-0f71-4c13-8990-3dc932a9f7e5` champion and v2 benched | operator-directed live promotion; standard `4/4` and `20/20` gates not completed |
| qd1n rci-4 local | World seat four went `0/6` with 1,219 neutral boats and zero naval invasions; red-green boundary regression; `87/87` tests; alternating-seat World mirror candidate `1`, parent `0`; all `1,040/1,040` decisions accepted; candidate one hold, parent two | low-share diagnosis and runtime passed; winning seat did not reach branch; hosted promotion gate incomplete |
| qd1n v77 live | linux/amd64 upload `c0213724-8fb6-40d3-97da-fd1b080971f7`; submission `sub_e94102ad-0853-4166-bfe8-7519403ec569`; crash qualification passed; membership `lpm_6eb28046-ebef-4127-a5b6-7653a72ce73b` in Competition; v77 sole qd1n champion and v76 benched | operator-directed relaunch completed; standard `4/4` and `20/20` strategic gates not completed |
| qd1n rci-5 local | rounds 391-410: `110` target marks in `12` losses and zero winning episodes; official engine applies `-40` target relation per mark; first rewrite rejected for spreading `10` marks over more rivals; corrected exact mirror cut marks `10->3`, holds `2->9`, with the same winner, turn, and tiles; `81/81` tests; `645/645` accepted | mechanism and runtime passed; no local win lift, no upload, no league change |
| qd1n rci-6 local | rounds 398-417: collapse-proxy positions used `57` neutral 35% attacks across `19` losses and zero across wins; an alliance-first rewrite fired `sv1` four times but lost to the parent; corrected `cp1` cap passed `82/82` tests and an exact linux/amd64 `34/34` qualifier; matched Pangaea had `cp1=0`, `645/645` accepted, and the parent won slot three with the prior exact turn and tiles | bounded source correction retained; reach and `4/4` failed, so no upload or league change |
| qd1n rci-7 local | rounds 411-418: `5/24` wins versus daveey `11/31`; loss replays contained `100` skipped favorable conversion windows versus `3` in wins; ratio-only `cv2` passed `83/83` tests and `34/34` qualifier orders; matched Pangaea reached `cv2` twelve times with `660/660` accepted, but parent slot eight won 377,432 tiles and the best candidate survivor held 42,903 | hypothesis rejected; source restored, no upload, no submission, no league change |
| qd1n rci-8 local | current ProxyWar `0.1.8` sends attacker identities separately from the numeric incoming-attack count, while qd1n discarded those identity fields; `ia1` restores the existing hostility path, passed `84/84` tests and a `34/34` qualifier, then won both seat-swapped Asia mirrors with `14` marked executions, `1,082/1,082` accepted decisions, zero holds, and zero rejections | first clean two-orientation workshop advantage; retained locally, but `4/4` hosted and `20/20` regression remain open, so no upload, submission, or league change |
| qd1n rci-8 exact v77 | attribution-only diff on deployed commit `b0c205c`; `89/89` tests; `34/34` qualifier; two seat-swapped Asia wins at 873,409 and 909,275 tiles; `ia1` reached ten times across five candidate seats; `905/905` accepted with zero holds or rejections; candidate mean 240,029 tiles versus exact v77 mean 2,379.75 | exact-parent Asia advantage passed; World/Pangaea, `4/4`, and `20/20` still open, so no upload, submission, or league change |
| qd1n rci-8 exact World | both arms linux/amd64; no winner at turn 40,400; exact v77 top score `0.3655` and 238,147 tiles versus candidate top `0.2132` and 138,931; candidate mean score/tiles `0.0875` / 57,034.5 versus parent `0.1625` / 105,867.75; `ia1` reached five times; `2,294/2,294` accepted with zero holds or rejections | universal successor rejected after direct reach without World improvement; executable main restored to exact v77, ia1 retained only as an Asia arm, no upload or league change |
| qd1n sr1 exact World | attribution bonus/marker gated below `1.10x`; red regression and `90/90` suite passed; `34/34` qualifier; two `sr1` executions; `2,294/2,294` accepted with zero holds/rejections; all selected action IDs and final scores exactly matched rejected ia1 World | dead layer retired because it changed telemetry but no action or outcome; no reverse, upload, submission, or league change |
| qd1n rf1 exact World | selector-level `1.10x` reserve floor; red regression and `87/87` suite passed; amd64 qualifier accepted `34/34`; World reached `rf1` 13 times across three candidate seats with `1,054/1,054` accepted, zero holds, and zero rejections | exact v77 won outright at turn 15,500; candidate mean score `0` and 12,591 tiles versus parent `0.25` and 150,311; ratio-only floor retired, no reverse, upload, submission, or league change |
| qd1n pc1 exact World/Pangaea | active near-parity counter escalated from 10% to 40%; red regression and `90/90` suite passed; amd64 qualifier `34/34`; candidate won both World seat directions at 632,072 and 532,198 tiles, with two accepted `pc1` executions and zero candidate holds/rejections | Pangaea reached `pc1` once but parent won 355,670 tiles; universal successor rejected, World arm retained locally, no upload, submission, membership, or relaunch change |
| qd1n mx3 map composition local | spawn-tile map fingerprint routes Asia `ia1` and World `pc1`, exact v77 elsewhere; mx1 rejected (sentinel IDs unreachable), mx2 superseded by Asia-narrowed parsing; `95/95` tests; amd64 qualifier `34/34`; six exact-image matched runs won both Asia and both World mirrors with Pangaea trace-identical control; `ia1` 10 (5 confirmed) and `pc1` 2; `2,278/2,278` accepted, zero rejections, two explained Pangaea slot-5 holds | all local gates passed |
| qd1n mx3 hosted | uploaded exact amd64 image as `qd1n:v78` (`348cab68-a00d-483d-ba94-67c8e00d469e`) for testing only; matched baseline `xreq_8cced59b-77f1-4887-86da-f5e0b27fb8c6` finished `0/4`; candidate diagnostic `xreq_53a20fc0-3334-4495-9bfe-a03b454b3c17` finished `1/4` (won at 1,015,250 tiles, lost to `proxywar-keystone:v42`, `co-gas-proxywar-richard:v6`, `tsukuyomi-no-kage:v34`); `ia1` 6 (3 confirmed); `682/682` accepted, zero holds, zero rejections | hosted `4/4` failed, `20/20` not run, NO SUBMIT; v77 remains sole champion |
| qd1n pd1 pile-on discipline local | hosted losses showed 25-40% near-parity counters under multi-attacker pile-ons; Asia-only guard suppresses sub-1.3 rival attacks whenever two distinct attackers are attributed in the current observation or the last twelve decisions; dormant current-only mx4 superseded before upload; `101/101` tests; amd64 qualifier `34/34`; both Asia mirrors won at 884,022 and 874,107 tiles with `pd1` 14 executions; `ia1` 5 and `pc1` 2 preserved; World/Pangaea byte-identical to mx3; `2,310/2,310` accepted, zero rejections, two explained Pangaea slot-5 holds | all local gates pass; hosted `4/4` and `20/20` pending |
| qd1n pd1 hosted | uploaded exact amd64 image as `qd1n:v79` (`34345f8f-12dc-46b5-a6c8-f33ad9461519`) for testing only; diagnostic `xreq_4660c5cb-c0ab-46ad-97d6-6db432d88cad` finished `1/4` against the mx3 roster (won at 865,675 tiles, lost to `co-gas-proxywar-richard:v6` twice and `tsukuyomi-no-kage:v34`); `pd1` 11 and `ia1` 7 executions (3 confirmed); `406/406` accepted, zero holds, zero rejections | direct reach without outcome improvement over the mx3 `1/4`; arm rejected, NO SUBMIT; v77 remains sole champion |
| qd1n ef1 hosted | opening decomposition showed winners grind 22-25 neutral attacks at 35 percent with zero early probes while qd1n spent 9-11 probes that never produced a kill; probe-suppression arm passed all local gates (both mirrors, `ef1` 76 executions); hosted as `qd1n:v80` (`4e2b3d0d-db42-4807-b52f-d31580438a2a`), diagnostic `xreq_7eb566ff-04d0-4ebb-9c15-765bde6781ca` finished `0/4` with opening territory down to 54-64k — the suppressed probes had been profitable; `406/406` accepted, five unexplained holds | reach with a worse outcome than mx3; arm rejected and reverted, NO SUBMIT |
| qd1n ef2 local | flat 35-percent opening grind with no cadence warm-up and no avoid-set fallback; `101/101` tests and `34/34` qualifier passed; asia-b mirror won at 895,806 tiles, but asia-a flipped to the exact parent at 902,769 with every candidate seat starved between 281 and 6,879 tiles | lost local mirror; arm rejected before upload and reverted; v77 remains sole champion |
| ef campaign verdict | four consecutive deterministic guards (map composition, pile-on discipline, probe suppression, opening grind) produced hosted `1/4`, `1/4`, `0/4`, and a lost local mirror; executable source is restored to exact mx3 behavior every time | guard family exhausted against the current Competition field; no submission is possible without a different lever |
| qd1n sp1 hosted | three STRATEGY sentences rewritten to the hosted winner profile (no rival attacks before 12% land unless attacked first, rivals only at 1.3+, 35% neutral commitment, no second front under attack); selector byte-identical to mx3 with both Asia mirrors byte-identical to the mx3 traces; uploaded as `qd1n:v81` (`3f7d3e16-0c3f-4e2a-89ac-409909aea573`), diagnostic `xreq_4f9ab61a-83d7-4234-bcef-493b4f0d74f0` finished `0/4`; Bedrock was throttled in `224/390` decisions (57%), so the doctrine barely played and the deterministic fallback kept the old pattern; `390/390` accepted, three unexplained holds | planner-layer arm rejected on outcome; the policy is deterministic-dominated when Bedrock is throttled; NO SUBMIT |
| bounded-arm campaign close | five consecutive gates: mx3 `1/4`, pd1 `1/4`, ef1 `0/4`, ef2 local mirror lost, sp1 `0/4`; every mechanism fired as designed and no outcome moved; v77 baseline is `0/4` on the same roster | incremental qd1n variants cannot currently clear this roster; next step must be a deeper rewrite or a different evaluation strategy, not another arm |
| qd2n winner chassis | fresh minimal deterministic policy implementing the shared winner chassis (35% grind above a troop floor, retaliation-first 25% contact, sticky finishing, capped boats); `109/109` tests, `34/34` qualifier; two iterations each finished `2/6` in the mirrors with Asia/Pangaea split by dominant seats and World lost `0/4`; 51 holds in ch1 fell to 14 in ch2 | fails mirrored gates; never uploaded; retained as analysis evidence |
| decisive A/B | twelve-episode extension per arm on the standard roster: v77 `0/12`, mx3 (v78) `1/12` | no ship case; the edge is noise at this sample and the `4/4` gate stays unmet; v77 remains sole champion |
| league-field A/B | current round-471/472 roster, eight episodes per arm: v77 `0/8`, mx3 `0/8`; `richard:v7` won nine of sixteen | no ship case in the arena that counts either; opponents iterate faster |
| qd2n architecture project | three chassis generations plus the hybrid finished `2/6`, `2/6`, `1/6`, then hybrid `4/6` with Asia split and every trace byte-identical to its donor code; mx3's `5/6` with both Asia mirrors dominates the hybrid | project closed by its own stop rule; mx3 remains the best measured policy, v77 sole champion |
| qd1n kingmaker package | operator directive: katanasan is a declared 100% supporter; unconditional protection with no tile-share cutoff (kp1), proper Atom Bomb usage (nk1), immediate alliance acceptance with 6-decision retry until `isAllied` (kp2), and break/reject/embargo/target exclusions; `122/122` tests; `34/34` qualifier; both Asia mirrors won (873,409 / 908,254, asia-a byte-identical to mx3) | hosted `xreq_6fe7820d` finished `0/4` with **zero attacks on katanasan in every episode** — the contract is verified live; local smoke sent 14 kp2 requests with zero holds; v83 uploaded as the handshake artifact |
| qd1n:v83 k1zuna live | operator-directed promotion 2026-07-18: submission `sub_f25b48b7-1100-4055-805d-7ab9319321b5` placed, qualification passed, membership `lpm_5c3f41eb-7a50-4342-a136-172466376eb9` sole champion, v77 benched | k1zuna reigns; standard `4/4` and `20/20` strategic gates not completed (operator override, as with v76/v77); next official round to confirm v83 in the roster |

Detailed evidence lives in [`experiments/`](experiments/README.md). Public round
statistics live on the [dashboard](https://welttowelt.github.io/proxywar-coworld-starter/).

Live truth after this audit: qd1n remains overall rank one at `44.6476`. Rounds
373-375 finished `3, 2, 2`, so the active first-place streak is `0/1000`.
`qd1n:v76` is champion and `qd1n:v2` is benched. Round 376 sealed its roster one
minute before v76 qualified and therefore still uses v2; v76 can first enter
round 377. The live promotion does not satisfy the sustained-win target.

Round 407 is the pre-rci-4 checkpoint. Qd1n remains overall rank one at
`45.1306`, with `22/77` episode wins and a current first-place streak of
`1/1000`. `qd1n:v76` is still champion pending the operator-directed rci-4
relaunch. The standard hosted `4/4` and `20/20` gates are not complete.

The rci-4 relaunch is complete. `qd1n:v77` is the sole qd1n champion in
Competition under membership `lpm_6eb28046-ebef-4127-a5b6-7653a72ce73b`;
`qd1n:v76` is benched. Qualification proves the image starts and plays. It does
not supply the missing hosted strategic gate, and the `1000`-win goal remains
open.

Round 410 finished with qd1n official first at score `0.5`, but only one of four
episodes was a win. V77 then placed first in round 411 with one win across three
completed appearances and second in round 412 with one of three. The official
first-place streak is `0/1000`; round 413 is running. The corrected rci-5 source
is committed and locally gated only; it has not been uploaded or submitted.

Rounds 414-417 placed `9, 2, 9, 9`, with one episode win across twelve qd1n
appearances. Rounds 416 and 417 were consecutive `0/3` results. The refreshed
twenty-round window is `19/72` episode wins (`26.39%`), the official first-place
streak is `0/1000`, and round 418 is running with eleven entrants. Qd1n remains
overall rank one at `45.1306`, but that historical score does not clear the
current conversion failure. Rci-6 is committed locally at `e320ba9`; no v78 was
uploaded or submitted.

Rci-7 tested whether an early `1.30x` rival probe should interrupt neutral
farming. The matched Pangaea gate reached the branch twelve times, but the
parent won and the candidate produced no winner. The candidate was removed and
v77 remains the exact live source. No v78 exists; the streak remains `0/1000`
at the round-418 checkpoint.

Round 420 placed qd1n third with one win across four Asia episodes. The refreshed
twenty-round window is `19/72` episode wins (`26.39%`), and the official streak
is `0/1000`. Historical rating still lists Odin Free first overall at `45.1306`,
but the current eight-round field gives qd1n `5/26` wins against `9/31` for both
daveey and Auri.

Rci-8 found a protocol-adapter defect instead of adding another combat rule.
ProxyWar `0.1.8` exposes `ownState.incomingAttacks` as a count and sends the
attacker IDs through `combat.incomingAttackPlayerIDs` plus per-rival flags.
Qd1n read only the count, so the existing retaliation and betrayal logic lost
the attacker's identity. The `ia1` candidate merges the current fields into the
existing history model. It won both seat-swapped local Asia mirrors; the parent
won neither. This passes mechanism, runtime, and matched-advantage gates only.
No v78 was uploaded or submitted, and v77 remains the sole live champion.

The post-test refresh closed round 422 on World at official rank three, again
with one win across four episodes. Qd1n averaged 158,286 tiles, recorded 24
holds and 204 fallbacks, and remains at a `0/1000` first-place streak. Across
rounds 415-422, qd1n won `6/29` appearances (`20.69%`) while daveey won `12/32`
(`37.5%`). Overall rating still shows Odin Free first at `45.1306`; that
historical lead does not satisfy current dominance or authorize bypassing the
unfinished rci-8 gates.

Rci-11 composed the proven arms behind a spawn-tile map fingerprint: `ia1`
only on Asia, `pc1` only on World, exact v77 on Pangaea and unknown maps. The
mx2 string-form parsing was narrowed to Asia after source-isolation review,
producing the mx3 image; mx1 was rejected earlier because legal-action
sentinel IDs never reached the policy. All six exact-image matched runs
reproduced their mx2 traces decision-for-decision: candidate won both Asia and
both World mirrors, and Pangaea stayed trace-identical under swapped labels
with the same two slot-5 holds under both arms, which keeps them explained.
The exact amd64 image was uploaded as `qd1n:v78` for hosted testing with v77
kept live. The hosted gate then rejected the candidate: the matched v77
baseline went `0/4` and the candidate went `1/4` on tournament-8p-asia against
the current Competition field. `ia1` executed six times with three
confirmations, all `682` candidate decisions were accepted, and there were no
holds or rejections, but the `4/4` gate failed. Verdict: NO SUBMIT; the `20/20`
regression was not run, v77 remains the sole live champion, and mx3 is
retained only as a local population arm.

Round 443 finished official first at score `0.75` with `qd1n:v77`, lifting the
verified streak to `1/1000`. Round 444 then finished fourth at `0.25`
(`co-gas-proxywar-richard:v6` first), resetting the official first-place
streak to `0/1000`; rounds 446 and 447 placed second and third. Qd1n remains
overall rank one at `33.5505` against daveey `24.2877` and Auri `23.6957`.
The `1000`-win target stays open.

Rci-12 read the three hosted mx3 losses as one mechanic: under multi-attacker
pile-ons, qd1n kept launching 25-40 percent counters at 1.01-1.21 ratios while
its strategic layer already asked for defense. The `pd1` guard answers only on
Asia: when two distinct attackers are attributed in the current observation or
the last twelve decisions and the best rival ratio is below 1.3, the rival
attack is suppressed and the replacement is marked. The winning ep1 pattern
(one attacker, counters at 1.3-6x) is deliberately unreachable. A current-only
variant (mx4) stayed dormant through all six matched runs and was superseded
before upload. The windowed mx5 passed `101/101` tests, a `34/34` qualifier,
and won both Asia mirrors at 884,022 and 874,107 tiles with `pd1` executing
fourteen times; World and Pangaea stayed byte-identical to the mx3 traces.
The hosted diagnostic then rejected the arm: uploaded as `qd1n:v79` for
testing, it finished `1/4` against the mx3 roster with `pd1` executing eleven
times and `ia1` seven, all `406` decisions accepted with zero holds and zero
rejections — direct reach without outcome improvement over the mx3 `1/4`.
No submission was made and v77 remains the sole live champion. The overall
lead narrowed to `31.9642` over Auri `26.9881`; the remaining hosted failure
class is the early snowball that `pd1` never claimed to answer, with katanasan
and Richard Higgins converting eliminations before the guard can matter.

Rci-13 chased that snowball into the opening. The winner profile across the
twelve hosted episodes is mechanical: 22-25 neutral attacks, all at 35
percent, zero to three rival probes, and 174-265k tiles by turn 3000. Qd1n
ground out 72-106k with a mixed cadence and nine to eleven probes that never
produced a kill. Two arms tried to close that gap. `ef1` suppressed the
opening probes and passed every local gate, but hosted as `qd1n:v80` it went
`0/4` with opening territory down to 54-64k — the probes had been profitable,
and five unexplained holds landed beside them. `ef2` forced the flat 35
percent grind and lost the asia-a local mirror outright, with every candidate
seat starved under 7,000 tiles. Both arms are rejected and reverted; the
source rests at exact mx3 behavior, no submission was made, and v77 remains
the sole live champion. Four deterministic guards have now failed to move the
hosted field: the next lever must come from outside the guard family.
