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
