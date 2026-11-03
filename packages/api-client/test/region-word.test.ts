import { describe, expect, test } from 'vitest';
import { regionWord } from '../src/classifieds';

describe("what a market calls its divisions", () => {
  test("each market's own word, and state where none is set", () => {
    expect(['NG', 'GH', 'KE', 'RW', 'ci', 'BJ', 'UG', 'ZM'].map(regionWord)).toEqual(['state', 'region', 'county', 'province', 'district', 'department', 'region', 'province']);
    expect(regionWord('ZA')).toBe('state');
  });
});
