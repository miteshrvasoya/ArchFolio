/** Canonical JSON (sorted keys) and SHA-256, so the same content always hashes the same. */
export function canonicalJSON(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((o, k) => {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) o[k] = norm(x);
        return o;
      }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash identifying exactly what the client saw and accepted. */
export function contentHash(content: unknown): Promise<string> {
  return sha256Hex(canonicalJSON(content));
}
