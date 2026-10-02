// Vercel's NestJS preset picks the entrypoint that imports NestJS directly, so keep this import here.
import '@nestjs/core';
import { createApp } from './bootstrap';

async function main() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3001);
}

void main();
