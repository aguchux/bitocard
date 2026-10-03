import { defineConfig } from 'vitest/config';

// Threads start faster than forked processes; under `npm run check` (builds and API tests in parallel) a forked jsdom
// worker could miss Vitest's fixed 60-second start limit.
export default defineConfig({ test: { environment: 'jsdom', pool: 'threads', include: ['test/**/*.test.{ts,tsx}'] } });
