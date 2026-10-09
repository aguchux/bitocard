/** Names that belong to BitoCard itself and can never be a store's subdomain. */
export const reservedSubdomains = new Set([
  'admin', 'api', 'app', 'apps', 'assets', 'auth', 'billing', 'bitocard', 'blog', 'cdn', 'checkout', 'dashboard', 'dev', 'docs',
  'email', 'ftp', 'golojan', 'help', 'internal', 'legal', 'legals', 'login', 'mail', 'ns1', 'ns2', 'pay', 'payments', 'portal',
  'preview', 'reseller', 'resellers', 'sandbox', 'secure', 'shop', 'shq', 'signin', 'signup', 'smtp', 'staging', 'static', 'status',
  'store', 'stores', 'support', 'test', 'wallet', 'webhooks', 'www',
]);
