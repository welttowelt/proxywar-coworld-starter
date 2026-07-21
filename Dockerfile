# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /app
ARG POLICY_CODENAME=std1
ENV POLICY_CODENAME=$POLICY_CODENAME
COPY package.json package-lock.json ./
# The lockfile layer is independent from policy edits.  BuildKit keeps the npm
# download cache between image builds, while the image itself remains clean.
RUN --mount=type=cache,id=proxywar-npm-cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts
ARG SOURCE_COMMIT
RUN printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
COPY llm-player.mjs standard-controller.mjs controller-safety.mjs ./
RUN node --check llm-player.mjs \
    && node --check standard-controller.mjs \
    && node --check controller-safety.mjs
USER node
CMD ["node", "/app/llm-player.mjs"]
