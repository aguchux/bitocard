import type { EmailMessage } from './email.service.js';

const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

function layout(heading: string, paragraphs: string[], code?: string) {
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#070f4c">',
    `<h1 style="font-size:20px">${escape(heading)}</h1>`,
    ...paragraphs.map(paragraph => `<p style="font-size:15px;line-height:1.5">${escape(paragraph)}</p>`),
    code ? `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escape(code)}</p>` : '',
    '<p style="font-size:13px;color:#5b6488">BitoCard, a Golojan Ltd venture.</p>',
    '</div>',
  ].join('');
  const text = [heading, '', ...paragraphs, ...(code ? ['', code] : []), '', 'BitoCard, a Golojan Ltd venture.'].join('\n');
  return { html, text };
}

export function signupCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your BitoCard sign-up code`,
    ...layout(
      'Confirm your email',
      ['Enter this code to confirm your email and continue creating your BitoCard reseller account. It expires in 30 minutes.', 'If you did not start signing up, you can ignore this email.'],
      code,
    ),
  };
}

export function verificationEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your BitoCard verification code`,
    ...layout('Confirm your email', ['Enter this code to confirm your email address. It expires in 30 minutes.'], code),
  };
}

export function passwordResetEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your BitoCard password reset code`,
    ...layout(
      'Reset your password',
      ['Enter this code to choose a new password. It expires in 30 minutes.', 'If you did not ask to reset your password, you can ignore this email.'],
      code,
    ),
  };
}

export function emailAddCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your BitoCard code to add this email`,
    ...layout(
      'Confirm this email address',
      ['Enter this code to add this address to your BitoCard account. It expires in 30 minutes.', 'If you did not ask for this, you can ignore this email.'],
      code,
    ),
  };
}

/** Sent to the primary address when another address is added, so an unexpected addition is noticed. */
export function emailAddedEmail(to: string, added: string): EmailMessage {
  return {
    to,
    subject: 'An email address was added to your BitoCard account',
    ...layout('An email address was added', [
      `${added} was added to your BitoCard account. It cannot be used to sign in unless you make it your primary email.`,
      'If you did not do this, remove it in SHQ (Settings > Your profile), change your password and contact support@bitocard.com.',
    ]),
  };
}

/** Sent to the old address once the change is done, so an unexpected change is noticed. */
export function emailChangedEmail(to: string, newEmail: string): EmailMessage {
  return {
    to,
    subject: 'Your BitoCard sign-in email was changed',
    ...layout('Your primary email was changed', [
      `Your BitoCard account now signs in with ${newEmail}. This address no longer works for signing in.`,
      'If you did not make this change, contact support@bitocard.com straight away.',
    ]),
  };
}

export function passwordChangedEmail(to: string): EmailMessage {
  return {
    to,
    subject: 'Your BitoCard password was changed',
    ...layout('Your password was changed', [
      'Your BitoCard password was just changed and your other sessions were signed out.',
      'If you did not make this change, reset your password and contact support@bitocard.com.',
    ]),
  };
}

export function invitationEmail(to: string, resellerName: string, role: string, link: string): EmailMessage {
  const message = layout(`Join ${resellerName} on BitoCard`, [
    `You have been invited to join ${resellerName} on BitoCard as ${role}.`,
    `Accept the invitation within 7 days: ${link}`,
    'If you were not expecting this, you can ignore this email.',
  ]);
  return {
    to,
    subject: `You are invited to join ${resellerName} on BitoCard`,
    text: message.text,
    html: message.html.replace(escape(link), `<a href="${escape(link)}">${escape(link)}</a>`),
  };
}

/** Amount in minor units as a readable figure, for example NGN 15,000.00. */
export function formatMoney(amount: bigint | number, currency: string) {
  const value = Number(amount) / 100;
  return `${currency} ${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function conversionsPausedEmail(to: string, currency: string, reason: string): EmailMessage {
  return {
    to,
    subject: `Alert: ${currency} conversions paused`,
    ...layout(`${currency} conversions paused`, [reason, 'Check both rate sources, then resume conversions in the admin app.']),
  };
}

export function bankAccountAddedEmail(to: string, bankName: string, last4: string): EmailMessage {
  return {
    to,
    subject: 'A payout bank account was added to your BitoCard wallet',
    ...layout('New payout bank account', [
      `A bank account ending ${last4} at ${bankName} was added for withdrawals.`,
      'Payouts to a new account start 24 hours after it is added.',
      'If you did not add it, remove it from your dashboard and contact support straight away.',
    ]),
  };
}

export function payoutPaidEmail(to: string, amount: string, last4: string): EmailMessage {
  return { to, subject: `Your withdrawal of ${amount} has been paid`, ...layout('Withdrawal paid', [`${amount} was sent to your bank account ending ${last4}.`]) };
}

export function payoutFailedEmail(to: string, amount: string, reason: string): EmailMessage {
  return {
    to,
    subject: `Your withdrawal of ${amount} did not go through`,
    ...layout('Withdrawal failed', [`Your withdrawal of ${amount} failed: ${reason}`, 'The money is back in your withdrawable earnings.']),
  };
}

export function planRenewalFailedEmail(to: string, plan: string, amount: string, graceDays: number): EmailMessage {
  return {
    to,
    subject: `We could not renew your ${plan} plan`,
    ...layout(`Your ${plan} plan needs funds`, [
      `We could not take ${amount} from your wallet to renew your ${plan} plan.`,
      `Top up your wallet within ${graceDays} days to keep it; after that your account moves to the Standard plan.`,
    ]),
  };
}

/** A reseller's own integration changed: connected, waiting for review, approved, rejected, suspended or disconnected. */
export function connectionEmail(
  to: string,
  integration: string,
  event: 'connected' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'disconnected',
  note?: string,
): EmailMessage {
  const copy = {
    connected: [`Your ${integration} account is connected`, `Your own ${integration} account is now connected to BitoCard.`],
    pending: [`Your ${integration} account is waiting for review`, `Your own ${integration} account is connected. BitoCard reviews it before you can use it live; we will email you when it is done.`],
    approved: [`Your ${integration} account is approved`, `Your own ${integration} account is approved and active on BitoCard.`],
    rejected: [`Your ${integration} account was not approved`, `BitoCard did not approve your own ${integration} account, and its credentials were erased.`],
    suspended: [`Your ${integration} account is suspended`, `BitoCard suspended your own ${integration} account on BitoCard. Contact support to have it reinstated.`],
    disconnected: [`Your ${integration} account was disconnected`, `Your own ${integration} account was disconnected from BitoCard and its credentials were erased.`],
  }[event];
  const paragraphs = [copy[1], ...(note ? [`Reason: ${note}`] : []), 'If you did not expect this, contact BitoCard support and change the credentials with the provider.'];
  return { to, subject: copy[0], ...layout(copy[0], paragraphs) };
}

export function planEndedEmail(to: string, plan: string): EmailMessage {
  return { to, subject: `Your ${plan} plan has ended`, ...layout(`Your ${plan} plan has ended`, ['Your account is now on the Standard plan. You can upgrade again at any time.']) };
}

export function webhookEndpointDisabledEmail(to: string, url: string, mode: string, link: string): EmailMessage {
  const sandbox = mode === 'test' ? ' (sandbox)' : '';
  return {
    to,
    subject: `We stopped sending webhooks to ${url}`,
    ...layout(`Webhook endpoint disabled${sandbox}`, [
      `Deliveries to ${url} have failed for 3 days, so we have disabled this endpoint.`,
      'Fix the endpoint, then enable it again in your dashboard. Events from the last 30 days are available from GET /v1/events, and you can resend any delivery from its log.',
      `Manage the endpoint: ${link}`,
    ]),
  };
}

export function resellerVerificationEmail(to: string, status: 'approved' | 'declined' | 'in_review' | 'expired' | 'in_progress', active: boolean, link: string): EmailMessage {
  if (status === 'approved') {
    return {
      to,
      subject: 'Your identity is verified',
      ...layout('Identity verified', [
        active ? 'Your identity check passed and your account is now live: you can top up your wallet and take live orders.' : 'Your identity check passed. Our team will finish reviewing your account and email you when it is live.',
        `See your account: ${link}`,
      ]),
    };
  }
  return {
    to,
    subject: 'We could not verify your identity',
    ...layout('Identity check not passed', [
      'Your identity check did not pass. This can happen if the photo of your document or face was unclear, or the details did not match.',
      `You can try again from your dashboard: ${link}`,
    ]),
  };
}

/** A delivered code or licence key, as emailed to the customer. */
export type EmailedDelivery = { kind: 'gift_card' | 'licence_key'; code: string; pin?: string; details?: Record<string, string> };

const detailLabels: Record<string, string> = { duration: 'Licence term', expires_at: 'Expires', redemption_url: 'Redeem at' };

/**
 * The codes or licence keys of an order, emailed to the reseller's customer (`recipient.email`) under the reseller's
 * store name. Never names BitoCard's suppliers. Codes are secrets: this email is the one place they are sent, and
 * nothing here is logged (the email service logs only the address and subject).
 */
export function deliveryEmail(
  to: string,
  input: { store: string; product: string; deliveries: EmailedDelivery[]; instructions?: string | null; sandbox: boolean; /** The order's access page. */ link?: string },
): EmailMessage {
  const what = input.deliveries[0]?.kind === 'licence_key' ? 'licence key' : 'gift card code';
  const plural = input.deliveries.length > 1 ? `${what}s` : what;
  const subject = `${input.sandbox ? '[Sandbox] ' : ''}Your ${input.product} ${plural} from ${input.store}`;
  const intro = [
    `Thank you for your order from ${input.store}. Here ${input.deliveries.length > 1 ? `are your ${input.deliveries.length} ${plural}` : `is your ${what}`} for ${input.product}.`,
    'Keep this email safe: anyone with the code can use it.',
    ...(input.sandbox ? ['This is a sandbox test order: the codes below are not real.'] : []),
  ];
  const rows = input.deliveries.map((delivery, index) => {
    const label = `${what[0].toUpperCase()}${what.slice(1)}${input.deliveries.length > 1 ? ` ${index + 1}` : ''}`;
    const extras = [
      ...(delivery.pin ? [['PIN', delivery.pin] as const] : []),
      ...Object.entries(delivery.details ?? {})
        .filter(([key]) => detailLabels[key])
        .map(([key, value]) => [detailLabels[key], value] as const),
    ];
    return { label, code: delivery.code, extras };
  });
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#070f4c">',
    `<h1 style="font-size:20px">${escape(`Your ${input.product}`)}</h1>`,
    ...intro.map(paragraph => `<p style="font-size:15px;line-height:1.5">${escape(paragraph)}</p>`),
    ...rows.map(
      row =>
        `<div style="border:1px solid #dfe3f0;border-radius:10px;padding:12px 14px;margin:10px 0">` +
        `<p style="margin:0;font-size:12px;color:#5b6488">${escape(row.label)}</p>` +
        `<p style="margin:4px 0 0;font-family:Consolas,monospace;font-size:18px;font-weight:bold;word-break:break-all">${escape(row.code)}</p>` +
        row.extras.map(([name, value]) => `<p style="margin:4px 0 0;font-size:13px">${escape(name)}: <strong>${escape(value)}</strong></p>`).join('') +
        '</div>',
    ),
    ...(input.instructions ? [`<p style="font-size:15px;line-height:1.5"><strong>How to redeem:</strong> ${escape(input.instructions)}</p>`] : []),
    ...(input.link
      ? [`<p style="font-size:15px;line-height:1.5">You can also see your order at any time on its page: <a href="${escape(input.link)}" style="color:#2477ff">view your order</a>. Keep the link private: it opens your order.</p>`]
      : []),
    `<p style="font-size:13px;color:#5b6488">Sent for ${escape(input.store)}.</p>`,
    '</div>',
  ].join('');
  const text = [
    `Your ${input.product}`,
    '',
    ...intro,
    '',
    ...rows.flatMap(row => [`${row.label}: ${row.code}`, ...row.extras.map(([name, value]) => `${name}: ${value}`), '']),
    ...(input.instructions ? [`How to redeem: ${input.instructions}`, ''] : []),
    ...(input.link ? [`See your order at any time (keep this link private): ${input.link}`, ''] : []),
    `Sent for ${input.store}.`,
  ].join('\n');
  return { to, subject, text, html };
}

/** A storefront customer's code, under the store's name (never BitoCard's, unless the store is BitoCard's own). */
/** The code that opens an order's page, sent to the order's email under the store's name. */
export function orderAccessCodeEmail(to: string, input: { store: string; product: string; code: string }): EmailMessage {
  const paragraphs = [
    `Enter this code to open your ${input.product} order from ${input.store}. It expires in 10 minutes.`,
    'If you did not ask for it, someone may have your order link: you can ignore this email, and they cannot open your order without the code.',
  ];
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#070f4c">',
    '<h1 style="font-size:20px">Open your order</h1>',
    ...paragraphs.map(paragraph => `<p style="font-size:15px;line-height:1.5">${escape(paragraph)}</p>`),
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escape(input.code)}</p>`,
    `<p style="font-size:13px;color:#5b6488">Sent for ${escape(input.store)}.</p>`,
    '</div>',
  ].join('');
  return {
    to,
    subject: `${input.code} is your ${input.store} order code`,
    html,
    text: ['Open your order', '', ...paragraphs, '', input.code, '', `Sent for ${input.store}.`].join('\n'),
  };
}

/** Sent when an order's codes are revealed on its page (at most once a day), so the customer notices if it was not them. */
export function orderRevealedEmail(to: string, input: { store: string; product: string; at: Date }): EmailMessage {
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(input.at);
  const paragraphs = [
    `The codes for your ${input.product} order from ${input.store} were shown on its page on ${when} (UTC).`,
    `If that was not you, contact ${input.store} straight away: anyone who has a code can use it.`,
  ];
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#070f4c">',
    '<h1 style="font-size:20px">Your codes were viewed</h1>',
    ...paragraphs.map(paragraph => `<p style="font-size:15px;line-height:1.5">${escape(paragraph)}</p>`),
    `<p style="font-size:13px;color:#5b6488">Sent for ${escape(input.store)}.</p>`,
    '</div>',
  ].join('');
  return { to, subject: `Your ${input.product} codes were viewed`, html, text: ['Your codes were viewed', '', ...paragraphs, '', `Sent for ${input.store}.`].join('\n') };
}

export function customerCodeEmail(to: string, input: { store: string; code: string; purpose: 'email_verification' | 'password_reset' }): EmailMessage {
  const verify = input.purpose === 'email_verification';
  const heading = verify ? 'Confirm your email' : 'Reset your password';
  const paragraphs = verify
    ? [`Enter this code to confirm your email for your ${input.store} account. It expires in 30 minutes.`, 'If you did not create an account, you can ignore this email.']
    : [`Enter this code to choose a new password for your ${input.store} account. It expires in 30 minutes.`, 'If you did not ask to reset your password, you can ignore this email.'];
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#070f4c">',
    `<h1 style="font-size:20px">${escape(heading)}</h1>`,
    ...paragraphs.map(paragraph => `<p style="font-size:15px;line-height:1.5">${escape(paragraph)}</p>`),
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escape(input.code)}</p>`,
    `<p style="font-size:13px;color:#5b6488">Sent for ${escape(input.store)}.</p>`,
    '</div>',
  ].join('');
  return {
    to,
    subject: `${input.code} is your ${input.store} ${verify ? 'verification' : 'password reset'} code`,
    html,
    text: [heading, '', ...paragraphs, '', input.code, '', `Sent for ${input.store}.`].join('\n'),
  };
}
