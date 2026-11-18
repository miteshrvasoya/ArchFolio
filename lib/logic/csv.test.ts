import { describe, expect, it } from 'vitest';
import { toCSV } from './csv';

describe('CSV export', () => {
  it('quotes commas, quotes and newlines, and neutralises formulas', () => {
    expect(toCSV([['a', 'b,c', 'say "hi"'], [1, null, '=SUM(A1)'], ['line\nbreak', -5, '-5']])).toBe('a,"b,c","say ""hi"""\r\n1,,\'=SUM(A1)\r\n"line\nbreak",-5,\'-5');
  });
});
