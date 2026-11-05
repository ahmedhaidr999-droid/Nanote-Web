import 'package:flutter/material.dart';

import '../controllers/library_controller.dart';
import '../controllers/settings_controller.dart';
import '../i18n/strings.dart';
import '../models/library_models.dart';
import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';
import '../services/backup_service.dart';
import '../services/image_cache.dart';
import '../workspace/document_workspace.dart';
import 'library/library_view.dart';
import 'library/trash_view.dart';
import 'notebook/create_notebook_view.dart';
import 'settings/settings_view.dart';

/// Root shell of the native app: app bar (search / sort / view mode /
/// PDF import / settings), the three-tab library body, and the
/// "new notebook" extended FAB. Tab + search state lives in [_HomeShellBody].
class HomeShell extends StatelessWidget {
  final LibraryController library;
  final LibraryRepository repo;
  final SettingsController settings;
  final FileStore fs;
  final AppImageCache images;
  final BackupService backup;

  const HomeShell({
    super.key,
    required this.library,
    required this.repo,
    required this.settings,
    required this.fs,
    required this.images,
    required this.backup,
  });

  @override
  Widget build(BuildContext context) {
    return _HomeShellBody(
      library: library,
      repo: repo,
      settings: settings,
      fs: fs,
      images: images,
      backup: backup,
    );
  }
}

class _HomeShellBody extends StatefulWidget {
  final LibraryController library;
  final LibraryRepository repo;
  final SettingsController settings;
  final FileStore fs;
  final AppImageCache images;
  final BackupService backup;

  const _HomeShellBody({
    required this.library,
    required this.repo,
    required this.settings,
    required this.fs,
    required this.images,
    required this.backup,
  });

  @override
  State<_HomeShellBody> createState() => _HomeShellBodyState();
}

class _HomeShellBodyState extends State<_HomeShellBody> {
  int _tab = 0;
  bool _searchOpen = false;
  bool _importing = false;
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  // ───────────────────────── navigation ─────────────────────────

  void _openNotebook(NotebookRow nb) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => WorkspaceScreen(
        notebook: nb,
        repo: widget.repo,
        fs: widget.fs,
        images: widget.images,
        settings: widget.settings,
      ),
    ));
  }

  Future<void> _createNotebook() async {
    final nb = await showCreateNotebookSheet(context, widget.repo);
    if (nb == null || !mounted) return;
    _openNotebook(nb);
  }

  Future<void> _importPdf() async {
    if (_importing) return;
    setState(() => _importing = true);
    NotebookRow? nb;
    try {
      nb = await widget.library.importPdf();
    } catch (_) {
      nb = null; // picker cancelled / unreadable file — just stay quiet
    } finally {
      if (mounted) setState(() => _importing = false);
    }
    if (nb == null || !mounted) return;
    final i18n = I18n.of(context);
    final title = nb.title.isEmpty ? i18n.t('import_pdf') : nb.title;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${i18n.t('import_pdf')} · $title')),
    );
  }

  // ───────────────────────── search ─────────────────────────

  void _closeSearch() {
    _searchController.clear();
    widget.library.setSearch('');
    setState(() => _searchOpen = false);
  }

  // ───────────────────────── build ─────────────────────────

  @override
  Widget build(BuildContext context) {
    final i18n = I18n.of(context);
    return ListenableBuilder(
      listenable: widget.library,
      builder: (context, _) {
        final lib = widget.library;
        return Scaffold(
          appBar: AppBar(
            title: _searchOpen
                ? TextField(
                    controller: _searchController,
                    autofocus: true,
                    textInputAction: TextInputAction.search,
                    onChanged: lib.setSearch,
                    decoration: InputDecoration(
                      hintText: i18n.t('search'),
                      isDense: true,
                      prefixIcon: const Icon(Icons.search, size: 20),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.close, size: 20),
                        tooltip: i18n.t('close'),
                        onPressed: _closeSearch,
                      ),
                    ),
                  )
                : Text(i18n.t('app_title')),
            actions: _searchOpen
                ? null
                : <Widget>[
                    IconButton(
                      icon: const Icon(Icons.search),
                      tooltip: i18n.t('search'),
                      onPressed: () =>
                          setState(() => _searchOpen = true),
                    ),
                    PopupMenuButton<LibrarySort>(
                      icon: const Icon(Icons.sort),
                      onSelected: lib.setSort,
                      itemBuilder: (_) => [
                        _sortItem(
                            i18n, LibrarySort.updated, 'sort_updated', lib.sort),
                        _sortItem(
                            i18n, LibrarySort.created, 'sort_created', lib.sort),
                        _sortItem(
                            i18n, LibrarySort.title, 'sort_title', lib.sort),
                      ],
                    ),
                    IconButton(
                      icon: Icon(lib.viewMode == LibraryViewMode.grid
                          ? Icons.view_list
                          : Icons.grid_view),
                      tooltip: i18n.t(lib.viewMode == LibraryViewMode.grid
                          ? 'list_view'
                          : 'grid_view'),
                      onPressed: lib.toggleViewMode,
                    ),
                    IconButton(
                      onPressed: _importPdf,
                      tooltip: i18n.t('import_pdf'),
                      icon: _importing
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.4),
                            )
                          : const Icon(Icons.picture_as_pdf_outlined),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SettingsView(
                            settings: widget.settings,
                            backup: widget.backup,
                          ),
                        ),
                      ),
                      tooltip: i18n.t('settings'),
                      icon: const Icon(Icons.settings_outlined),
                    ),
                  ],
          ),
          body: IndexedStack(
            index: _tab,
            children: [
              LibraryView(
                library: lib,
                showFavorites: false,
                onOpen: _openNotebook,
              ),
              LibraryView(
                library: lib,
                showFavorites: true,
                onOpen: _openNotebook,
              ),
              TrashView(library: lib),
            ],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (index) => setState(() => _tab = index),
            destinations: [
              NavigationDestination(
                icon: const Icon(Icons.auto_stories_outlined),
                selectedIcon: const Icon(Icons.auto_stories),
                label: i18n.t('tab_notes'),
              ),
              NavigationDestination(
                icon: const Icon(Icons.star_outline),
                selectedIcon: const Icon(Icons.star),
                label: i18n.t('tab_favorites'),
              ),
              NavigationDestination(
                icon: const Icon(Icons.delete_outline),
                selectedIcon: const Icon(Icons.delete),
                label: i18n.t('tab_trash'),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: _createNotebook,
            icon: const Icon(Icons.add),
            label: Text(i18n.t('new_notebook')),
          ),
        );
      },
    );
  }
}

PopupMenuItem<LibrarySort> _sortItem(
    I18n i18n, LibrarySort value, String key, LibrarySort current) {
  return CheckedPopupMenuItem<LibrarySort>(
    value: value,
    checked: value == current,
    child: Text(i18n.t(key)),
  );
}
