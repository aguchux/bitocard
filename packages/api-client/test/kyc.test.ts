import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi, adminKycApi } from '../src/admin';
import { kycDecisionBody, kycDeclineReasons, kycDocumentLabel, kycItemLabels, kycItems, kycLivenessGroups } from '../src/kyc';
import { makeStore } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    return Response.json({ object: 'kyc_review', id: 'kyc_1' });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('BitoCard Verify helpers', () => {
  test('decision bodies carry only what each endpoint takes, trimmed', () => {
    expect(kycDecisionBody({ action: 'approve', verified_name: '  Ada Obi ' })).toEqual({ verified_name: 'Ada Obi' });
    expect(kycDecisionBody({ action: 'decline', reason: 'face_mismatch', note: '  ' })).toEqual({ reason: 'face_mismatch' });
    expect(kycDecisionBody({ action: 'decline', reason: 'other', note: 'Blurred' })).toEqual({ reason: 'other', note: 'Blurred' });
    expect(kycDecisionBody({ action: 'resubmit', items: ['id_front', 'selfie'], note: ' Too dark ' })).toEqual({ items: ['id_front', 'selfie'], note: 'Too dark' });
  });

  test('every item and decline reason has words', () => {
    for (const item of kycItems) expect(kycItemLabels[item]).toBeTruthy();
    expect(Object.keys(kycDeclineReasons)).toEqual(['document_unreadable', 'document_expired', 'document_mismatch', 'face_mismatch', 'liveness_failed', 'business_document_invalid', 'underage', 'suspected_fraud', 'other']);
  });

  test('liveness frames are grouped by step in order, with the instruction', () => {
    const steps = [
      { code: 'turn_left', label: 'Turn your head to the left' },
      { code: 'smile', label: 'Smile' },
    ];
    const docs = ['liveness_1_2', 'id_front', 'liveness_0_1', 'liveness_1_0', 'liveness_0_0'].map(kind => ({ kind }));
    expect(kycLivenessGroups(docs, steps)).toEqual([
      { step: 0, label: 'Turn your head to the left', frames: [{ kind: 'liveness_0_0' }, { kind: 'liveness_0_1' }] },
      { step: 1, label: 'Smile', frames: [{ kind: 'liveness_1_0' }, { kind: 'liveness_1_2' }] },
    ]);
    expect(kycDocumentLabel('liveness_1_2', steps)).toBe('Smile, frame 3');
    expect(kycDocumentLabel('liveness_4_0')).toBe('Liveness step 5, frame 1');
    expect(kycDocumentLabel('business_directors')).toBe('Directors and owners document');
  });
});

describe('admin hooks', () => {
  test('cases are filtered without empty values; decisions post to their own endpoint', async () => {
    const store = makeStore();
    await store.dispatch(adminKycApi.endpoints.adminKycCases.initiate({ status: 'submitted', subject: undefined, reviewer: 'admin' }));
    await store.dispatch(adminKycApi.endpoints.decideAdminKycCase.initiate({ id: 'kyc_1', decision: { action: 'resubmit', items: ['selfie'], note: 'Too dark' } }));
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/v1/admin/kyc/cases?status=submitted&reviewer=admin&limit=50' });
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'http://api.test/v1/admin/kyc/cases/kyc_1/resubmit' });
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({ items: ['selfie'], note: 'Too dark' });
  });

  test("a market's identity provider is saved with PATCH", async () => {
    const store = makeStore();
    await store.dispatch(adminApi.endpoints.updateCountry.initiate({ code: 'GH', identity_provider: 'bitocard' }));
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'http://api.test/v1/admin/countries/GH' });
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ identity_provider: 'bitocard' });
  });
});
