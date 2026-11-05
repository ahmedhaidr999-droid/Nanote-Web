import 'package:flutter/material.dart';

import '../../controllers/library_controller.dart';
import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../theme/nanote_theme.dart';
import 'library_view.dart' show CoverThumb, LibraryEmptyState;

/// Trash tab: restore trashed notebooks or purge them forever.
/// Shows the auto-purge hint banner and an "empty trash" action.
class TrashView extends StatelessWidget {
  final LibraryController library;

  const TrashView({super.key, required this.library});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: library,
      builder: (context, _) {
        final i18n = I18n.of(context);
        final colors = NanoteColors.of(context);
        final trashed = library.snapshot.trashNotebooks;

        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: colors.surfaceAlt,
                  borderRadius: BorderRadius.circular(kNanoteRadius),
                  border: Border.all(color: colors.border),
                ),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber_rounded,
                        size: 20, color: colors.warning),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        i18n.t('trash_hint'),
                        style: TextStyle(
                            color: colors.textMuted, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (trashed.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: OutlinedButton.icon(
                    onPressed: () => _confirmEmptyTrash(context),
                    icon: const Icon(Icons.delete_sweep_outlined, size: 18),
                    label: Text(i18n.t('empty_trash')),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: colors.danger,
                      side: BorderSide(color: colors.danger),
                    ),
                  ),
                ),
              ),
            Expanded(
              child: trashed.isEmpty
                  ? LibraryEmptyState(
                      icon: Icons.delete_outline,
                      message: i18n.t('empty'),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 8)
                          .copyWith(bottom: 96),
                      itemCount: trashed.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final nb = trashed[index];
                        return _TrashRow(
                          notebook: nb,
                          relative: i18n.relativeDays(DateTime.now()
                              .difference(nb.trashedAt ?? nb.updatedAt)
                              .inDays),
                          onRestore: () => library.repo.restoreNotebook(nb),
                          onPurge: () => _confirmPurge(context, nb),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  // ───────────────────────── confirmations ─────────────────────────

  Future<void> _confirmPurge(BuildContext context, NotebookRow nb) async {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    final repo = library.repo;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(i18n.t('delete_forever')),
        content: Text(
          nb.title.isEmpty ? i18n.t('notebook') : nb.title,
          style: TextStyle(
              color: colors.text, fontWeight: FontWeight.w600),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(i18n.t('cancel')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: colors.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(i18n.t('delete')),
          ),
        ],
      ),
    );
    if (confirmed == true) await repo.purgeNotebook(nb);
  }

  Future<void> _confirmEmptyTrash(BuildContext context) async {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    final repo = library.repo;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(i18n.t('empty_trash')),
        content: Text(i18n.t('trash_hint')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(i18n.t('cancel')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: colors.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(i18n.t('delete')),
          ),
        ],
      ),
    );
    if (confirmed == true) await repo.emptyTrash();
  }
}

class _TrashRow extends StatelessWidget {
  final NotebookRow notebook;
  final String relative;
  final VoidCallback onRestore;
  final VoidCallback onPurge;

  const _TrashRow({
    required this.notebook,
    required this.relative,
    required this.onRestore,
    required this.onPurge,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    return Card(
      child: ListTile(
        leading: CoverThumb(notebook: notebook, width: 40, height: 52),
        title: Text(
          notebook.title.isEmpty ? i18n.t('notebook') : notebook.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: colors.text, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          relative,
          style: TextStyle(color: colors.textMuted, fontSize: 12),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.restore),
              tooltip: i18n.t('restore'),
              onPressed: onRestore,
            ),
            IconButton(
              icon: Icon(Icons.delete_forever, color: colors.danger),
              tooltip: i18n.t('delete_forever'),
              onPressed: onPurge,
            ),
          ],
        ),
      ),
    );
  }
}
