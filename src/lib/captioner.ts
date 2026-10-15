// One client for every backend: Ollama, llama.cpp, LM Studio and friends all
// expose the OpenAI-compatible /v1 API with image_url content parts.
import { browser } from 'wxt/browser';
import type { BackendSettings, CaptionStyle } from './settings';
import type { Crop } from './db';
import { toModelDataUrl } from './image';

export class CaptionError extends Error {
  constructor(
    message: string,
    /** Connection-level failures abort a batch; per-image ones don't. */
    readonly fatal = false,
  ) {
    super(message);
  }
}

export function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
}

/** Host-permission pattern covering the backend, e.g. "http://192.168.1.5/*". */
export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export async function hasBackendPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPattern(baseUrl);
  return !!pattern && browser.permissions.contains({ origins: [pattern] });
}

async function request(backend: BackendSettings, path: string, init: RequestInit, signal?: AbortSignal) {
  const url = apiUrl(backend.baseUrl, path);
  const timeout = AbortSignal.timeout(backend.timeoutSec * 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (backend.apiKey) headers.Authorization = `Bearer ${backend.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.aborted) throw new CaptionError(`The server didn't answer within ${backend.timeoutSec}s.`);
    throw new CaptionError(`Couldn't reach ${backend.baseUrl}. Is the server running?`, true);
  }
  if (!res.ok) throw await httpError(res, backend);
  return res.json();
}

async function httpError(res: Response, backend: BackendSettings): Promise<CaptionError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
  } catch {
    /* non-JSON body */
  }
  if (res.status === 403 && backend.preset === 'ollama') {
    return new CaptionError(
      'Ollama rejected the request (403). Allow extension origins by setting OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" and restarting Ollama.',
      true,
    );
  }
  if (res.status === 401) return new CaptionError('The server needs an API key (401).', true);
  if (res.status === 404 && !detail) return new CaptionError(`Not found at ${res.url}. Check the server URL.`, true);
  return new CaptionError(detail || `Server error ${res.status}.`, res.status === 404);
}

export async function listModels(backend: BackendSettings): Promise<string[]> {
  const body = await request(backend, '/models', { method: 'GET' });
  const ids: string[] = (body.data ?? body.models ?? []).map((m: { id?: string; name?: string }) => m.id ?? m.name);
  return ids.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function cleanCaption(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Templates that open the <think> block themselves leave only its end.
    .replace(/^[\s\S]*<\/think>/i, '')
    .replace(/^\s*(caption|description|tags)\s*:\s*/i, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .replace(/^["“'](.*)["”']$/s, '$1')
    .trim();
}

export function applyTrigger(caption: string, trigger: string | undefined): string {
  const t = trigger?.trim();
  if (!t || caption.toLowerCase().startsWith(t.toLowerCase())) return caption;
  return `${t}, ${caption}`;
}

/** The style's instructions, plus the image's hint when it has one. */
export function buildPrompt(stylePrompt: string, hint?: string): string {
  const note = hint?.trim();
  if (!note) return stylePrompt;
  return `${stylePrompt}\n\nNote from the dataset author about this image (use it where it applies, without mentioning the note): ${note}`;
}

/** Request fields the extension needs to set itself. */
const FIXED_FIELDS = ['messages', 'stream'];

/** The "Extra request fields" setting as an object. */
export function parseExtraBody(text: string | undefined): Record<string, unknown> {
  if (!text?.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new CaptionError(`Extra request fields aren't valid JSON: ${(err as Error).message}`, true);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CaptionError('Extra request fields must be a JSON object, like {"top_p": 0.9}.', true);
  }
  const fixed = FIXED_FIELDS.filter((k) => k in value);
  if (fixed.length) throw new CaptionError(`Extra request fields can't set ${fixed.join(' or ')}.`, true);
  return value as Record<string, unknown>;
}

export interface CaptionOptions {
  signal?: AbortSignal;
  /** Caption only this region of the image. */
  crop?: Crop;
  hint?: string;
}

export async function generateCaption(
  image: Blob,
  style: Pick<CaptionStyle, 'prompt'>,
  backend: BackendSettings,
  { signal, crop, hint }: CaptionOptions = {},
): Promise<string> {
  if (!backend.model.trim() && backend.preset !== 'llamacpp') {
    throw new CaptionError('Choose a captioning model in Settings first.', true);
  }
  const extra = parseExtraBody(backend.extraBody);
  const dataUrl = await toModelDataUrl(image, backend.maxImageSide, crop);
  const body = await request(
    backend,
    '/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({
        model: backend.model.trim() || 'default',
        temperature: backend.temperature,
        // Left out when not set, so the server's own limit applies.
        max_tokens: backend.maxTokens ?? undefined,
        ...extra,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: buildPrompt(style.prompt, hint) },
            ],
          },
        ],
      }),
    },
    signal,
  );
  return readCaption(body, typeof extra.max_tokens === 'number' ? extra.max_tokens : backend.maxTokens);
}

interface ChatChoice {
  finish_reason?: string;
  message?: { content?: unknown; reasoning_content?: string; reasoning?: string };
}

/** The caption in a chat completion; a reply cut off at a token limit is refused. */
export function readCaption(body: { choices?: ChatChoice[] }, maxTokens: number | null): string {
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('') : '';
  if (choice?.finish_reason === 'length') {
    // Thinking models reason first, and the reasoning counts against the limit.
    const thought = !!(choice.message?.reasoning_content || choice.message?.reasoning) || /<\/?think>/i.test(text);
    // With no limit sent, the server's own output limit or context size stopped it.
    const limit = maxTokens ? `the ${maxTokens}-token limit` : "the server's token limit";
    const fix = maxTokens
      ? 'Raise Max tokens in Settings (under Advanced), or clear it to let the server decide.'
      : "Raise the server's output limit or context size.";
    throw new CaptionError(
      thought
        ? `The model ran out of tokens before finishing the caption: it thinks first, and the thinking counts toward ${limit}. ${fix}`
        : `The caption was cut off at ${limit}. ${fix}`,
      true,
    );
  }
  const caption = cleanCaption(text);
  if (!caption) throw new CaptionError('The model returned an empty caption. Is it a vision model?');
  return caption;
}

/** A tiny synthetic image to check the model can actually see. */
export async function testImage(): Promise<Blob> {
  const c = new OffscreenCanvas(256, 256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2b6cb0';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#f29f2e';
  ctx.beginPath();
  ctx.arc(128, 128, 72, 0, Math.PI * 2);
  ctx.fill();
  return c.convertToBlob({ type: 'image/png' });
}
