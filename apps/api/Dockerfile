# Production-like image of the API for the local Docker environment. Build from the repository root:
#   docker compose --profile api up --build
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci && npx turbo run build --filter=@bitocard/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production PORT=3001
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# Apply migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
