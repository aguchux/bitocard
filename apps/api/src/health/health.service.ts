import { Injectable } from '@nestjs/common';

/** Process health only; no database or upstream service is connected yet. */
@Injectable()
export class HealthService {
  status() {
    return {
      status: 'ok',
      service: 'bitocard-api',
      environment: process.env.VERCEL_ENV ?? 'local',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    };
  }
}
