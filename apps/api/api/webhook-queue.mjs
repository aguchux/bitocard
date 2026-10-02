// Vercel Queues consumer for webhook deliveries: Vercel invokes it for each message on the `webhook-deliveries`
// topic (trigger in vercel.json). The logic lives in src/webhooks/consumer.ts, built into dist/ by `nest build`.
import consumer from '../dist/webhooks/consumer.js';

export default consumer.webhookQueueHandler;
