'use client';
// Resolves an images-store id into an object URL for rendering (custom covers).
import { useEffect, useState } from 'react';
import * as db from '@/lib/nanote/idb';

export function useImageURL(imageId: string | null | undefined): string | null {
  const currentId = imageId ?? null;
  const [entry, setEntry] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    let created: string | null = null;
    db.getImage(currentId)
      .then((img) => {
        if (img && !cancelled) {
          created = URL.createObjectURL(img.blob);
          setEntry({ id: currentId, url: created });
        }
      })
      .catch(() => {
        /* image missing — fall back to the built-in cover */
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [currentId]);

  return entry && entry.id === currentId ? entry.url : null;
}
