import 'package:flutter/material.dart';

import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../models/paper.dart';
import '../../persistence/library_repository.dart';
import '../../theme/nanote_theme.dart';

/// Page manager sheet (~70vh): every visible page of the notebook with
/// reorder / duplicate / delete / re-template actions, plus add-page.
/// [onChanged] fires after every mutation; tapping a row goes to that page.
class PagesSheet extends StatefulWidget {
  final LibraryRepository repo;
  final String notebookId;
  final String? currentPageId;
  final VoidCallback onChanged;
  final void Function(int index) onGoTo;
  final VoidCallback? onClose;

  const PagesSheet({
    super.key,
    required this.repo,
    required this.notebookId,
    required this.currentPageId,
    required this.onChanged,
    required this.onGoTo,
    this.onClose,
  });

  @override
  State<PagesSheet> createState() => _PagesSheetState();
}

class _PagesSheetState extends State<PagesSheet> {
  /// Refresh this sheet + notify the host after any mutation.
  void _changed() {
    widget.onChanged();
    if (mounted) setState(() {});
  }

  void _addPage() {
    widget.repo.addPage(widget.notebookId);
    _changed();
  }

  Future<void> _duplicate(PageRow page) async {
    await widget.repo.duplicatePage(page);
    _changed();
  }

  Future<void> _delete(BuildContext context, PageRow page, int index) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final dI18n = I18n.of(dialogContext);
        final dColors = NanoteColors.of(dialogContext);
        return AlertDialog(
          title: Text(dI18n.t('delete')),
          content:
              Text('${dI18n.t('page')} ${dI18n.num(index + 1)}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(dI18n.t('cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: dColors.danger,
                foregroundColor: Colors.white,
              ),
              child: Text(dI18n.t('delete')),
            ),
          ],
        );
      },
    );
    if (ok != true) return;
    await widget.repo.deletePage(page);
    _changed();
  }

  /// Inline template picker: grid of the 12 paper templates by name.
  Future<void> _pickTemplate(PageRow page) async {
    final tpl = await showDialog<PaperTemplate>(
      context: context,
      builder: (dialogContext) {
        final dI18n = I18n.of(dialogContext);
        return AlertDialog(
          title: Text(dI18n.t('paper_template')),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final t in PaperTemplate.values)
                    ChoiceChip(
                      label: Text(dI18n.t(t.labelKey)),
                      selected: page.template == t,
                      onSelected: (_) => Navigator.of(dialogContext).pop(t),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(dI18n.t('cancel')),
            ),
          ],
        );
      },
    );
    if (tpl == null) return;
    page.template = tpl;
    widget.repo.updatePage(page);
    _changed();
  }

  void _close(BuildContext context) {
    final close = widget.onClose;
    if (close != null) {
      close();
    } else {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final pages = widget.repo.visiblePages(widget.notebookId);
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.7,
      child: Column(children: [
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(20, 0, 8, 4),
          child: Row(children: [
            Expanded(
              child: Text(
                i18n.t('page_manager'),
                style: TextStyle(
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            FilledButton.tonalIcon(
              onPressed: _addPage,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: Text(i18n.t('add_page')),
            ),
            IconButton(
              tooltip: i18n.t('close'),
              icon: const Icon(Icons.close_rounded),
              onPressed: () => _close(context),
            ),
          ]),
        ),
        Divider(height: 1, color: colors.border),
        Expanded(
          child: pages.isEmpty
              ? Center(
                  child: Text(
                    i18n.t('empty'),
                    style: TextStyle(color: colors.textMuted),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsetsDirectional.fromSTEB(12, 8, 12, 16),
                  itemCount: pages.length,
                  itemBuilder: (context, i) =>
                      _pageRow(context, colors, i18n, pages, i),
                ),
        ),
      ]),
    );
  }

  Widget _pageRow(
    BuildContext context,
    NanoteColors colors,
    I18n i18n,
    List<PageRow> pages,
    int i,
  ) {
    final page = pages[i];
    final current = page.id == widget.currentPageId;
    final isLastPage = pages.length <= 1;
    final sizeLabel = i18n.t(
      kPaperSizes[page.sizeIdx.clamp(0, kPaperSizes.length - 1)].labelKey,
    );
    return Container(
      margin: const EdgeInsetsDirectional.only(bottom: 6),
      decoration: BoxDecoration(
        color: current ? colors.primarySoft : Colors.transparent,
        borderRadius: BorderRadius.circular(kNanoteRadius),
        border: Border.all(color: current ? colors.primary : colors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        onTap: () => widget.onGoTo(i),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(8, 4, 4, 4),
          child: Row(children: [
            // leading: page number chip / PDF badge
            if (page.isPdf)
              Padding(
                padding: const EdgeInsetsDirectional.only(start: 6),
                child: Icon(
                  Icons.picture_as_pdf_rounded,
                  size: 28,
                  color: colors.danger,
                ),
              )
            else
              Container(
                width: 34,
                height: 34,
                alignment: AlignmentDirectional.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: current ? colors.primary : colors.surfaceAlt,
                  border:
                      Border.all(color: current ? colors.primary : colors.border),
                ),
                child: Text(
                  i18n.num(i + 1),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: current ? colors.primaryFg : colors.text,
                  ),
                ),
              ),
            const SizedBox(width: 10),
            // title + size
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    page.isPdf
                        ? '${i18n.t('import_pdf')} ${i18n.num((page.pdfIndex ?? 0) + 1)}'
                        : i18n.t(page.template.labelKey),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: colors.text,
                    ),
                  ),
                  Text(
                    sizeLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: colors.textMuted),
                  ),
                ],
              ),
            ),
            // actions
            if (!page.isPdf)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: i18n.t('paper_template'),
                icon: const Icon(Icons.tune_rounded, size: 20),
                onPressed: () => _pickTemplate(page),
              ),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: i18n.t('duplicate'),
              icon: const Icon(Icons.content_copy_rounded, size: 20),
              onPressed: () => _duplicate(page),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: i18n.t('delete'),
              icon: const Icon(Icons.delete_outline_rounded, size: 20),
              color: colors.danger,
              onPressed:
                  isLastPage ? null : () => _delete(context, page, i),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.arrow_upward_rounded, size: 18),
              onPressed: i == 0
                  ? null
                  : () {
                      widget.repo.reorderPage(page, i - 1);
                      _changed();
                    },
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.arrow_downward_rounded, size: 18),
              onPressed: i >= pages.length - 1
                  ? null
                  : () {
                      widget.repo.reorderPage(page, i + 1);
                      _changed();
                    },
            ),
          ]),
        ),
      ),
    );
  }
}
