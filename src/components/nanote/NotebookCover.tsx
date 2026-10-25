'use client';
// Notebook cover renderer — 12 built-in styles + custom image covers.
import { useMemo } from 'react';
import { getCover } from '@/lib/nanote/covers';
import { cn } from '@/lib/utils';

export function NotebookCover({
  coverId,
  customUrl,
  title,
  className,
  showWatermark = true,
}: {
  coverId: string;
  customUrl?: string | null;
  title?: string;
  className?: string;
  showWatermark?: boolean;
}) {
  const cover = useMemo(() => getCover(coverId), [coverId]);
  if (customUrl) {
    return (
      <div className={cn('cover-sheen relative overflow-hidden rounded-xl shadow-ink-1', className)}>
        <img src={customUrl} alt={title ?? 'Notebook cover'} className="h-full w-full object-cover" draggable={false} />
      </div>
    );
  }
  const isNanoteBlue = coverId === 'nanote-blue';
  return (
    <div
      className={cn('cover-sheen relative overflow-hidden rounded-xl shadow-ink-1', className)}
      style={{
        background: cover.css.background,
        ...(cover.css.backgroundSize ? { backgroundSize: cover.css.backgroundSize } : {}),
      }}
    >
      {/* spine */}
      <div
        className="absolute inset-y-0 start-0 w-[7%] min-w-4"
        style={{ background: 'rgba(0,0,0,0.14)' }}
      />
      {isNanoteBlue && showWatermark && (
        <svg viewBox="0 0 512 512" className="absolute -bottom-[12%] -end-[8%] h-[70%] opacity-[0.16]" aria-hidden>
          <path d="M186 354 L186 158 L326 354 L326 158" fill="none" stroke="#FFFFFF" strokeWidth="58" strokeLinejoin="miter" />
        </svg>
      )}
      {title && (
        <div
          className="absolute inset-x-0 bottom-0 p-3 text-start"
          style={{ color: cover.css.color }}
        >
          <div className="line-clamp-3 text-sm font-semibold leading-snug drop-shadow-sm">{title}</div>
        </div>
      )}
    </div>
  );
}
