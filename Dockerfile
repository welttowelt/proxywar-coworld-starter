# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies
WORKDIR /app
ARG POLICY_CODENAME=b0lverk-h0gg
ENV POLICY_CODENAME=$POLICY_CODENAME
ARG POLICY_ENGINE=
ENV POLICY_ENGINE=$POLICY_ENGINE
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=proxywar-npm-cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts

FROM dependencies AS production-source
COPY llm-player.mjs intent-controller.mjs strategy-engine.mjs strategy-chassis.mjs planner-backoff.mjs starter-player.mjs ./
RUN node --check llm-player.mjs \
    && node --check intent-controller.mjs \
    && node --check strategy-engine.mjs \
    && node --check strategy-chassis.mjs \
    && node --check planner-backoff.mjs \
    && node --check starter-player.mjs
USER node

# Evaluation stages are explicit opt-in build targets. The surrogate source is
# copied only into this branch of the build graph; the default production image
# below cannot activate it through an environment variable or alternate CMD.
FROM production-source AS evaluation-base
COPY --chown=node:node \
    evaluation-static-intent.mjs \
    evaluation-static-intent-player.mjs \
    evaluation-m0-player.mjs \
    evaluation-grow-opening-player.mjs \
    evaluation-grow-low-share-player.mjs \
    evaluation-convert-weakest-player.mjs \
    evaluation-convert-largest-player.mjs \
    ./
RUN node --check evaluation-static-intent.mjs \
    && node --check evaluation-static-intent-player.mjs \
    && node --check evaluation-m0-player.mjs \
    && node --check evaluation-grow-opening-player.mjs \
    && node --check evaluation-grow-low-share-player.mjs \
    && node --check evaluation-convert-weakest-player.mjs \
    && node --check evaluation-convert-largest-player.mjs
LABEL org.opencontainers.image.title="ProxyWar Mickey static intent evaluator" \
      com.welttowelt.proxywar.evaluation-source="static-eval-v1" \
      com.welttowelt.proxywar.upload-eligible="false"

FROM evaluation-base AS evaluation-m0
CMD ["node", "/app/evaluation-m0-player.mjs"]

FROM evaluation-base AS evaluation-grow-opening
CMD ["node", "/app/evaluation-grow-opening-player.mjs"]

FROM evaluation-base AS evaluation-grow-low-share
CMD ["node", "/app/evaluation-grow-low-share-player.mjs"]

FROM evaluation-base AS evaluation-convert-weakest
CMD ["node", "/app/evaluation-convert-weakest-player.mjs"]

FROM evaluation-base AS evaluation-convert-largest
CMD ["node", "/app/evaluation-convert-largest-player.mjs"]

# This final stage is deliberately last, so an ordinary `docker build` and the
# fixed launch.sh upload path produce only the Bedrock-backed production player.
FROM production-source AS production
CMD ["node", "/app/llm-player.mjs"]
