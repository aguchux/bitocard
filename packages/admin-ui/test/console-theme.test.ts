// A product's colour theme on the shared console (Udozo's Seller HQ and admin): every navy, brand and pink shade the
// console's components use is re-pointed, so none stays BitoCard's; Udozo's logo colours are its default.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { consoleThemeCss, consoleThemeVariables, udozoConsoleColors } from '../src/theme-vars';

const shade = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|accent|caret|divide|placeholder)-((?:navy|brand|pink)-\d+)\b/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('console theme', () => {
  test("Udozo's colours come from its logo", () => {
    expect(udozoConsoleColors).toEqual({ primary: '#185174', accent: '#0e7cc0', ink: '#10212e' });
    const vars = consoleThemeVariables(udozoConsoleColors);
    expect(vars['--color-navy-900']).toBe('#185174');
    expect(vars['--color-brand-500']).toBe('#0e7cc0');
    expect(vars['--color-navy-200']).toBe('color-mix(in srgb, #185174 12%, white)');
    expect(consoleThemeCss(udozoConsoleColors)).toMatch(/^html:root\{--color-ink:#10212e;.*--color-navy-900:#185174;/);
  });

  test('every shade the shared components use is themed, so none stays navy or pink', () => {
    const used = new Set<string>();
    for (const file of sources(join(__dirname, '..', 'src'))) for (const match of readFileSync(file, 'utf8').matchAll(shade)) used.add(match[1]);
    expect(used.size).toBeGreaterThan(10);
    const vars = consoleThemeVariables(udozoConsoleColors);
    expect([...used].filter(name => !vars[`--color-${name}`])).toEqual([]);
  });

  test('a colour that is not #rrggbb changes nothing', () => {
    expect(consoleThemeVariables({ ...udozoConsoleColors, accent: 'red' })).toEqual({});
  });
});
