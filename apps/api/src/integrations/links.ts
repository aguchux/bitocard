/**
 * Where to sign up with each integration's provider and where to find its credentials, shown on its card in the admin
 * app (Settings > Integrations) and, for those resellers can connect, in SHQ (Integrations). Keyed by integration id:
 * platform groups, registry suppliers and reseller connectables share ids, so one entry serves all three.
 *
 * Every integration needs a short description (on its definition) and at least one link here, unless it is internal
 * (`internalIntegrations`: settings of BitoCard's own with no provider account). Links are the provider's own pages,
 * https only; a test checks both. Check a link still works when a provider redesigns its dashboard.
 */
export type IntegrationLink = { label: string; url: string };

/** Integrations without an outside provider account: nothing to sign up for. */
export const internalIntegrations = new Set(['general', 'web_push']);

const signUp = (url: string): IntegrationLink => ({ label: 'Sign up', url });
const keys = (url: string, label = 'Get API keys'): IntegrationLink => ({ label, url });
const docs = (url: string): IntegrationLink => ({ label: 'API docs', url });
const site = (url: string): IntegrationLink => ({ label: 'Website', url });

export const integrationLinks: Record<string, IntegrationLink[]> = {
  // Platform services.
  email: [
    { label: 'Resend: sign up', url: 'https://resend.com/signup' },
    { label: 'Resend: API keys', url: 'https://resend.com/api-keys' },
    { label: 'MailerSend: sign up', url: 'https://www.mailersend.com/signup' },
    { label: 'MailerSend: API tokens', url: 'https://app.mailersend.com/api-tokens' },
  ],
  sms: [site('https://termii.com/'), docs('https://developers.termii.com/')],
  file_storage: [signUp('https://cloud.digitalocean.com/registrations/new'), keys('https://cloud.digitalocean.com/spaces/access_keys', 'Spaces access keys'), docs('https://docs.digitalocean.com/products/spaces/')],
  google: [keys('https://console.cloud.google.com/apis/credentials', 'Google Cloud credentials'), docs('https://developers.google.com/identity/protocols/oauth2/web-server')],
  flutterwave: [signUp('https://app.flutterwave.com/register'), keys('https://app.flutterwave.com/dashboard/settings/apis'), docs('https://developer.flutterwave.com/')],
  monnify: [signUp('https://app.monnify.com/create-account'), keys('https://app.monnify.com/developer'), docs('https://developers.monnify.com/')],
  exchange_rates: [signUp('https://openexchangerates.org/signup'), keys('https://openexchangerates.org/account/app-ids', 'Get an App ID'), docs('https://docs.openexchangerates.org/')],
  didit: [signUp('https://business.didit.me/'), docs('https://docs.didit.me/')],

  // Suppliers with a built adapter (also connectable by resellers).
  reloadly: [signUp('https://www.reloadly.com/registration'), docs('https://developers.reloadly.com/')],
  vtpass: [signUp('https://www.vtpass.com/register'), { label: 'Sandbox sign up', url: 'https://sandbox.vtpass.com/register' }, docs('https://www.vtpass.com/documentation/')],
  didww: [signUp('https://www.didww.com/'), keys('https://my.didww.com/'), docs('https://doc.didww.com/api3/')],
  pawapay: [signUp('https://www.pawapay.io/'), { label: 'Sandbox sign up', url: 'https://dashboard.sandbox.pawapay.io/' }, docs('https://docs.pawapay.io/v2/docs/payouts')],
  zendit: [signUp('https://zendit.io/'), keys('https://console.zendit.io/', 'Zendit console'), docs('https://developers.zendit.io/api/')],

  // Registry suppliers whose adapter is not built yet.
  quickteller: [site('https://www.quickteller.com/'), { label: 'Developer portal', url: 'https://developer.interswitchgroup.com/' }],
  hubtel: [site('https://hubtel.com/'), { label: 'Developer portal', url: 'https://developers.hubtel.com/' }],
  korba: [site('https://xchange.korba365.com/')],
  ipay_elipa: [site('https://ipayafrica.com/'), { label: 'Developer portal', url: 'https://dev.ipayafrica.com/' }],
  nexway: [site('https://www.nexway.com/')],
  esim_access: [site('https://esimaccess.com/'), docs('https://docs.esimaccess.com/')],
  esimerge: [site('https://esimerge.com/')],
  ingram_micro: [site('https://www.ingrammicro.com/'), { label: 'Developer portal', url: 'https://developer.ingrammicro.com/' }],
  td_synnex: [site('https://www.tdsynnex.com/')],
  pax8: [site('https://www.pax8.com/'), { label: 'Developer portal', url: 'https://devx.pax8.com/' }],
  also: [site('https://www.also.com/')],
  prestmit: [site('https://prestmit.io/')],
  cardtonic: [site('https://cardtonic.com/')],
  telnyx: [signUp('https://telnyx.com/sign-up'), keys('https://portal.telnyx.com/#/app/api-keys'), docs('https://developers.telnyx.com/')],
  vonage: [signUp('https://dashboard.nexmo.com/sign-up'), keys('https://dashboard.nexmo.com/settings', 'API key and secret'), docs('https://developer.vonage.com/')],
  twilio: [signUp('https://www.twilio.com/try-twilio'), keys('https://console.twilio.com/', 'Account SID and auth token'), docs('https://www.twilio.com/docs')],
  plivo: [signUp('https://console.plivo.com/accounts/register/'), keys('https://console.plivo.com/dashboard/', 'Auth ID and token'), docs('https://www.plivo.com/docs/')],
  africas_talking: [signUp('https://account.africastalking.com/auth/register'), keys('https://account.africastalking.com/'), docs('https://developers.africastalking.com/')],
  maplerad: [site('https://maplerad.com/'), docs('https://maplerad.dev/')],
  onafriq: [site('https://onafriq.com/')],
  cellulant: [site('https://www.cellulant.io/'), { label: 'Developer portal', url: 'https://dev-portal.tingg.africa/' }],
  techlink_gh: [site('https://business.techlinkgh.com/')],
  kingflexy_gh: [site('https://kingflexygh.com/')],
  tupay: [site('https://tupay.africa/')],
  airalo: [site('https://partners.airalo.com/'), docs('https://partners-doc.airalo.com/')],
  esim_go: [site('https://esimgo.com/'), docs('https://docs.esim-go.com/')],
};

export const linksFor = (id: string) => integrationLinks[id] ?? [];
