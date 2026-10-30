import { describe, expect, it } from 'vitest';
import { menus, sections } from '../src/shell/nav';

describe('admin navigation', () => {
  it('gives every rail section its menu, with no address listed twice', () => {
    for (const section of sections) {
      const menu = menus[section.key];
      expect(menu, section.key).toBeDefined();
      expect(new Set(menu.items.map(item => item.href)).size).toBe(menu.items.length);
    }
    expect(Object.keys(menus).sort()).toEqual(sections.map(section => section.key).sort());
  });

  it('no longer links to BitoCard Shop, B2B reselling or the crypto pages, which left BitoCard', () => {
    const hrefs = [...sections.map(section => section.href), ...Object.values(menus).flatMap(menu => menu.items.map(item => item.href))];
    for (const gone of ['/classifieds', '/crypto', '/reports/resale', '/support/assistants/who-answers']) {
      expect(hrefs.filter(href => href === gone || href.startsWith(`${gone}/`)), gone).toEqual([]);
    }
    expect(Object.values(menus).map(menu => menu.title)).not.toContain('BitoCard Shop');
  });
});
