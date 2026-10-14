import { browser } from 'wxt/browser';

export type BackendPreset = 'ollama' | 'llamacpp' | 'lmstudio' | 'custom';

export interface BackendSettings {
  preset: BackendPreset;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Images are downscaled to this before upload; models resize anyway. */
  maxImageSide: number;
  temperature: number;
  /** null: send no limit, so the server's own applies. */
  maxTokens: number | null;
  timeoutSec: number;
  /** A JSON object added to each caption request, e.g. chat template options; empty for none. */
  extraBody: string;
}

export interface CaptionStyle {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

export const PRESETS: Record<BackendPreset, { label: string; baseUrl: string; help: string }> = {
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    help: 'Ollama blocks browser extensions by default: start it with OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*". Then pull a vision model, e.g. qwen2.5vl:7b or gemma3.',
  },
  llamacpp: {
    label: 'llama.cpp server',
    baseUrl: 'http://localhost:8080',
    help: 'Start llama-server with a vision model and its --mmproj file.',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    help: 'Load a vision model and start the local server from the Developer tab.',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: 'http://localhost:8000',
    help: 'Any server exposing /v1/chat/completions with image input (vLLM, KoboldCpp, …).',
  },
};

export const DEFAULT_BACKEND: BackendSettings = {
  preset: 'ollama',
  baseUrl: PRESETS.ollama.baseUrl,
  apiKey: '',
  model: '',
  maxImageSide: 1024,
  temperature: 0.2,
  maxTokens: null,
  timeoutSec: 120,
  extraBody: '',
};

export const BUILTIN_STYLES: CaptionStyle[] = [
  {
    id: 'detailed',
    name: 'Detailed description',
    builtin: true,
    prompt:
      'Describe this image for a text-to-image training dataset. Write one paragraph of plain prose covering the main subject, their appearance, clothing, pose and expression, the setting, lighting, composition, camera angle and visual style. Describe only what is visible. Do not mention that this is an image or photo, and do not use lists or line breaks. Output only the description.',
  },
  {
    id: 'short',
    name: 'Short caption',
    builtin: true,
    prompt:
      'Write a single concise sentence (under 30 words) describing the main subject and setting of this image, for a text-to-image training dataset. Output only the sentence.',
  },
  {
    id: 'booru',
    name: 'Booru tags',
    builtin: true,
    prompt:
      'List Danbooru-style tags describing this image for an image-generation training dataset. Order them from most to least important: subject count (e.g. 1girl, 1boy, no humans), physical features, clothing, pose, expression, objects, background, composition and art style. Use spaces instead of underscores. Output only lowercase tags separated by commas, with no other text.',
  },
  {
    id: 'character',
    name: 'Character LoRA',
    builtin: true,
    prompt:
      "This image shows a specific character whose identity will be learned from a trigger word. Describe the image in one paragraph: the character's clothing, accessories, pose, expression and action, plus the setting, lighting and composition. Do NOT describe the character's permanent physical traits (face, eye color, hair color and style, skin tone, body type). Output only the description.",
  },
  {
    id: 'style',
    name: 'Style LoRA',
    builtin: true,
    prompt:
      'Describe the content of this image in one paragraph for training a style LoRA: the subjects, objects, setting and composition. Do NOT describe the artistic style, medium, color palette, brushwork or rendering technique. Output only the description.',
  },
];

const KEYS = { backend: 'backend', styles: 'captionStyles' } as const;

/**
 * Saved with the settings. Before version 2 the page saved every field, so a
 * stored 400 Max tokens was the old default rather than a choice.
 */
const BACKEND_VERSION = 2;

/** Stored settings with the defaults filled in. */
export function readBackend(stored: unknown): BackendSettings {
  const saved = (stored ?? {}) as Partial<BackendSettings> & { v?: number };
  const backend = { ...DEFAULT_BACKEND, ...saved };
  if (!saved.v && saved.maxTokens === 400) backend.maxTokens = null;
  return backend;
}

export async function getBackend(): Promise<BackendSettings> {
  const { [KEYS.backend]: stored } = await browser.storage.local.get(KEYS.backend);
  return readBackend(stored);
}

export async function saveBackend(backend: BackendSettings) {
  await browser.storage.local.set({ [KEYS.backend]: { ...backend, v: BACKEND_VERSION } });
}

export async function getStyles(): Promise<CaptionStyle[]> {
  const { [KEYS.styles]: stored } = await browser.storage.local.get(KEYS.styles);
  return (stored as CaptionStyle[] | undefined) ?? BUILTIN_STYLES;
}

export async function saveStyles(styles: CaptionStyle[]) {
  await browser.storage.local.set({ [KEYS.styles]: styles });
}

export function onSettingsChanged(fn: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (KEYS.backend in changes || KEYS.styles in changes)) fn();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** The style a dataset should use, falling back to the first available. */
export function resolveStyle(styles: CaptionStyle[], id: string | undefined): CaptionStyle | undefined {
  return styles.find((s) => s.id === id) ?? styles[0];
}
