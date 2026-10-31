import { Global, Module } from '@nestjs/common';
import { WebhookDeliveryService } from './delivery.service.js';
import { WebhookEndpointsService } from './endpoints.service.js';
import { EventsService } from './events.service.js';
import { WebhookQueue } from './queue.js';
import { EventsController, WebhookEndpointsController } from './webhooks.controller.js';

/** Global: orders, payments and payouts record events in their own transactions. */
@Global()
@Module({
  controllers: [WebhookEndpointsController, EventsController],
  providers: [WebhookQueue, WebhookDeliveryService, EventsService, WebhookEndpointsService],
  exports: [EventsService, WebhookDeliveryService, WebhookQueue],
})
export class WebhooksModule {}
