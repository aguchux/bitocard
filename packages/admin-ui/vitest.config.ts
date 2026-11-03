import { defineConfig } from 'vitest/config';

// Threads start faster than forked processes; under `npm run check` (builds and API tests in parallel) a forked jsdom
// worker could miss Vitest's fixed 60-second start limit. Screens rendered cold can pass 5 seconds while other
// workspaces' tests run alongside (CI), so each test has 20.
export default defineConfig({ test: { environment: 'jsdom', pool: 'threads', include: ['test/**/*.test.{ts,tsx}'], testTimeout: 20000 } });
