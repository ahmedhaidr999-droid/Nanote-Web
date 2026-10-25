'use client';
// Floating action button (bottom-end) — new notebook / new folder / import PDF.
// Actions carry the current tab/folder context; PDF imports are moved into the
// current folder (or tab) right after import.
import { useRef } from 'react';
import { toast } from 'sonner';
import { BookPlus, FileUp, FolderPlus, Plus } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApp, useT } from '@/lib/nanote/store';

interface FabMenuProps {
  /** Tab context for new items (null = "All Notes", no folder creation). */
  activeTabId: string | null;
  /** Folder context for new items (null = the tab root). */
  activeFolderId: string | null;
  onNewFolder: (parentId: string | null, tabId: string | null) => void;
}

export function FabMenu({ activeTabId, activeFolderId, onNewFolder }: FabMenuProps) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error(t('library.pdfImport.notPdf', 'Please choose a PDF file.', 'الرجاء اختيار ملف PDF.'));
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      toast.error(t('library.pdfImport.tooLarge.hard', 'PDF is larger than 150 MB.', 'حجم ملف PDF يتجاوز ١٥٠ ميجابايت.'));
      return;
    }
    const tid = toast.loading(t('library.importPdf.doing', 'Importing PDF…', 'جارٍ استيراد PDF…'));
    try {
      // Dynamic import keeps pdf.js out of the library chunk.
      // @ts-ignore -- module ships with the PDF stage; contract: importPdfAsNotebook(file, onProgress) → PdfImportResult.
      const mod = await import('@/lib/nanote/pdfimport');
      const res = await mod.importPdfAsNotebook(file, (done, total) => {
        toast.loading(
          t('library.importPdf.progress', 'Importing page {done}/{total}…', 'استيراد الصفحة {done}/{total}…')
            .replace('{done}', String(done)).replace('{total}', String(total)),
          { id: tid },
        );
      });
      // The importer creates the notebook at the library root — carry it into
      // the current context with a move (existing store actions).
      if (activeFolderId) {
        await useApp.getState().moveNotebook(res.notebookId, activeFolderId);
      } else if (activeTabId) {
        await useApp.getState().moveNotebookToTab(res.notebookId, activeTabId);
      }
      await useApp.getState().refreshLibrary();
      if (res.capped) {
        toast.warning(t('library.pdfImport.capped', 'Imported the first 200 pages.', 'تم استيراد أول ٢٠٠ صفحة.'));
      }
      if (res.failed > 0) {
        toast.warning(t('library.pdfImport.partial', '{n} page(s) could not be rendered and were left blank.', 'تعذّر عرض {n} صفحة وتركت فارغة.').replace('{n}', String(res.failed)));
      }
      toast.success(t('library.importPdf.done', 'PDF imported', 'تم استيراد ملف PDF'), { id: tid });
      void useApp.getState().openEditor(res.notebookId);
    } catch (err) {
      console.warn('[nanote] pdf import failed', err);
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'PasswordException') {
        toast.error(t('library.pdfImport.password', 'This PDF is password-protected.', 'ملف PDF محمي بكلمة مرور.'), { id: tid });
      } else if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
        toast.error(t('library.pdfImport.invalid', 'This file is not a valid PDF (it may be damaged).', 'هذا الملف ليس ملف PDF صالحًا (قد يكون تالفًا).'), { id: tid });
      } else if (name === 'PdfTooLargeError') {
        toast.error(t('library.pdfImport.tooLarge.hard', 'PDF is larger than 150 MB.', 'حجم ملف PDF يتجاوز ١٥٠ ميجابايت.'), { id: tid });
      } else {
        toast.error(t('error.generic'), { id: tid });
      }
    }
  };

  return (
    <div className="fixed bottom-6 end-6 z-40 flex flex-col items-end">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf,application/x-pdf"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void handleImport(e)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('library.newNotebook')}
            aria-haspopup="menu"
            className="flex h-14 w-14 items-center justify-center rounded-[28px] bg-primary text-primary-foreground shadow-ink-2 transition-transform press-scale hover:scale-105 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <Plus className="h-7 w-7" strokeWidth={2.4} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-52">
          <DropdownMenuItem
            onClick={() =>
              useApp.getState().navigate({ name: 'create-notebook', folderId: activeFolderId, tabId: activeTabId })
            }
          >
            <BookPlus aria-hidden /> {t('library.newNotebook')}
          </DropdownMenuItem>
          {activeTabId ? (
            <DropdownMenuItem onClick={() => onNewFolder(activeFolderId, activeTabId)}>
              <FolderPlus aria-hidden /> {t('library.newFolder')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <FileUp aria-hidden /> {t('library.importPdf')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
