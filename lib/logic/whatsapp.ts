/**
 * Turn a pasted WhatsApp chat export into a discussion draft. Handles both
 * export styles:
 *   [18/11/26, 10:45:12 AM] Priya: message      (iOS)
 *   18/11/2026, 10:45 am - Priya: message        (Android)
 * Lines without a header continue the previous message.
 */
export interface ChatMessage { at: string | null; author: string; text: string }
export interface ChatDraft { messages: ChatMessage[]; participants: string[]; firstAt: string | null; summary: string }

const LINE = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:-|–)?\s*([^:]{1,60}):\s?(.*)$/i;

export function parseWhatsApp(text: string): ChatDraft {
  const messages: ChatMessage[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/[‎‏‪-‮]/g, '').trimEnd();
    if (!line.trim()) continue;
    const m = LINE.exec(line);
    if (m) {
      const [, d, mo, y, h, mi, , ampm, author, body] = m;
      let hour = Number(h);
      if (ampm) { const pm = /p/i.test(ampm); if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; }
      const year = (y ?? '').length === 2 ? `20${y}` : y;
      const at = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${mi}:00+05:30`;
      messages.push({ at: Number.isNaN(Date.parse(at)) ? null : at, author: (author ?? '').trim(), text: (body ?? '').trim() });
    } else if (messages.length) {
      const last = messages[messages.length - 1]!;
      last.text = `${last.text}\n${line.trim()}`;
    } else {
      messages.push({ at: null, author: '', text: line.trim() });
    }
  }
  const visible = messages.filter((m) => m.text && !/^<media omitted>$|^image omitted$|^this message was deleted$/i.test(m.text));
  const participants = [...new Set(visible.map((m) => m.author).filter(Boolean))];
  const summary = visible.map((m) => (m.author ? `${m.author}: ${m.text}` : m.text)).join('\n').slice(0, 7900);
  return { messages: visible, participants, firstAt: visible.find((m) => m.at)?.at ?? null, summary };
}
