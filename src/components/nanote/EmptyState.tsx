'use client';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-variant text-muted-foreground">
        <Icon className="h-8 w-8" strokeWidth={1.6} />
      </div>
      <div className="text-base font-semibold text-foreground">{title}</div>
      {hint && <div className="max-w-sm text-sm leading-relaxed text-muted-foreground">{hint}</div>}
      {action}
    </div>
  );
}
