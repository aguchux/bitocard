import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PhoneContact, whatsappUrl } from '../src';

afterEach(cleanup);

describe('PhoneContact', () => {
  test("WhatsApp's click-to-chat address takes the number's digits only", () => {
    expect(whatsappUrl('+2348031234567')).toBe('https://wa.me/2348031234567');
    expect(whatsappUrl('+233 24 123 4567')).toBe('https://wa.me/233241234567');
    expect(whatsappUrl('—')).toBeNull();
  });

  test('the number calls, and the WhatsApp button opens a chat with it in a new tab', () => {
    render(<PhoneContact phone="+2348031234567" />);
    expect(screen.getByRole('link', { name: '+2348031234567' }).getAttribute('href')).toBe('tel:+2348031234567');
    const whatsapp = screen.getByRole('link', { name: /on whatsapp/i });
    expect(whatsapp.getAttribute('href')).toBe('https://wa.me/2348031234567');
    expect(whatsapp.getAttribute('target')).toBe('_blank');
    expect(whatsapp.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
