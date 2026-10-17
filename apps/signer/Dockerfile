# BitoCard's crypto signer: runs off Vercel, in front of Turnkey. Build from the repository root:
#   docker build -f apps/signer/Dockerfile -t bitocard-signer .
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci && npx turbo run build --filter=@bitocard/signer && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production PORT=3010
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/signer/package.json /repo/apps/signer/package.json
COPY --from=build /repo/apps/signer/dist /repo/apps/signer/dist
WORKDIR /repo/apps/signer
USER node
EXPOSE 3010
CMD ["node", "dist/main.js"]
