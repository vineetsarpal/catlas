export async function readBoundedStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MB supported limit.`); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
export async function readTextResponse(response: Response, limit = 64 * 1024 * 1024): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`Evidence request failed (${response.status}).`);
  return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedStream(response.body, limit));
}
