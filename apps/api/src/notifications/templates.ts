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

export function emailChangeCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your BitoCard code to change your email`,
    ...layout(
      'Confirm your new email',
      ['Enter this code to make this your BitoCard sign-in email. It expires in 30 minutes.', 'If you did not ask for this, you can ignore this email.'],
      code,
    ),
  };
}

/** Sent to the old address once the change is done, so an unexpected change is noticed. */
export function emailChangedEmail(to: string, newEmail: string): EmailMessage {
  return {
    to,
    subject: 'Your BitoCard sign-in email was changed',
    ...layout('Your sign-in email was changed', [
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
