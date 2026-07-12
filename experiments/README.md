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
