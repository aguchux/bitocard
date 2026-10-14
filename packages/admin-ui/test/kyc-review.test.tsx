import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KycReviewCase } from '@bitocard/api-client/kyc';
import { KycCaseActions, KycCaseView, kycCanDecide } from '../src';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has neither object URLs nor modal dialogs.
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${next++}`);
  URL.revokeObjectURL = vi.fn();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const doc = (id: string, kind: string, type = 'image/jpeg') => ({ id, kind, content_type: type, size: 1000, uploaded_at: '2026-10-10T10:00:00Z', url: `/v1/kyc/reviews/kyc_1/documents/${id}` });

const kase: KycReviewCase = {
  object: 'kyc_review',
  id: 'kyc_1',
  kind: 'kyc',
  subject: 'customer',
  mode: 'live',
  country: 'NG',
  status: 'submitted',
  reviewer: 'reseller',
  applicant: { type: 'customer', id: 'cus_1', name: 'Ada Obi', email: 'ada@example.com' },
  store: { id: 'st_1', name: 'Ada Gifts', subdomain: 'ada' },
  reseller: { id: 'rs_1', name: 'Ada Gifts Ltd' },
  business_type: null,
  business: null,
  identity: { id_type: 'nin', id_type_label: 'National ID card', id_number: '12345678901', full_name: 'Adaeze Obi', date_of_birth: '1990-04-01' },
  documents: [doc('d1', 'id_front'), doc('d2', 'selfie'), doc('d3', 'liveness_0_0'), doc('d4', 'liveness_0_1'), doc('d5', 'business_directors', 'application/pdf')],
  liveness: { steps: [{ code: 'turn_left', label: 'Turn your head to the left' }] },
  duplicates: [{ case_id: 'kyc_0', status: 'declined', created_at: '2026-09-01T00:00:00Z', same: 'id_number' }],
  required: ['consent', 'identity', 'id_front', 'selfie', 'liveness'],
  resubmit_items: [],
  reason: null,
  note: null,
  verified_name: null,
  submitted_at: '2026-10-10T10:00:00Z',
  decided_at: null,
  decided_by: null,
};

describe('BitoCard Verify review', () => {
  test('shows the duplicate warning, the face side by side, documents and liveness by step', async () => {
    const fetchDocument = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    render(<KycCaseView kase={kase} fetchDocument={fetchDocument} />);
    expect(screen.getByText('The same ID number is on another case')).toBeTruthy();
    expect(screen.getByText('kyc_0')).toBeTruthy();
    expect(screen.getByText('12345678901')).toBeTruthy();
    expect(screen.getByText('1. Turn your head to the left')).toBeTruthy();
    await waitFor(() => expect(fetchDocument).toHaveBeenCalledTimes(5));
    await screen.findByRole('button', { name: 'Open Selfie' });
    expect(screen.getByRole('link', { name: /Open the PDF/ }).getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Front of the ID' })[0]);
    expect(screen.getByRole('toolbar', { name: 'Image controls' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeTruthy();
  });

  test('approve sends the verified name, prefilled from the name on the ID', async () => {
    const onDecide = vi.fn(async () => undefined);
    render(<KycCaseActions kase={kase} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((screen.getByLabelText('Verified name') as HTMLInputElement).value).toBe('Adaeze Obi');
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ action: 'approve', verified_name: 'Adaeze Obi' }));
  });

  test('resubmit needs at least one item and a note', async () => {
    const onDecide = vi.fn(async () => undefined);
    render(<KycCaseActions kase={kase} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask to resubmit' }));
    const confirm = () => fireEvent.click(screen.getAllByRole('button', { name: 'Ask to resubmit' }).at(-1)!);
    confirm();
    expect(await screen.findByText('Tick what the applicant should redo.')).toBeTruthy();
    expect(screen.queryByLabelText('Consent')).toBeNull();
    fireEvent.click(screen.getByLabelText('Selfie'));
    fireEvent.change(screen.getByLabelText('Note to the applicant'), { target: { value: 'Your selfie is too dark.' } });
    confirm();
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith({ action: 'resubmit', items: ['selfie'], note: 'Your selfie is too dark.' }));
  });

  test('only submitted cases are decided, unless an admin overrides', () => {
    expect(kycCanDecide({ status: 'submitted' })).toBe(true);
    expect(kycCanDecide({ status: 'approved' })).toBe(false);
    expect(kycCanDecide({ status: 'approved' }, { override: true })).toBe(true);
    expect(kycCanDecide({ status: 'draft' }, { override: true })).toBe(false);
    const { container } = render(<KycCaseActions kase={{ ...kase, status: 'draft' }} onDecide={vi.fn()} override />);
    expect(container.textContent).toBe('');
  });
});
