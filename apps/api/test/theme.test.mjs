// Udozo's colour theme (docs/UDOZO_SPINOFF_PLAN.md, step 3): its admins choose a ready-made theme or their own colours,
// each checked for readable contrast, preview it, then publish it; every app reads it from GET /v1/theme.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { contrast, contrastProblem, themePresets } from '../dist/theme/theme.js';
import { adminClient, startApp } from './helpers.mjs';

let server;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate' } });
});

after(() => server?.close());

describe('contrast', () => {
  test('the WCAG ratio, and every ready-made theme is readable', () => {
    assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
    assert.equal(contrast('#ffffff', '#ffffff'), 1);
    for (const preset of themePresets) assert.equal(contrastProblem(preset.colors), null, preset.key);
    assert.equal(contrastProblem({ ...themePresets[0].colors, ink: '#cccccc' })?.param, 'ink');
    assert.equal(contrastProblem({ ...themePresets[0].colors, primary: '#ffeb3b' })?.param, 'primary');
    assert.equal(contrastProblem({ ...themePresets[0].colors, accent: '#fdf2f8' })?.param, 'accent');
  });
});

describe('the theme', () => {
  test('the default until one is published; a draft, its preview, then publishing it', async () => {
    const current = await (await fetch(`${server.base}/v1/theme`)).json();
    assert.deepEqual([current.preset, current.colors, current.version], ['navy_pink', themePresets[0].colors, 0]);

    const admin = await adminClient(server, ['operations']);
    const unreadable = await admin.put('/v1/admin/theme/draft', { colors: { primary: '#ffeb3b', accent: '#be185d', ink: '#111111', page: '#ffffff' } });
    assert.deepEqual([unreadable.status, unreadable.json.error.code, unreadable.json.error.param], [400, 'theme_contrast', 'colors.primary']);
    assert.equal((await admin.put('/v1/admin/theme/draft', { preset: 'forest', colors: themePresets[0].colors })).status, 400, 'a preset or colours, never both');
    assert.equal((await admin.put('/v1/admin/theme/draft', { colors: { primary: '#14532d' } })).json.error.param, 'colors.accent');

    const own = { primary: '#1E3A8A', accent: '#B45309', ink: '#111827', page: '#FFFFFF' };
    const saved = await admin.put('/v1/admin/theme/draft', { colors: own });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.draft, { preset: null, colors: { primary: '#1e3a8a', accent: '#b45309', ink: '#111827', page: '#ffffff' } });
    assert.equal((await (await fetch(`${server.base}/v1/theme`)).json()).preset, 'navy_pink', 'a draft is not live');

    const { token } = (await admin.post('/v1/admin/theme/preview')).json;
    const preview = await (await fetch(`${server.base}/v1/theme?preview=${encodeURIComponent(token)}`)).json();
    assert.deepEqual([preview.preview, preview.colors.primary], [true, '#1e3a8a']);
    assert.equal((await fetch(`${server.base}/v1/theme?preview=${encodeURIComponent(`${Date.now() + 60_000}.forged`)}`)).status, 401);

    const published = await admin.post('/v1/admin/theme/publish');
    assert.equal(published.status, 200, JSON.stringify(published.json));
    const live = await (await fetch(`${server.base}/v1/theme`)).json();
    assert.deepEqual([live.preset, live.colors.primary, live.version], [null, '#1e3a8a', 1]);

    assert.equal((await admin.put('/v1/admin/theme/draft', { preset: 'sunset' })).json.draft.preset, 'sunset');
    assert.equal((await admin.post('/v1/admin/theme/publish')).json.version, 2);
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const audits = await server.app.get(PrismaService).auditLog.findMany({ where: { targetType: 'theme' }, select: { action: true } });
    assert.deepEqual(audits.map(row => row.action).sort(), ['theme.draft_saved', 'theme.draft_saved', 'theme.published', 'theme.published']);
  });

  test('only operations change it; support reads and previews', async () => {
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/theme')).status, 200);
    assert.equal((await support.post('/v1/admin/theme/preview')).status, 200);
    assert.equal((await support.put('/v1/admin/theme/draft', { preset: 'ocean' })).status, 403);
  });
});
