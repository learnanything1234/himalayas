# A-level predictor API — zero runtime npm dependencies (uses node:sqlite + node:http)
FROM node:22-slim

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY Design ./Design
COPY data/alevel_transition_matrix.csv data/alevel_cohort_sizes.csv ./data/

# Build the SQLite DB and stage the website at image-build time
RUN node scripts/build-db.mjs && node scripts/build-web.mjs

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
