import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../app/settings_controller.dart';
import '../controllers/tool_controller.dart';
import '../models/library_prefs.dart';
import '../persistence/document_entity.dart';
import '../persistence/library_repository.dart';
import '../settings/settings_screen.dart';
import '../workspace/document_workspace.dart';
import 'library_controller.dart';

/// شاشة المكتبة — النسخة الأصلية من مدير ملفات التطبيق القديم
/// (File Browser v1.9.0) مبنية Native: شبكة/قائمة، فرز، فلاتر،
/// مفضلة، إنشاء دفاتر، استيراد PDF — وكل مستند يفتح مساحة العمل
/// الجديدة document_workspace.dart بحفظ تلقائي كامل.
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, required this.settings});

  final SettingsController settings;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  LibraryController? _controller;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final repo = await LibraryRepository.open();
    final controller = LibraryController(repo, widget.settings);
    _controller = controller;
    await controller.reload();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return AnimatedBuilder(
      animation: Listenable.merge([controller, widget.settings]),
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          title: const Text('نانوت'),
          actions: [
            IconButton(
              tooltip: 'تبديل العرض',
              onPressed: () =>
                  widget.settings.libraryView =
                      widget.settings.libraryView == LibraryView.grid
                          ? LibraryView.list
                          : LibraryView.grid,
              icon: Icon(widget.settings.libraryView == LibraryView.grid
                  ? Icons.view_list_outlined
                  : Icons.grid_view_outlined),
            ),
            PopupMenuButton<LibrarySort>(
              tooltip: 'الترتيب',
              icon: const Icon(Icons.sort_outlined),
              initialValue: widget.settings.librarySort,
              onSelected: (v) => widget.settings.librarySort = v,
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: LibrarySort.updatedDesc,
                  child: Text('آخر تحديث'),
                ),
                PopupMenuItem(
                  value: LibrarySort.createdDesc,
                  child: Text('الأحدث إنشاءً'),
                ),
                PopupMenuItem(
                  value: LibrarySort.titleAsc,
                  child: Text('العنوان'),
                ),
              ],
            ),
            IconButton(
              tooltip: 'الإعدادات',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => SettingsScreen(settings: widget.settings),
                ),
              ),
              icon: const Icon(Icons.settings_outlined),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _showCreateSheet,
          icon: const Icon(Icons.add),
          label: const Text('جديد'),
        ),
        body: Column(
          children: [
            _FilterBar(controller: controller),
            const Divider(height: 1),
            Expanded(
              child: _Body(
                controller: controller,
                settings: widget.settings,
                onOpen: _open,
                onRename: _rename,
                onDelete: _delete,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ───────────────────────── الإجراءات ─────────────────────────

  Future<void> _showCreateSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.book_outlined),
              title: const Text('دفتر جديد'),
              subtitle: const Text('صفحات بيضاء جاهزة للكتابة'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _showCreateNotebookDialog();
              },
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('استيراد PDF'),
              subtitle: const Text('اختيار ملف من الجهاز'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _importPdf();
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showCreateNotebookDialog() async {
    final titleController = TextEditingController();
    var pages = widget.settings.defaultPageCount;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('دفتر جديد'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleController,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'العنوان',
                  hintText: 'مثال: محاضرات الرياضيات',
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Text('الصفحات'),
                  Expanded(
                    child: Slider(
                      value: pages.toDouble(),
                      min: 1,
                      max: 100,
                      divisions: 99,
                      label: '$pages',
                      onChanged: (v) =>
                          setDialogState(() => pages = v.round()),
                    ),
                  ),
                  SizedBox(
                    width: 36,
                    child: Text('$pages', textAlign: TextAlign.center),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('إنشاء'),
            ),
          ],
        ),
      ),
    );
    if (created != true) return;
    final title = titleController.text.trim();
    titleController.dispose();
    await _controller?.createNotebook(
      title.isEmpty ? 'دفتر بدون عنوان' : title,
      pages,
    );
  }

  Future<void> _importPdf() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    final path = result?.files.single.path;
    if (path == null) return;
    final controller = _controller;
    if (controller == null) return;
    try {
      final doc = await controller.importPdf(path, null);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم استيراد «${doc.title}»')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذّر الاستيراد: $e')),
        );
      }
    }
  }

  Future<void> _open(DocumentEntity doc) async {
    final controller = _controller;
    if (controller == null) return;
    await controller.touch(doc.id);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DocumentOpener(doc: doc, settings: widget.settings),
      ),
    );
    await controller.reload();
  }

  Future<void> _rename(DocumentEntity doc) async {
    final controller = TextEditingController(text: doc.title);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('إعادة تسمية'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'العنوان'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('حفظ'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final title = controller.text;
    controller.dispose();
    await _controller?.rename(doc, title);
  }

  Future<void> _delete(DocumentEntity doc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('حذف المستند؟'),
        content: Text('سيُحذف «${doc.title}» وكل ما كُتب فيه نهائياً.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('إلغاء'),
          ),
          FilledButton.tonal(
            style: FilledButton.styleFrom(
              foregroundColor: Theme.of(dialogContext).colorScheme.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _controller?.delete(doc);
  }
}

// ───────────────────────── القطع ─────────────────────────

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.controller});

  final LibraryController controller;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        children: [
          for (final f in LibraryFilter.values)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 8),
              child: FilterChip(
                label: Text(switch (f) {
                  LibraryFilter.all => 'الكل',
                  LibraryFilter.notes => 'دفاتري',
                  LibraryFilter.pdfs => 'PDF',
                  LibraryFilter.favorites => 'المفضلة',
                }),
                selected: controller.filter == f,
                onSelected: (_) => controller.setFilter(f),
              ),
            ),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.controller,
    required this.settings,
    required this.onOpen,
    required this.onRename,
    required this.onDelete,
  });

  final LibraryController controller;
  final SettingsController settings;
  final void Function(DocumentEntity) onOpen;
  final void Function(DocumentEntity) onRename;
  final void Function(DocumentEntity) onDelete;

  @override
  Widget build(BuildContext context) {
    if (controller.loading) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    final docs = controller.visible;
    if (docs.isEmpty) {
      return _EmptyState(
        hasDocs: controller.totalCount > 0,
        filter: controller.filter,
      );
    }
    if (settings.libraryView == LibraryView.list) {
      return ListView.separated(
        padding: const EdgeInsets.only(bottom: 96),
        itemCount: docs.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 16, endIndent: 16),
        itemBuilder: (context, i) => _DocTile(
          doc: docs[i],
          controller: controller,
          onOpen: () => onOpen(docs[i]),
          onRename: () => onRename(docs[i]),
          onDelete: () => onDelete(docs[i]),
        ),
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.all(12).copyWith(bottom: 96),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 240,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 0.78,
      ),
      itemCount: docs.length,
      itemBuilder: (context, i) => _DocCard(
        doc: docs[i],
        controller: controller,
        onOpen: () => onOpen(docs[i]),
        onRename: () => onRename(docs[i]),
        onDelete: () => onDelete(docs[i]),
      ),
    );
  }
}

class _DocCard extends StatelessWidget {
  const _DocCard({
    required this.doc,
    required this.controller,
    required this.onOpen,
    required this.onRename,
    required this.onDelete,
  });

  final DocumentEntity doc;
  final LibraryController controller;
  final VoidCallback onOpen;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isPdf = doc.kind == 1;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Container(
                    color: scheme.surfaceContainerHighest,
                    alignment: Alignment.center,
                    child: Icon(
                      isPdf
                          ? Icons.picture_as_pdf_outlined
                          : Icons.book_outlined,
                      size: 44,
                      color: isPdf ? scheme.error : scheme.primary,
                    ),
                  ),
                  Positioned.directional(
                    textDirection: Directionality.of(context),
                    top: 0,
                    end: 0,
                    child: IconButton(
                      tooltip:
                          doc.favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة',
                      onPressed: () => controller.toggleFavorite(doc),
                      icon: Icon(
                        doc.favorite ? Icons.star : Icons.star_border,
                        color: doc.favorite ? Colors.amber : scheme.outline,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: Text(
                doc.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Row(
                children: [
                  Icon(
                    isPdf
                        ? Icons.picture_as_pdf_outlined
                        : Icons.description_outlined,
                    size: 14,
                    color: scheme.outline,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${doc.pageCount} صفحة · ${_relativeTime(doc.updatedAt)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    onSelected: (v) {
                      if (v == 'rename') onRename();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                          value: 'rename', child: Text('إعادة تسمية')),
                      PopupMenuItem(value: 'delete', child: Text('حذف')),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DocTile extends StatelessWidget {
  const _DocTile({
    required this.doc,
    required this.controller,
    required this.onOpen,
    required this.onRename,
    required this.onDelete,
  });

  final DocumentEntity doc;
  final LibraryController controller;
  final VoidCallback onOpen;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isPdf = doc.kind == 1;
    return ListTile(
      onTap: onOpen,
      leading: CircleAvatar(
        child: Icon(
          isPdf ? Icons.picture_as_pdf_outlined : Icons.book_outlined,
          color: isPdf ? scheme.error : scheme.primary,
        ),
      ),
      title: Text(
        doc.title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '${doc.pageCount} صفحة · ${_relativeTime(doc.updatedAt)}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: doc.favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة',
            onPressed: () => controller.toggleFavorite(doc),
            icon: Icon(
              doc.favorite ? Icons.star : Icons.star_border,
              color: doc.favorite ? Colors.amber : scheme.outline,
            ),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'rename') onRename();
              if (v == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'rename', child: Text('إعادة تسمية')),
              PopupMenuItem(value: 'delete', child: Text('حذف')),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.hasDocs, required this.filter});

  final bool hasDocs;
  final LibraryFilter filter;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            hasDocs
                ? Icons.filter_alt_off_outlined
                : Icons.library_books_outlined,
            size: 56,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 12),
          Text(
            hasDocs
                ? 'لا نتائج مطابقة لهذا الفلتر'
                : switch (filter) {
                    LibraryFilter.all => 'مكتبتك فارغة',
                    LibraryFilter.notes => 'لا دفاتر بعد',
                    LibraryFilter.pdfs => 'لا ملفات PDF بعد',
                    LibraryFilter.favorites => 'لا مفضلات بعد',
                  },
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            hasDocs ? 'جرّب فلتراً آخر' : 'أنشئ دفتراً جديداً أو استورد PDF',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

/// غلاف مساحة العمل لمستند من المكتبة: يفتح document_workspace
/// بالحفظ التلقائي (docId) ويضيف زر رجوع عائماً — والقلم الافتراضي
/// يأتي من الإعدادات.
class DocumentOpener extends StatefulWidget {
  const DocumentOpener({super.key, required this.doc, required this.settings});

  final DocumentEntity doc;
  final SettingsController settings;

  @override
  State<DocumentOpener> createState() => _DocumentOpenerState();
}

class _DocumentOpenerState extends State<DocumentOpener> {
  late final ToolController _tools = ToolController(
    color: widget.settings.penColor,
    size: widget.settings.penSize,
  );

  String? _pdfPath;
  bool _pdfMissing = false;

  @override
  void initState() {
    super.initState();
    _resolvePdf();
  }

  Future<void> _resolvePdf() async {
    if (widget.doc.kind != 1) return;
    final repo = await LibraryRepository.open();
    final path = await repo.pdfPathOf(widget.doc);
    if (!mounted) return;
    setState(() {
      _pdfPath = path;
      _pdfMissing = path == null;
    });
  }

  @override
  void dispose() {
    _tools.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.doc;
    if (doc.kind == 1 && _pdfMissing) {
      return Scaffold(
        appBar: AppBar(title: Text(doc.title)),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 42, color: Colors.black38),
              const SizedBox(height: 12),
              const Text('ملف PDF مفقود'),
              TextButton(
                onPressed: () => Navigator.of(context).maybePop(),
                child: const Text('رجوع إلى المكتبة'),
              ),
            ],
          ),
        ),
      );
    }
    final pdfPath = _pdfPath;
    final ready = doc.kind == 0 || pdfPath != null;
    return Stack(
      children: [
        if (ready)
          DocumentWorkspace(
            docId: doc.docId,
            pdfPath: doc.kind == 1 ? pdfPath : null,
            blankPages: doc.kind == 0 ? doc.pageCount : 0,
            tools: _tools,
          )
        else
          const Scaffold(
            body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ),
        Positioned(
          top: 6,
          left: 6,
          child: SafeArea(
            child: IconButton.filledTonal(
              tooltip: 'رجوع إلى المكتبة',
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.arrow_back),
            ),
          ),
        ),
      ],
    );
  }
}

/// وقت نسبي مختصر بالعربية لعرض "آخر تحديث".
String _relativeTime(int millis) {
  final dt = DateTime.fromMillisecondsSinceEpoch(millis);
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'الآن';
  if (diff.inHours < 1) return 'قبل ${diff.inMinutes} دقيقة';
  if (diff.inDays < 1) return 'قبل ${diff.inHours} ساعة';
  if (diff.inDays == 1) return 'أمس';
  if (diff.inDays < 7) return 'قبل ${diff.inDays} أيام';
  final d = dt.day.toString().padLeft(2, '0');
  final m = dt.month.toString().padLeft(2, '0');
  return '${dt.year}/$m/$d';
}
