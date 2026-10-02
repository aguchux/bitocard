import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { WebhookDeliveryService } from './delivery.service';
import { WebhookQueue } from './queue';

type NodeHandler = ReturnType<WebhookQueue['nodeHandler']>;
let handler: Promise<NodeHandler> | null = null;

/**
 * The Vercel Queues consumer function (`api/webhook-queue.mjs`): the API's services without its HTTP routes, started
 * once per instance, delivering the endpoint each pushed message names.
 */
export async function webhookQueueHandler(...args: Parameters<NodeHandler>) {
  handler ??= (async () => {
    const app = await NestFactory.createApplicationContext(AppModule.register(), { bufferLogs: true });
    app.useLogger(app.get(Logger));
    const delivery = app.get(WebhookDeliveryService);
    return app.get(WebhookQueue).nodeHandler(message => delivery.handleQueueMessage(message));
  })().catch(error => {
    handler = null;
    throw error;
  });
  return (await handler)(...args);
}
