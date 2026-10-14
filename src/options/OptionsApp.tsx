import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { strToU8, zipSync } from 'fflate';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  ArchiveRestore,
  Database,
  DatabaseBackup,
  Download,
  FileUp,
  Globe,
  Keyboard,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';
import { db } from '@/lib/db';
import { formatBytes } from '@/lib/image';
import { CaptionError, generateCaption, listModels, originPattern, parseExtraBody, testImage } from '@/lib/captioner';
import {
  BUILTIN_STYLES,
  DEFAULT_BACKEND,
  getBackend,
  getStyles,
  onSettingsChanged,
  PRESETS,
  saveBackend,
  saveStyles,
  type BackendPreset,
  type BackendSettings,
  type CaptionStyle,
} from '@/lib/settings';
import { expandStyleFiles, isStyleFile, readStyleFile, STYLE_FILE_ACCEPT, styleFileName, styleToMarkdown } from '@/lib/styleFile';
import { createBackup, lastBackupAt, markBackedUp, openBackup, restoreBackup, type RestoreSummary } from '@/lib/backup';
import { downloadBlob } from '@/lib/export';
import { useAddShortcut, useSiteAccess } from '@/hooks/useSettings';
import { canOpenShortcutSettings, openShortcutSettings } from '@/lib/platform';
import { Keys } from '@/components/Keys';
import { Footer } from '@/components/Footer';
import { BusyModal, useConfirm } from '@/components/Modal';
import { toast, toastError, Toasts } from '@/components/Toasts';

export function OptionsApp() {
  useEffect(() => {
    // A file dropped outside a drop zone would otherwise replace this page with the file.
    const block = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  return (
    <main className="settings">
      <header className="settings-head">
        <img src="/logo.png" alt="" />
        <div>
          <h1>LatentNest Settings</h1>
          <p>Captioning server, caption styles, keyboard shortcut, permissions and backups.</p>
        </div>
      </header>
      <BackendSection />
      <StylesSection />
      <ShortcutSection />
      <AccessSection />
      <StorageSection />
      <Footer />
      <Toasts />
    </main>
  );
}

// ------------------------------------------------------------- backend

type Step = { label: string; status: 'pending' | 'ok' | 'bad'; detail?: string };

/** Ask for access to the server's host. Must be the first await in a click handler. */
async function ensureServerAccess(baseUrl: string) {
  const pattern = originPattern(baseUrl);
  if (!pattern) throw new CaptionError('That server URL isn’t valid.');
  // Resolves immediately, without a prompt, for hosts we already have (e.g. localhost).
  const granted = await browser.permissions.request({ origins: [pattern] });
  if (!granted) throw new CaptionError(`LatentNest needs permission to contact ${new URL(baseUrl).host}.`);
}

function BackendSection() {
  const [backend, setBackend] = useState<BackendSettings>();
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [steps, setSteps] = useState<Step[]>();
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Bumped by "Reset advanced settings" so fields holding unsaved text start over. */
  const [resets, setResets] = useState(0);
  const dirty = useRef(false);

  useEffect(() => void getBackend().then(setBackend), []);

  useEffect(() => {
    if (!backend || !dirty.current) return;
    setSaved(false);
    const t = setTimeout(() => void saveBackend(backend).then(() => setSaved(true)), 400);
    return () => clearTimeout(t);
  }, [backend]);

  if (!backend) return null;

  const update = (patch: Partial<BackendSettings>) => {
    dirty.current = true;
    setBackend({ ...backend, ...patch });
  };

  function choosePreset(preset: BackendPreset) {
    const knownDefault = Object.values(PRESETS).some((p) => p.baseUrl === backend!.baseUrl);
    update({
      preset,
      baseUrl: knownDefault || !backend!.baseUrl ? PRESETS[preset].baseUrl : backend!.baseUrl,
      model: preset === backend!.preset ? backend!.model : '',
    });
    setModels([]);
    setSteps(undefined);
  }

  async function loadModels() {
    setLoadingModels(true);
    try {
      await ensureServerAccess(backend!.baseUrl);
      const list = await listModels(backend!);
      setModels(list);
      if (!backend!.model && list.length === 1) update({ model: list[0] });
      if (!list.length) setSteps([{ label: 'The server reports no models.', status: 'bad' }]);
    } catch (err) {
      setSteps([{ label: 'Couldn’t load models', status: 'bad', detail: (err as Error).message }]);
    } finally {
      setLoadingModels(false);
    }
  }

  async function runTest() {
    const b = backend!;
    setTesting(true);
    const result: Step[] = [];
    const show = () => setSteps([...result]);
    try {
      await ensureServerAccess(b.baseUrl);
      result.push({ label: 'Connecting…', status: 'pending' });
      show();
      try {
        const list = await listModels(b);
        setModels(list);
        result[0] = { label: `Connected · ${list.length} model${list.length === 1 ? '' : 's'} available`, status: 'ok' };
        if (b.model && list.length && !list.includes(b.model)) {
          result.push({ label: `“${b.model}” isn’t in the server’s model list`, status: 'bad', detail: 'Pick one from the list or check the spelling.' });
        }
      } catch (err) {
        // llama.cpp builds without /v1/models still caption fine; only stop on connection errors.
        if (err instanceof CaptionError && err.fatal && !/not found/i.test(err.message)) throw err;
        result[0] = { label: 'Connected (model list unavailable)', status: 'ok' };
      }
      result.push({ label: 'Captioning a test image…', status: 'pending' });
      show();
      const caption = await generateCaption(await testImage(), { prompt: 'Describe this image in one short sentence.' }, b);
      result[result.length - 1] = { label: 'Vision works. The model said:', status: 'ok', detail: caption };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const last = result.at(-1);
      if (last?.status === 'pending') result[result.length - 1] = { ...last, status: 'bad', detail: msg };
      else result.push({ label: 'Test failed', status: 'bad', detail: msg });
    } finally {
      show();
      setTesting(false);
    }
  }

  const preset = PRESETS[backend.preset];
  const needsModel = backend.preset !== 'llamacpp';

  return (
    <section className="panel">
      <h2>
        <Server size={18} /> Captioning server
      </h2>
      <p className="panel-intro">
        Auto-captions come from a vision model running on your machine. Nothing is sent anywhere else.
      </p>

      <div className="form-grid">
        <div className="field span-2">
          <span className="field-label">Server</span>
          <div className="preset-row" role="group" aria-label="Server type">
            {(Object.keys(PRESETS) as BackendPreset[]).map((key) => (
              <button key={key} type="button" aria-pressed={backend.preset === key} onClick={() => choosePreset(key)}>
                {PRESETS[key].label}
              </button>
            ))}
          </div>
          <span className="field-hint">{preset.help}</span>
        </div>

        <label className="field">
          <span className="field-label">Server URL</span>
          <input
            className="input"
            value={backend.baseUrl}
            placeholder={preset.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            spellCheck={false}
          />
        </label>

        <div className="field">
          <label className="field-label" htmlFor="model">
            Model {needsModel ? '' : '(optional)'}
          </label>
          <div className="input-row">
            {models.length > 0 ? (
              <select id="model" className="select" value={backend.model} onChange={(e) => update({ model: e.target.value })}>
                <option value="">Choose a model…</option>
                {!models.includes(backend.model) && backend.model && <option value={backend.model}>{backend.model}</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="model"
                className="input"
                value={backend.model}
                placeholder={needsModel ? 'e.g. qwen2.5vl:7b' : 'uses the loaded model'}
                onChange={(e) => update({ model: e.target.value })}
                spellCheck={false}
              />
            )}
            <button className="btn" type="button" onClick={() => void loadModels()} disabled={loadingModels} title="Load models from the server">
              <RefreshCw size={15} className={loadingModels ? 'spin' : undefined} />
            </button>
          </div>
        </div>

        {backend.preset === 'custom' && (
          <label className="field span-2">
            <span className="field-label">API key (optional)</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={backend.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </label>
        )}
      </div>

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="form-grid form-grid-4">
          <NumberField label="Max image size (px)" value={backend.maxImageSide} min={256} max={4096} step={64} onChange={(v) => update({ maxImageSide: v })} />
          <NumberField label="Temperature" value={backend.temperature} min={0} max={2} step={0.1} onChange={(v) => update({ temperature: v })} />
          <NumberField
            label="Max tokens"
            value={backend.maxTokens}
            min={16}
            max={16384}
            step={16}
            empty="Server decides"
            title="Leave empty to use the server's own limit."
            onClear={() => update({ maxTokens: null })}
            onChange={(v) => update({ maxTokens: v })}
          />
          <NumberField label="Timeout (s)" value={backend.timeoutSec} min={10} max={900} step={10} onChange={(v) => update({ timeoutSec: v })} />
          <ExtraFieldsField key={resets} value={backend.extraBody} onChange={(extraBody) => update({ extraBody })} />
        </div>
        <button
          className="btn btn-sm btn-ghost"
          style={{ marginTop: 10 }}
          type="button"
          onClick={() => {
            update({ ...DEFAULT_BACKEND, preset: backend.preset, baseUrl: backend.baseUrl, model: backend.model, apiKey: backend.apiKey });
            setResets((n) => n + 1);
          }}
        >
          Reset advanced settings
        </button>
      </details>

      <div className="test-row">
        <button className="btn btn-primary" type="button" onClick={() => void runTest()} disabled={testing}>
          {testing && <LoaderCircle size={15} className="spin" />}
          Test connection
        </button>
        <span className="saved-note" aria-live="polite">
          {saved ? 'Saved' : ''}
        </span>
      </div>

      {steps && (
        <ul className="result-list">
          {steps.map((s, i) => (
            <li key={i}>
              {s.status === 'ok' ? (
                <CircleCheck size={16} className="ok" />
              ) : s.status === 'bad' ? (
                <CircleAlert size={16} className="bad" />
              ) : (
                <LoaderCircle size={16} className="pending spin" />
              )}
              <div>
                {s.label}
                {s.detail && (
                  <div>{s.status === 'ok' ? <q>{s.detail}</q> : <code>{s.detail}</code>}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  empty,
  onClear,
  ...rest
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  title?: string;
  /** Placeholder while the field is empty. */
  empty?: string;
  /** Lets the field be left empty. */
  onClear?: () => void;
  onChange: (v: number) => void;
}) {
  // What's typed, kept until it's in range (typing 2048 passes through 2); clamped on leaving the field.
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(rest.max, Math.max(rest.min, v));
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="number"
        value={draft ?? value ?? ''}
        placeholder={empty}
        {...rest}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          setDraft(e.target.value);
          if (e.target.value === '' && !e.target.validity.badInput) onClear?.();
          else if (Number.isFinite(v) && v === clamp(v)) onChange(v);
        }}
        onBlur={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v) && v !== clamp(v)) onChange(clamp(v));
          setDraft(null);
        }}
      />
    </label>
  );
}

/** JSON added to every caption request. Saved only while it's valid. */
function ExtraFieldsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // What's typed while it isn't valid yet; null once it's saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <label className="field span-2">
      <span className="field-label">Extra request fields (JSON)</span>
      <textarea
        className="textarea mono"
        rows={2}
        spellCheck={false}
        value={draft ?? value}
        placeholder='{"chat_template_kwargs": {"enable_thinking": false}}'
        aria-invalid={!!error}
        onChange={(e) => {
          const text = e.target.value;
          try {
            parseExtraBody(text);
            setDraft(null);
            setError('');
            onChange(text);
          } catch (err) {
            setDraft(text);
            setError((err as Error).message);
          }
        }}
      />
      {error ? (
        <span className="field-error">
          {error}
          {error.endsWith('.') ? ' ' : '. '}Not saved until it's fixed.
        </span>
      ) : (
        <span className="field-hint">
          Added to every caption request. For llama.cpp, chat template options go under <code>chat_template_kwargs</code>, e.g. a thinking model's
          reasoning effort.
        </span>
      )}
    </label>
  );
}

// -------------------------------------------------------------- styles

/** "Booru tags" → "Booru tags (2)" while the name is taken. */
function uniqueName(name: string, taken: Set<string>) {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name.slice(0, 54)} (${n})`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function StylesSection() {
  const [styles, setStyles] = useState<CaptionStyle[]>();
  const [editing, setEditing] = useState<{ id: string | null; name: string; prompt: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const loadInput = useRef<HTMLInputElement>(null);
  const [confirm, confirmEl] = useConfirm();

  useEffect(() => {
    const load = () => void getStyles().then(setStyles);
    load();
    return onSettingsChanged(load);
  }, []);

  if (!styles) return null;

  const commit = async (next: CaptionStyle[]) => {
    setStyles(next);
    await saveStyles(next);
  };

  async function saveEdit() {
    if (!editing || !editing.name.trim() || !editing.prompt.trim()) return;
    const entry = { name: editing.name.trim(), prompt: editing.prompt.trim() };
    if (editing.id) {
      await commit(styles!.map((s) => (s.id === editing.id ? { ...s, ...entry } : s)));
    } else {
      await commit([...styles!, { id: crypto.randomUUID(), ...entry }]);
    }
    setEditing(null);
  }

  /** Each .txt / .md file (including those in a .zip) becomes a new style at the end of the list. */
  async function importFiles(chosen: File[]) {
    const { files, failed } = await expandStyleFiles(chosen);
    const results = await Promise.allSettled(files.map(readStyleFile));
    const taken = new Set(styles!.map((s) => s.name.toLowerCase()));
    const prompts = new Set(styles!.map((s) => s.prompt));
    const added: CaptionStyle[] = [];
    let duplicates = 0;
    for (const r of results) {
      if (r.status === 'rejected') {
        failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      } else if (prompts.has(r.value.prompt)) {
        duplicates++;
      } else {
        prompts.add(r.value.prompt);
        added.push({ id: crypto.randomUUID(), name: uniqueName(r.value.name, taken), prompt: r.value.prompt });
      }
    }
    if (added.length) {
      await commit([...styles!, ...added]);
      const ids = new Set(added.map((s) => s.id));
      toast(added.length === 1 ? `Added “${added[0]!.name}”` : `Added ${added.length} styles`, {
        action: {
          label: 'Undo',
          run: () => void getStyles().then((now) => saveStyles(now.filter((s) => !ids.has(s.id)))),
        },
      });
    }
    if (duplicates) {
      toast(duplicates === 1 ? 'That style is already in the list.' : `${duplicates} styles are already in the list.`);
    }
    if (failed.length) {
      toast(failed.length === 1 ? failed[0]! : `${failed[0]} (and ${failed.length - 1} more)`, { kind: 'error' });
    }
  }

  /** Replaces the open editor's instructions with a file; fills the name if it's blank. */
  async function loadIntoEditor(files: File[]) {
    const file = files.find((f) => isStyleFile(f.name)) ?? files[0];
    if (!file) return;
    try {
      const loaded = await readStyleFile(file);
      setEditing((e) => e && { ...e, prompt: loaded.prompt, name: e.name.trim() ? e.name : loaded.name });
    } catch (err) {
      toastError(err);
    }
  }

  /** One style as a .md file, or every style as a .zip of them; both import back. */
  function exportStyles(list: CaptionStyle[]) {
    const taken = new Set<string>();
    const files = list.map((style) => [styleFileName(style.name, taken), styleToMarkdown(style)] as const);
    if (files.length === 1) {
      const [name, text] = files[0]!;
      return downloadBlob(new Blob([text], { type: 'text/markdown' }), name);
    }
    const zip = zipSync(Object.fromEntries(files.map(([name, text]) => [name, strToU8(text)])));
    downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), 'latentnest-caption-styles.zip');
    toast(`Exported ${files.length} styles`);
  }

  async function remove(style: CaptionStyle) {
    const ok = await confirm({
      title: `Delete “${style.name}”?`,
      body: 'Datasets using this style will fall back to the first style in the list.',
      confirmLabel: 'Delete style',
      danger: true,
    });
    if (ok) await commit(styles!.filter((s) => s.id !== style.id));
  }

  const missingBuiltins = BUILTIN_STYLES.filter((b) => !styles.some((s) => s.id === b.id));

  const editor = editing && (
    <div className="style-edit">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          autoFocus
          value={editing.name}
          maxLength={60}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        />
      </label>
      <div className="field">
        <div className="field-label-row">
          <label className="field-label" htmlFor="style-prompt">
            Instructions sent to the model with each image
          </label>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => loadInput.current?.click()}>
            <FileUp size={14} /> Load from file…
          </button>
        </div>
        <textarea
          id="style-prompt"
          className="textarea"
          value={editing.prompt}
          onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
        />
        <span className="field-hint">
          Type the instructions, or load or drop a .txt or .md file. Tip: end with “Output only the caption” so the
          model doesn’t add commentary. The dataset’s trigger word is added automatically.
        </span>
      </div>
      <div className="row-end">
        <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!editing.name.trim() || !editing.prompt.trim()}
          onClick={() => void saveEdit()}
        >
          Save style
        </button>
      </div>
    </div>
  );

  return (
    <section
      className="panel drop-panel"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...e.dataTransfer.files];
        void (editing ? loadIntoEditor(files) : importFiles(files));
      }}
    >
      {dragging && (
        <div className="drop-overlay">{editing ? 'Drop to load the instructions' : 'Drop .txt, .md or .zip files to add styles'}</div>
      )}
      <h2>
        <MessageSquareText size={18} /> Caption styles
      </h2>
      <p className="panel-intro">
        Each dataset picks a style from this list in the side panel. The first style is the default for new datasets.
        Export saves styles as .md files, which Import reads back.
      </p>

      <div className="style-list">
        {styles.map((style) => (
          <div className="style-item" key={style.id}>
            {editing?.id === style.id ? (
              editor
            ) : (
              <>
                <div className="style-item-head">
                  <strong>{style.name}</strong>
                  <button
                    className="icon-btn"
                    title="Edit"
                    aria-label={`Edit ${style.name}`}
                    onClick={() => setEditing({ id: style.id, name: style.name, prompt: style.prompt })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Export as a .md file"
                    aria-label={`Export ${style.name}`}
                    onClick={() => exportStyles([style])}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Duplicate"
                    aria-label={`Duplicate ${style.name}`}
                    onClick={() => setEditing({ id: null, name: `${style.name} (copy)`, prompt: style.prompt })}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete"
                    aria-label={`Delete ${style.name}`}
                    disabled={styles.length <= 1}
                    onClick={() => void remove(style)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <p>{style.prompt}</p>
              </>
            )}
          </div>
        ))}
        {editing && !editing.id && <div className="style-item">{editor}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="button" disabled={!!editing} onClick={() => setEditing({ id: null, name: '', prompt: '' })}>
          <Plus size={15} /> Add style
        </button>
        <button className="btn" type="button" disabled={!!editing} onClick={() => importInput.current?.click()}>
          <FileUp size={15} /> Import .txt / .md…
        </button>
        <button className="btn" type="button" disabled={!!editing} onClick={() => exportStyles(styles)}>
          <Download size={15} /> Export all
        </button>
        {missingBuiltins.length > 0 && (
          <button className="btn btn-ghost" type="button" onClick={() => void commit([...styles, ...missingBuiltins])}>
            Restore {missingBuiltins.length} built-in style{missingBuiltins.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
      <input
        ref={importInput}
        type="file"
        multiple
        hidden
        accept={STYLE_FILE_ACCEPT}
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <input
        ref={loadInput}
        type="file"
        hidden
        accept={STYLE_FILE_ACCEPT}
        onChange={(e) => {
          void loadIntoEditor([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {confirmEl}
    </section>
  );
}

// ------------------------------------------------------------ shortcut

function ShortcutSection() {
  const keys = useAddShortcut();
  const canChange = canOpenShortcutSettings();
  return (
    <section className="panel">
      <h2>
        <Keyboard size={18} /> Keyboard shortcut
      </h2>
      <p className="panel-intro">
        For sites with their own right-click menu, like TikTok and YouTube. Point at a picture or video and press the
        shortcut to add it to the dataset you used most recently; a video gives its current frame.
      </p>
      <div className="status-line shortcut-line">
        <span className="shortcut-label">Add what’s under the pointer</span>
        {keys ? <Keys value={keys} /> : keys === '' && <span className="keys-unset">Not set</span>}
        {canChange && (
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => void openShortcutSettings().catch(toastError)}>
            {keys === '' ? 'Set shortcut' : 'Change'}
          </button>
        )}
      </div>
      {!canChange && (
        <p className="field-hint" style={{ marginTop: 12 }}>
          To change it: Add-ons and themes → ⚙ → Manage Extension Shortcuts.
        </p>
      )}
    </section>
  );
}

// -------------------------------------------------------------- access

function AccessSection() {
  const { granted, request } = useSiteAccess();
  return (
    <section className="panel">
      <h2>
        <Globe size={18} /> Website access
      </h2>
      <p className="panel-intro">
        Used only for the images you choose with “Add to Dataset” or the shortcut: to download them, and to find ones a
        site covers with an overlay. Without it, images from most sites can’t be saved.
      </p>
      <div className="status-line">
        <span className={`status-dot ${granted ? 'on' : 'off'}`} />
        <span style={{ flex: 1 }}>{granted ? 'Allowed on all sites' : 'Not allowed'}</span>
        {granted ? (
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => void browser.permissions.remove({ origins: ['<all_urls>'] })}
          >
            Revoke
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" type="button" onClick={() => void request()}>
            Allow access
          </button>
        )}
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>
        To save images from local files (file://), also turn on “Allow access to file URLs” for LatentNest on your
        browser’s extensions page.
      </p>
    </section>
  );
}

// ------------------------------------------------------------- storage

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeRestore(s: RestoreSummary): string {
  const parts = [`Restored ${plural(s.datasetsAdded, 'dataset')} and ${plural(s.imagesAdded, 'image')}`];
  if (s.alreadyHere) parts.push(`${s.alreadyHere} already here`);
  if (s.captionsFilled) parts.push(`${plural(s.captionsFilled, 'caption')} filled in`);
  if (s.stylesAdded) parts.push(`${plural(s.stylesAdded, 'caption style')} added`);
  if (s.serverRestored) parts.push('server settings restored');
  return parts.join(' · ');
}

function StorageSection() {
  const [info, setInfo] = useState<{ datasets: number; images: number; usage?: number; quota?: number }>();
  const [last, setLast] = useState<number>();
  const [busy, setBusy] = useState<{ title: string; done: number; total: number } | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const restoreInput = useRef<HTMLInputElement>(null);

  const load = () =>
    void Promise.all([db.datasets.count(), db.images.count(), navigator.storage?.estimate?.()]).then(
      ([datasets, images, estimate]) => setInfo({ datasets, images, usage: estimate?.usage, quota: estimate?.quota }),
    );
  useEffect(() => {
    load();
    void lastBackupAt().then(setLast);
  }, []);
  if (!info) return null;

  async function backup() {
    const title = 'Preparing backup…';
    setBusy({ title, done: 0, total: 0 });
    try {
      const result = await createBackup((done, total) => setBusy({ title, done, total }));
      if (!result.datasets) return toast('There’s nothing to back up yet.');
      downloadBlob(result.blob, result.filename);
      await markBackedUp();
      setLast(Date.now());
      toast(`Saved ${plural(result.datasets, 'dataset')} and ${plural(result.images, 'image')} to ${result.filename}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  }

  async function restore(file: File) {
    setBusy({ title: 'Reading backup…', done: 0, total: 0 });
    let backup;
    try {
      backup = await openBackup(file);
    } catch (err) {
      return toastError(err);
    } finally {
      setBusy(null);
    }
    const ok = await confirm({
      title: `Restore the backup from ${new Date(backup.createdAt).toLocaleDateString()}?`,
      body: `It has ${plural(backup.datasets, 'dataset')} and ${plural(backup.images, 'image')}. Anything missing here is added. Nothing you have now is changed or deleted, except blank captions, which are filled in from the backup.${
        backup.complete ? '' : ' This file is incomplete (maybe its download was interrupted), so images missing from it will be skipped.'
      }`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    const title = 'Restoring…';
    setBusy({ title, done: 0, total: backup.images });
    try {
      const summary = await restoreBackup(backup, (done, total) => setBusy({ title, done, total }));
      toast(describeRestore(summary), { kind: summary.imagesAdded || summary.datasetsAdded ? 'info' : 'error' });
      if (summary.failed.length) {
        console.warn('LatentNest: images not restored', summary.failed);
        const [first] = summary.failed;
        toast(`${plural(summary.failed.length, 'image')} couldn’t be restored. ${first}${summary.failed.length > 1 ? ' (and others)' : ''}`, {
          kind: 'error',
        });
      }
      load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <h2>
        <Database size={18} /> Storage &amp; backup
      </h2>
      <p className="panel-intro">
        Images are stored inside the browser, in this profile only. Uninstalling LatentNest or clearing browser data
        deletes them, so back up now and then.
      </p>
      <div className="stat-row">
        <div>
          <b>{info.datasets}</b> datasets
        </div>
        <div>
          <b>{info.images}</b> images
        </div>
        {info.usage !== undefined && (
          <div>
            <b>{formatBytes(info.usage)}</b> used
          </div>
        )}
      </div>

      <div className="status-line" style={{ marginTop: 18 }}>
        <span className={`status-dot ${last ? 'on' : 'off'}`} />
        <span style={{ flex: 1 }}>
          {last ? `Last backup: ${new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Never backed up'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" onClick={() => void backup()} disabled={!info.datasets}>
          <DatabaseBackup size={15} /> Back up everything
        </button>
        <button className="btn" type="button" onClick={() => restoreInput.current?.click()}>
          <ArchiveRestore size={15} /> Restore from backup…
        </button>
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>
        One .tar file with every dataset, image, caption, crop and caption style, plus your server settings except the
        API key. Each dataset inside is also a plain folder of images and .txt captions. Restoring only adds what’s
        missing, so it’s safe to run on a browser that already has data.
      </p>
      <input
        ref={restoreInput}
        type="file"
        hidden
        accept=".tar,application/x-tar"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void restore(file);
        }}
      />
      <BusyModal busy={busy} />
      {confirmEl}
    </section>
  );
}
