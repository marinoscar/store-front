/** Typed wrappers for the backend /api routes. Used by the React islands. */

export type SignFileInput = { filename: string; contentType: string; size: number };
export type SignFileOutput = { id: string; key: string; putUrl: string; getUrl: string };
export type SignResponse = { quoteId: string; files: SignFileOutput[] };

export async function signUploads(input: {
  quoteId?: string;
  files: SignFileInput[];
}): Promise<SignResponse> {
  const res = await fetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`sign failed (${res.status})`);
  return res.json() as Promise<SignResponse>;
}

export async function uploadToS3(
  putUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', putUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('upload network error'));
    xhr.send(file);
  });
}

export type AddressValidateResponse =
  | { found: false }
  | {
      found: true;
      address: string;
      lat: number;
      lng: number;
      confidence: number;
      inServiceArea: boolean;
    };

export async function validateAddress(query: string): Promise<AddressValidateResponse> {
  const res = await fetch('/api/validate-address', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`address (${res.status})`);
  return res.json() as Promise<AddressValidateResponse>;
}

export type QuoteCalcResponse = { low: number; high: number; currency: string };

export async function calcQuote(input: {
  serviceId: string;
  sqft?: number;
  units?: number;
}): Promise<QuoteCalcResponse> {
  const res = await fetch('/api/quote-calc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`calc (${res.status})`);
  return res.json() as Promise<QuoteCalcResponse>;
}

export type SubmitQuoteInput = {
  quoteId?: string;
  serviceId: string;
  contact: { name: string; email: string; phone: string };
  address: { formatted: string; lat?: number; lng?: number };
  notes?: string;
  estimate?: QuoteCalcResponse;
  photoKeys: string[];
  honeypot?: string;
};

export async function submitQuote(input: SubmitQuoteInput): Promise<{
  quoteId: string;
  pdfUrl: string;
}> {
  const res = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`quote (${res.status})`);
  return res.json() as Promise<{ quoteId: string; pdfUrl: string }>;
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export async function streamChat(
  messages: ChatMessage[],
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', message: `chat (${res.status})` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = 'message';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      eventName = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (eventName === 'delta' && typeof payload.text === 'string') {
          onEvent({ type: 'delta', text: payload.text });
        } else if (eventName === 'done') {
          onEvent({ type: 'done' });
        } else if (eventName === 'error') {
          onEvent({ type: 'error', message: String(payload.message ?? 'unknown') });
        }
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
