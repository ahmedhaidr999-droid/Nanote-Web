import 'package:flutter/material.dart';

import '../../controllers/library_controller.dart';
import '../../i18n/strings.dart';
import '../../models/library_models.dart';
import '../../theme/nanote_theme.dart';

/// Library page: folder breadcrumb bar, folder tiles, and notebook cards
/// (grid or list). Renders the global favorites list when [showFavorites]
/// is set — no folder chrome in that mode.
class LibraryView extends StatelessWidget {
  final LibraryController library;
  final bool showFavorites;
  final void Function(NotebookRow notebook) onOpen;

  const LibraryView({
    super.key,
    required this.library,
    required this.showFavorites,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: library,
      builder: (context, _) {
        final i18n = I18n.of(context);
        final snap = library.snapshot;
        final searching = snap.query.trim().isNotEmpty;
        final notes = showFavorites ? snap.favorites : snap.notebooks;
        final folders =
            (showFavorites || searching) ? const <FolderRow>[] : snap.folders;
        final empty = notes.isEmpty && folders.isEmpty;

        return Column(
          children: [
            if (!showFavorites && !searching) _buildFolderBar(context),
            Expanded(
              child: empty
                  ? LibraryEmptyState(
                      icon: showFavorites
                          ? Icons.star_outline
                          : Icons.auto_stories_outlined,
                      message: i18n.t(
                          showFavorites ? 'empty_fav_hint' : 'empty_notes_hint'),
                    )
                  : LayoutBuilder(
                      builder: (context, constraints) {
                        final width = constraints.maxWidth;
                        final columns =
                            width < 600 ? 2 : (width < 900 ? 3 : 4);
                        return library.viewMode == LibraryViewMode.grid
                            ? _buildGrid(context, columns, folders, notes, snap)
                            : _buildList(context, folders, notes, snap, i18n);
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  // ───────────────────────── layout ─────────────────────────

  Widget _buildGrid(
    BuildContext context,
    int columns,
    List<FolderRow> folders,
    List<NotebookRow> notes,
    LibrarySnapshot snap,
  ) {
    return GridView.count(
      crossAxisCount: columns,
      childAspectRatio: 0.74,
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
          .copyWith(bottom: 96),
      children: [
        for (final folder in folders)
          _FolderTile(
            folder: folder,
            onOpen: () => library.openFolder(folder.id),
          ),
        for (final nb in notes)
          NotebookCard(
            notebook: nb,
            pageCount: snap.pageCountByNotebook[nb.id] ?? 0,
            onOpen: () => onOpen(nb),
            onMenu: () => _showNotebookActions(context, nb),
          ),
      ],
    );
  }

  Widget _buildList(
    BuildContext context,
    List<FolderRow> folders,
    List<NotebookRow> notes,
    LibrarySnapshot snap,
    I18n i18n,
  ) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
          .copyWith(bottom: 96),
      itemCount: folders.length + notes.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        if (index < folders.length) {
          final folder = folders[index];
          return _FolderListTile(
            folder: folder,
            onOpen: () => library.openFolder(folder.id),
          );
        }
        final nb = notes[index - folders.length];
        return _NotebookListTile(
          notebook: nb,
          pageCount: snap.pageCountByNotebook[nb.id] ?? 0,
          relative: _relativeActivityText(i18n, snap, nb),
          onOpen: () => onOpen(nb),
          onMenu: () => _showNotebookActions(context, nb),
        );
      },
    );
  }

  /// Breadcrumb chips (root → current folder) + the "new folder" action.
  Widget _buildFolderBar(BuildContext context) {
    final i18n = I18n.of(context);
    final inFolder = library.currentFolderId != null;
    final trail = library.folderTrail();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          if (inFolder)
            Expanded(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _folderChip(
                      context,
                      icon: Icons.folder_outlined,
                      label: i18n.t('notebooks'),
                      selected: false,
                      onTap: () => library.openFolder(null),
                    ),
                    for (final f in trail)
                      _folderChip(
                        context,
                        icon: Icons.folder,
                        label: f.name,
                        selected: f.id == library.currentFolderId,
                        onTap: () => library.openFolder(f.id),
                      ),
                  ],
                ),
              ),
            )
          else
            const Spacer(),
          TextButton.icon(
            onPressed: () => _showCreateFolderDialog(context),
            icon: const Icon(Icons.create_new_folder_outlined, size: 18),
            label: Text(i18n.t('new_folder')),
          ),
        ],
      ),
    );
  }

  Widget _folderChip(
    BuildContext context, {
    required IconData icon,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final colors = NanoteColors.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: Material(
        color: selected ? colors.primarySoft : colors.surfaceAlt,
        borderRadius: BorderRadius.circular(kNanoteRadius),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon,
                    size: 16,
                    color: selected ? colors.primary : colors.textMuted),
                const SizedBox(width: 6),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected ? colors.primary : colors.text,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ───────────────────────── actions / dialogs ─────────────────────────

  /// Long-press / overflow menu → modal bottom sheet of notebook actions.
  Future<void> _showNotebookActions(BuildContext context, NotebookRow nb) async {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    final snap = library.snapshot;
    final count = snap.pageCountByNotebook[nb.id] ?? 0;
    final relative = _relativeActivityText(i18n, snap, nb);

    await showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    nb.title.isEmpty ? i18n.t('notebook') : nb.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.text,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${i18n.num(count)} ${i18n.t('pages')} · $relative',
                    style: TextStyle(color: colors.textMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_rename_outline),
              title: Text(i18n.t('rename')),
              onTap: () {
                Navigator.pop(sheetContext);
                _showRenameDialog(context, nb);
              },
            ),
            ListTile(
              leading: Icon(
                nb.favorite ? Icons.star_rounded : Icons.star_outline,
                color: nb.favorite ? colors.warning : null,
              ),
              title: Text(i18n.t('mark_favorite')),
              onTap: () {
                Navigator.pop(sheetContext);
                library.repo.toggleFavorite(nb);
              },
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_move_outlined),
              title: Text(i18n.t('move_to_folder')),
              onTap: () {
                Navigator.pop(sheetContext);
                _showMoveDialog(context, nb);
              },
            ),
            ListTile(
              leading: Icon(Icons.delete_outline, color: colors.danger),
              title: Text(i18n.t('delete'),
                  style: TextStyle(color: colors.danger)),
              onTap: () {
                Navigator.pop(sheetContext);
                _showDeleteDialog(context, nb);
              },
            ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }

  Future<void> _showRenameDialog(BuildContext context, NotebookRow nb) async {
    final i18n = I18n.of(context);
    final repo = library.repo;
    final controller = TextEditingController(text: nb.title);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(i18n.t('rename_notebook')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(hintText: i18n.t('notebook_name')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(i18n.t('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(i18n.t('save')),
          ),
        ],
      ),
    );
    final title = controller.text.trim();
    if (confirmed == true && title.isNotEmpty) {
      repo.renameNotebook(nb, title);
    }
  }

  Future<void> _showMoveDialog(BuildContext context, NotebookRow nb) async {
    final i18n = I18n.of(context);
    final repo = library.repo;
    final allFolders = repo.folders;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: Text(i18n.t('move_to_folder')),
        children: [
          _moveOption(
            context,
            icon: Icons.folder_outlined,
            label: i18n.t('notebooks'),
            selected: nb.parentId == null,
            onTap: () {
              Navigator.pop(dialogContext);
              repo.moveNotebook(nb, null);
            },
          ),
          for (final f in allFolders)
            _moveOption(
              context,
              icon: Icons.folder,
              label: f.name,
              selected: nb.parentId == f.id,
              onTap: () {
                Navigator.pop(dialogContext);
                repo.moveNotebook(nb, f.id);
              },
            ),
        ],
      ),
    );
  }

  Widget _moveOption(
    BuildContext context, {
    required IconData icon,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final colors = NanoteColors.of(context);
    return SimpleDialogOption(
      onPressed: onTap,
      child: Row(
        children: [
          Icon(icon, size: 20,
              color: selected ? colors.primary : colors.textMuted),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: colors.text,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
          if (selected)
            Icon(Icons.check, size: 20, color: colors.primary),
        ],
      ),
    );
  }

  Future<void> _showDeleteDialog(BuildContext context, NotebookRow nb) async {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    final repo = library.repo;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(i18n.t('delete')),
        content: Text(i18n.t('confirm_delete_notebook', {'n': nb.title})),
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
    if (confirmed == true) repo.trashNotebook(nb);
  }

  Future<void> _showCreateFolderDialog(BuildContext context) async {
    final i18n = I18n.of(context);
    final repo = library.repo;
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(i18n.t('new_folder')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(hintText: i18n.t('folder_name')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(i18n.t('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(i18n.t('create')),
          ),
        ],
      ),
    );
    final name = controller.text.trim();
    if (confirmed == true && name.isNotEmpty) {
      repo.createFolder(name, parentId: library.currentFolderId);
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  String _relativeActivityText(
      I18n i18n, LibrarySnapshot snap, NotebookRow nb) {
    final last = snap.notebookLastActivity[nb.id] ?? nb.updatedAt;
    return i18n.relativeDays(DateTime.now().difference(last).inDays);
  }
}

// ───────────────────────── shared widgets ─────────────────────────

/// Friendly centered icon + message for empty tabs.
class LibraryEmptyState extends StatelessWidget {
  final IconData icon;
  final String message;

  const LibraryEmptyState({super.key, required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                color: colors.primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 40, color: colors.primary),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: colors.textMuted,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Notebook cover card for grid mode (~130×170 at 2 columns on a phone):
/// vertical palette gradient, cover-art glyph, translucent title strip,
/// star badge and overflow menu.
class NotebookCard extends StatelessWidget {
  final NotebookRow notebook;
  final int pageCount;
  final VoidCallback onOpen;
  final VoidCallback onMenu;

  const NotebookCard({
    super.key,
    required this.notebook,
    required this.pageCount,
    required this.onOpen,
    required this.onMenu,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    final (deep, soft) =
        kCoverPalette[_clampIndex(notebook.colorIdx, kCoverPalette.length)];
    return Material(
      color: deep,
      borderRadius: BorderRadius.circular(kNanoteRadius),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [deep, soft],
          ),
          border: Border.all(color: colors.border),
        ),
        child: InkWell(
          onTap: onOpen,
          onLongPress: onMenu,
          child: SizedBox.expand(
            child: Stack(
              fit: StackFit.expand,
              children: [
                Center(
                  child: Icon(
                    _coverArtIconOf(notebook.coverIdx),
                    size: 54,
                    color: Colors.white.withValues(alpha: 0.92),
                  ),
                ),
                if (notebook.favorite)
                  PositionedDirectional(
                    top: 8,
                    end: 8,
                    child: _coverBadge(Icons.star_rounded),
                  ),
                PositionedDirectional(
                  top: 8,
                  start: 8,
                  child: _coverBadge(Icons.more_vert, onTap: onMenu),
                ),
                PositionedDirectional(
                  bottom: 0,
                  start: 0,
                  end: 0,
                  child: Container(
                    color: Colors.white.withValues(alpha: 0.16),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          notebook.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${i18n.num(pageCount)} ${i18n.t('pages')}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.85),
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _coverBadge(IconData icon, {VoidCallback? onTap}) {
    return Material(
      color: Colors.white.withValues(alpha: 0.24),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(5),
          child: Icon(icon, size: 14, color: Colors.white),
        ),
      ),
    );
  }
}

/// Small notebook-cover thumbnail (list rows, trash rows).
class CoverThumb extends StatelessWidget {
  final NotebookRow notebook;
  final double width;
  final double height;

  const CoverThumb({
    super.key,
    required this.notebook,
    required this.width,
    required this.height,
  });

  @override
  Widget build(BuildContext context) {
    final (deep, soft) =
        kCoverPalette[_clampIndex(notebook.colorIdx, kCoverPalette.length)];
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [deep, soft],
        ),
      ),
      child: Center(
        child: Icon(
          _coverArtIconOf(notebook.coverIdx),
          size: (width * 0.42).clamp(14, 26).toDouble(),
          color: Colors.white.withValues(alpha: 0.92),
        ),
      ),
    );
  }
}

// ───────────────────────── private row widgets ─────────────────────────

class _FolderTile extends StatelessWidget {
  final FolderRow folder;
  final VoidCallback onOpen;

  const _FolderTile({required this.folder, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return Card(
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(kNanoteRadius),
        child: SizedBox.expand(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: colors.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.folder_outlined,
                    size: 30, color: colors.primary),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  folder.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colors.text,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FolderListTile extends StatelessWidget {
  final FolderRow folder;
  final VoidCallback onOpen;

  const _FolderListTile({required this.folder, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    return Card(
      child: ListTile(
        onTap: onOpen,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: colors.primarySoft,
            shape: BoxShape.circle,
          ),
          child: Icon(Icons.folder_outlined, size: 20, color: colors.primary),
        ),
        title: Text(
          folder.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: colors.text,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _NotebookListTile extends StatelessWidget {
  final NotebookRow notebook;
  final int pageCount;
  final String relative;
  final VoidCallback onOpen;
  final VoidCallback onMenu;

  const _NotebookListTile({
    required this.notebook,
    required this.pageCount,
    required this.relative,
    required this.onOpen,
    required this.onMenu,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = I18n.of(context);
    final colors = NanoteColors.of(context);
    return Card(
      child: ListTile(
        onTap: onOpen,
        onLongPress: onMenu,
        leading: CoverThumb(notebook: notebook, width: 48, height: 64),
        title: Text(
          notebook.title.isEmpty ? i18n.t('notebook') : notebook.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: colors.text, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          '${i18n.num(pageCount)} ${i18n.t('pages')} · $relative',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: colors.textMuted, fontSize: 12),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (notebook.favorite)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 2),
                child:
                    Icon(Icons.star_rounded, size: 20, color: colors.warning),
              ),
            IconButton(
              icon: const Icon(Icons.more_vert),
              tooltip: i18n.t('more'),
              onPressed: onMenu,
            ),
          ],
        ),
      ),
    );
  }
}

// ───────────────────────── cover helpers ─────────────────────────

int _clampIndex(int idx, int length) =>
    idx <= 0 ? 0 : (idx >= length ? length - 1 : idx);

IconData _coverArtIconOf(int coverIdx) {
  return switch (CoverArt.values[_clampIndex(coverIdx, CoverArt.values.length)]) {
    CoverArt.waves => Icons.waves,
    CoverArt.dots => Icons.blur_on,
    CoverArt.lines => Icons.line_weight,
    CoverArt.arc => Icons.architecture,
    CoverArt.grid => Icons.grid_on,
    CoverArt.spiral => Icons.all_inclusive,
    CoverArt.sun => Icons.wb_sunny,
    CoverArt.triangles => Icons.change_history,
  };
}
