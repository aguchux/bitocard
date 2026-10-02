import { Global, Module } from '@nestjs/common';
import { WebhookDeliveryService } from './delivery.service';
import { WebhookEndpointsService } from './endpoints.service';
import { EventsService } from './events.service';
import { WebhookQueue } from './queue';
import { EventsController, WebhookEndpointsController } from './webhooks.controller';

/** Global: orders, payments and payouts record events in their own transactions. */
@Global()
@Module({
  controllers: [WebhookEndpointsController, EventsController],
  providers: [WebhookQueue, WebhookDeliveryService, EventsService, WebhookEndpointsService],
  exports: [EventsService, WebhookDeliveryService, WebhookQueue],
})
export class WebhooksModule {}
