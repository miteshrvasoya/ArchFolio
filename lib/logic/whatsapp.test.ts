import { describe, expect, it } from 'vitest';
import { parseWhatsApp } from './whatsapp';

describe('WhatsApp chat paste', () => {
  it('reads iOS and Android export lines, continuation lines and media placeholders', () => {
    const text = [
      '[18/11/26, 10:45:12 AM] Priya: Can we add a terrace garden?',
      '[18/11/26, 10:47:03 AM] Ayush: Yes — it adds about 2 weeks',
      'and ₹50,000 to the fee.',
      '18/11/2026, 6:05 pm - Priya: <Media omitted>',
      '18/11/2026, 6:06 pm - Priya: Okay, go ahead'
    ].join('\n');
    const d = parseWhatsApp(text);
    expect(d.participants).toEqual(['Priya', 'Ayush']);
    expect(d.firstAt).toBe('2026-11-18T10:45:00+05:30');
    expect(d.messages).toHaveLength(3);
    expect(d.messages[1]!.text).toContain('and ₹50,000');
    expect(d.messages[2]!.at).toBe('2026-11-18T18:06:00+05:30');
    expect(d.summary.split('\n')[0]).toBe('Priya: Can we add a terrace garden?');
  });
  it('keeps plain pasted text as the summary', () => {
    expect(parseWhatsApp('Called the client, agreed new date').summary).toBe('Called the client, agreed new date');
  });
});
