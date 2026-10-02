import { Global, Module } from '@nestjs/common';
import { WebhookDeliveryService } from './delivery.service';
import { WebhookEndpointsService } from './endpoints.service';
import { EventsService } from './events.service';
import { EventsController, WebhookEndpointsController } from './webhooks.controller';

/** Global: orders, payments and payouts record events in their own transactions. */
@Global()
@Module({
  controllers: [WebhookEndpointsController, EventsController],
  providers: [WebhookDeliveryService, EventsService, WebhookEndpointsService],
  exports: [EventsService, WebhookDeliveryService],
})
export class WebhooksModule {}
