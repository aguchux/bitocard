// Generates a VAPID key pair for browser push. Paste both into the admin app (Settings > Integrations > Browser push).
// Keep the private key secret; changing the pair stops pushes to every registered browser until it is turned on again.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${privateKey}`);
