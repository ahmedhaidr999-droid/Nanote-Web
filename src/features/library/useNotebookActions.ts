'use client';
// Notebook action helpers with sonner toasts — shared by card menu, list rows,
// trash list and the FAB. All store mutations funnel through here.
import { useMemo } from 'react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';

export type TFn = ReturnType<typeof useT>['t'];

/** "3 pages" / "1 page" — the dictionary has both singular & plural keys. */
export function pagesLabel(count: number, t: TFn): string {
  return `${count} ${count === 1 ? t('library.page') : t('library.pages')}`;
}

export function useNotebookActions() {
  const { t } = useT();

  return useMemo(() => {
    const fail = () => toast.error(t('error.generic'));

    return {
      open(id: string) {
        void useApp.getState().openEditor(id);
      },

      toggleFavorite(id: string) {
        void useApp.getState().toggleFavoriteNotebook(id).catch(fail);
      },

      async duplicate(id: string) {
        try {
          await useApp.getState().duplicateNotebook(id);
          toast.success(t('library.duplicated', 'Notebook duplicated', 'تم تكرار الدفتر'));
        } catch {
          fail();
        }
      },

      async trash(id: string) {
        try {
          await useApp.getState().trashNotebook(id);
          toast(t('library.deleted'), {
            action: {
              label: t('library.undo'),
              onClick: () => {
                void useApp.getState().restoreNotebook(id);
              },
            },
          });
        } catch {
          fail();
        }
      },

      async restoreNotebook(id: string) {
        try {
          await useApp.getState().restoreNotebook(id);
          toast.success(t('library.restored'));
        } catch {
          fail();
        }
      },

      async purgeNotebook(id: string) {
        try {
          await useApp.getState().purgeNotebook(id);
          toast.success(t('library.deletedForever'));
        } catch {
          fail();
        }
      },

      async restoreFolder(id: string) {
        try {
          await useApp.getState().restoreFolder(id);
          toast.success(t('library.restored'));
        } catch {
          fail();
        }
      },

      async purgeFolder(id: string) {
        try {
          await useApp.getState().purgeFolder(id);
          toast.success(t('library.deletedForever'));
        } catch {
          fail();
        }
      },

      async restoreTab(id: string) {
        try {
          await useApp.getState().restoreTab(id);
          toast.success(t('library.restored'));
        } catch {
          fail();
        }
      },

      async purgeTab(id: string) {
        try {
          await useApp.getState().purgeTab(id);
          toast.success(t('library.deletedForever'));
        } catch {
          fail();
        }
      },

      async exportPdf(id: string) {
        const tid = toast.loading(t('export.pdf.building'));
        try {
          // Dynamic import keeps jsPDF out of the library chunk.
          // @ts-ignore -- module ships with the export stage; contract: exportNotebookPdf(notebookId).
          const mod = await import('@/lib/nanote/export');
          await mod.exportNotebookPdf(id);
          toast.success(t('export.done'), { id: tid });
        } catch (e) {
          console.warn('[nanote] pdf export failed', e);
          toast.error(t('error.generic'), { id: tid });
        }
      },
    };
  }, [t]);
}
