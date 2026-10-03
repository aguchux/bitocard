import { type CallHandler, type ExecutionContext, Global, Injectable, Module, type NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { from, switchMap } from 'rxjs';
import { IntegrationsService } from './integrations.service';

/** Brings this instance's copy of the admin integration settings up to date (at most every 30 seconds) before a request. */
@Injectable()
export class IntegrationsRefreshInterceptor implements NestInterceptor {
  constructor(private readonly integrations: IntegrationsService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    return from(this.integrations.refresh()).pipe(switchMap(() => next.handle()));
  }
}

@Global()
@Module({
  providers: [IntegrationsService, { provide: APP_INTERCEPTOR, useClass: IntegrationsRefreshInterceptor }],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
