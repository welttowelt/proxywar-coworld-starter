# Hrafn DV2: lean RCI local gate

Date: 2026-07-20

## RCI diagnosis

DV1 correctly moved Hrafn's priority from Auri to daveey, but its social
`target_player` action could preempt legal neutral land during a calm opening.
The expanded DV1 gate reduced daveey on World, yet Odin lost a small amount in
both World seats and the Pangaea result was inconsistent.

Smallest fix: keep daveey as the preferred combat target, but return no DV1
social-pressure action while a legal neutral land attack exists. The ordinary
selector then takes the productive expansion. No new state machine, threshold,
map routing, or policy layer was added.

## Source and image

- Exact parent: `0c151570f7e650a32a5705ff71692aa930012097`
- DV1 source: `af0954cf6d0d20c5f06c5c4878814d3b0e406264`
- DV2 source: `dd3d875b`
- Tests: `150/150`
- Image: `proxywar-agent-llm:hrafn-v5-dv2-amd64`
- Image ID: `sha256:caf8f21fbce05e35b0cbdf5fc9fd02dbf1e05a3e727c7eb866a7c371a31f07ef`
- Embedded `hrafn-strategy.mjs` SHA-256:
  `74473bec34162f63c6c55ec7d8a86cda7f16082a05322b445f5ec43f9746e8d9`
- Platform/user: `linux/amd64`, `node`

The new red regression fails on DV1 and passes on DV2. Full tests, Docker
syntax checks, image architecture, rootless user, and embedded source equality
all pass.

## Matched local gate

Maps: Pangaea and World. Hrafn seats: 0 and 4. Each DV2 cell reuses the exact
parent replay from the same map, seed, roster, runtime, and Hrafn seat.

| Map | Seat | Arm | Hrafn | daveey | Odin | DV1 focus |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Pangaea | 0 | DV2 | 0.184703 | 0.002446 | 0.560898 | 2 |
| Pangaea | 0 | parent | 0.182922 | 0.001576 | 0.430655 | 0 |
| Pangaea | 4 | DV2 | 0.394492 | 0 | 0.311337 | 6 |
| Pangaea | 4 | parent | 0.389068 | 0 | 0.332183 | 3 |
| World | 0 | DV2 | 0.163544 | 0.002582 | 0.396497 | 4 |
| World | 0 | parent | 0.132627 | 0.004710 | 0.393964 | 1 |
| World | 4 | DV2 | 0.213550 | 0 | 0.216791 | 8 |
| World | 4 | parent | 0.187333 | 0.007281 | 0.220077 | 0 |

Four-cell totals:

- Hrafn: `0.956290` DV2 versus `0.891950` parent, `+7.21%`.
- daveey: `0.005027` DV2 versus `0.013567` parent, `-62.95%`.
- Odin: `1.485523` DV2 versus `1.376879` parent, `+7.89%`.
- Hrafn decisions: `332/332` accepted.
- Holds/rejects/K1Z harm: `0/0/0`.
- Replay-visible DV1 marker reasons: `18`; accepted daveey focus actions: `20`.

Replay SHA-256:

- Pangaea seat 0 DV2:
  `9c1f187162c713c5280215390a850bf9f10c58984d2d076282495449c88b2b9c`
- Pangaea seat 0 parent:
  `53e4a9ea5baecd8c0b2e89dc7e53c09818d4279fdaa3add402b97a9b8b96e9ad`
- Pangaea seat 4 DV2:
  `7b4b0ad37c2548cfeaf9de3a6db7ebbc74711faadebf679040b569467480f8d0`
- Pangaea seat 4 parent:
  `32187ddbdabd696d6ba39c3c0a08109439c7b1f8983dc67fd5f9034ff4e18e80`
- World seat 0 DV2:
  `e14a744af98ab1e6889e1372c20ab9289763a825d717faca010c6ec9332b7185`
- World seat 0 parent:
  `6712403d827c6a23e22b64c0e605ec5d8bb64a3d5ba9b003144d93ee38c58c16`
- World seat 4 DV2:
  `df59ffd48ef20d69de109f8403ad6d463d9e9a51fe6c99afe7c01b75afa35e20`
- World seat 4 parent:
  `0e0a69157fd99c042efcd2359ab47813d563a7b1d3eda8544381ac361985f620`

## Pre-upload RCI verdict

`SOURCE_READY` and `LOCAL_QUALIFIED` pass. The mechanism reaches, the revision
fixes the diagnosed tempo leak, aggregate Hrafn/daveey/Odin outcomes all move
in the declared direction, and safety is clean.

The local outsider named daveey is an exact proxy image, not hosted
`daveey-proxywar`. Therefore local evidence cannot establish performance
against real daveey. The authorized next action is a diagnostic upload followed
by the current-roster hosted `4/4`. No league submission or champion change is
allowed from this local result.
