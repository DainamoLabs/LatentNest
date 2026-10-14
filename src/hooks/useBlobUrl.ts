import { useEffect, useRef, useState, type RefObject } from 'react';
import { db, type BlobRecord } from '@/lib/db';

/**
 * Object URL for a stored image blob. When `id` (or `version`) changes, the
 * previous URL stays in place until the next one is ready, so images swap
 * without flashing. `onLoad` sees each record as it's read.
 */
export function useBlobUrl(
  table: 'thumbs' | 'originals',
  id: string | undefined,
  enabled = true,
  version?: string,
  onLoad?: (record: BlobRecord) => void,
) {
  const [url, setUrl] = useState<string>();
  const current = useRef<string>(undefined);
  const loaded = useRef(onLoad);
  loaded.current = onLoad;

  useEffect(() => {
    if (!id || !enabled) return;
    let cancelled = false;
    void db[table].get(id).then((rec) => {
      if (cancelled) return;
      const prev = current.current;
      current.current = rec ? URL.createObjectURL(rec.blob) : undefined;
      setUrl(current.current);
      if (prev) setTimeout(() => URL.revokeObjectURL(prev), 1000);
      if (rec) loaded.current?.(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [table, id, enabled, version]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );
  return url;
}

/** Becomes true once the element nears the viewport, and stays true. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '300px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}
