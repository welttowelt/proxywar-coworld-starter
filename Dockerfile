FROM node:24-bookworm-slim
WORKDIR /app
ARG POLICY_CODENAME=b0lverk-h0gg
ENV POLICY_CODENAME=$POLICY_CODENAME
ARG POLICY_ENGINE=
ENV POLICY_ENGINE=$POLICY_ENGINE
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY llm-player.mjs strategy-engine.mjs strategy-chassis.mjs planner-backoff.mjs starter-player.mjs ./
# Default is the LLM agent. launch.sh (or your upload --run) can point at
# /app/starter-player.mjs instead for the no-LLM rule agent.
CMD ["node", "/app/llm-player.mjs"]
