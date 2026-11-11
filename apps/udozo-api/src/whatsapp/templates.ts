/**
 * Udozo's WhatsApp message templates: the only messages Meta lets a business send outside the 24-hour window after a
 * person's last message. Each is a utility template with one quick-reply button whose payload brings them back to
 * what it is about, which reopens the window. Submitted to Meta from the admin (Site > WhatsApp) and approved there.
 */
export const templateLanguage = 'en_GB';

export type TemplateDefinition = {
  /** What the admin page says it is for. */
  purpose: string;
  /** Its body, with {{1}}, {{2}} as Meta numbers them, and an example of each for Meta's review. */
  body: string;
  examples: string[];
  /** The quick-reply button's text (its payload is set on each message); for a verification template, its copy button. */
  button: string;
  /** Meta's category: utility (the default) or authentication (codes, whose words Meta writes). */
  category?: 'UTILITY' | 'AUTHENTICATION';
};

/** How long a verification code works, as Meta's verification template says under it. */
export const codeExpiryMinutes = 30;

export const whatsappTemplates = {
  udozo_new_message: {
    purpose: 'A chat message waiting while the 24-hour window is closed.',
    // Meta refuses a body that starts or ends with a variable.
    body: 'New message on Udozo: {{1}} wrote to you about {{2}}. Tap Read it to see it and reply here.',
    examples: ['Chinedu O.', 'iPhone 13 Pro 256GB'],
    button: 'Read it',
  },
  udozo_wanted_match: {
    purpose: "A buyer's wanted request that matches what a seller sells.",
    body: 'A buyer on Udozo is looking for {{1}} in {{2}}. Tap See request to answer with one of your listings.',
    examples: ['a used Toyota Corolla 2012', 'Lagos'],
    button: 'See request',
  },
  udozo_wanted_response: {
    purpose: 'A seller answered a wanted request.',
    body: 'A seller answered your Udozo request for {{1}} with {{2}}. Tap See it to chat with them.',
    examples: ['a used Toyota Corolla 2012', 'Toyota Corolla 2012, ₦4,500,000'],
    button: 'See it',
  },
  udozo_account_update: {
    purpose: 'Other updates: buy orders, contact requests answered, call backs, missed calls.',
    body: 'Udozo update: {{1}}. Tap Open to see it.',
    examples: ['Kemi accepted your buy order for the Hisense 50 inch TV'],
    button: 'Open',
  },
  udozo_verification_code: {
    purpose: "A code to confirm a mobile number (sign-up, the profile, Seller HQ's numbers), when it goes by WhatsApp. Meta writes its words.",
    body: '{{1}} is your verification code. For your security, do not share this code.',
    examples: ['123456'],
    button: 'Copy code',
    category: 'AUTHENTICATION',
  },
  udozo_pos_receipt: {
    purpose: "A shop's receipt from Udozo POS, sent to the number the cashier typed while the 24-hour window is closed: its button brings the PDF.",
    body: 'Your receipt from {{1}} is ready: {{2}}, {{3}}. Tap Get receipt to receive it here as a PDF.',
    examples: ["Ada's Gadget Hub", 'POS-000123', 'NGN 38,700.00'],
    button: 'Get receipt',
  },
  udozo_link_confirmed: {
    purpose: 'Sent once when a number is connected to an account from udozo.com.',
    body: 'Your WhatsApp is now connected to your Udozo account, {{1}}. Tap Menu to find, sell or ask for something.',
    examples: ['Kemi'],
    button: 'Menu',
  },
} satisfies Record<string, TemplateDefinition>;

export type TemplateName = keyof typeof whatsappTemplates;
export const templateNames = Object.keys(whatsappTemplates) as TemplateName[];

/** A template call: its name, the body's values in order and the button's payload. */
export type TemplateCall = { name: TemplateName; params: string[]; payload: string };

/** The body Meta's template API takes to create one. */
export function templateSubmission(name: TemplateName) {
  const template: TemplateDefinition = whatsappTemplates[name];
  if (template.category === 'AUTHENTICATION') {
    return {
      name,
      language: templateLanguage,
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: codeExpiryMinutes },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: template.button }] },
      ],
    };
  }
  return {
    name,
    language: templateLanguage,
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: template.body, example: { body_text: [template.examples] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: template.button }] },
    ],
  };
}

/** What a template says, filled in (kept as the message's text in the log). */
export const templateText = (call: TemplateCall) => whatsappTemplates[call.name].body.replace(/\{\{(\d+)\}\}/g, (_all, index: string) => call.params[Number(index) - 1] ?? '');
