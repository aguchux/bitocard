import type { EmailMessage } from './email.service';

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
