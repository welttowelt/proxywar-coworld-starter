# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /app
ARG POLICY_CODENAME=b0lverk-h0gg
ENV POLICY_CODENAME=$POLICY_CODENAME
ARG POLICY_ENGINE=
ENV POLICY_ENGINE=$POLICY_ENGINE
ARG HRAFN_RV1=1
ENV HRAFN_RV1=$HRAFN_RV1
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=proxywar-npm-cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts
COPY llm-player.mjs strategy-engine.mjs strategy-chassis.mjs planner-backoff.mjs starter-player.mjs hrafn-player.mjs hrafn-strategy.mjs ./
RUN node --check llm-player.mjs \
 && node --check strategy-engine.mjs \
 && node --check strategy-chassis.mjs \
 && node --check planner-backoff.mjs \
 && node --check starter-player.mjs \
 && node --check hrafn-player.mjs \
 && node --check hrafn-strategy.mjs
USER node
# Default is the LLM agent. launch.sh (or your upload --run) can point at
# /app/starter-player.mjs instead for the no-LLM rule agent.
CMD ["node", "/app/llm-player.mjs"]
