import 'dart:async';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../controllers/audio_controller.dart';
import '../controllers/laser_controller.dart';
import '../controllers/pdf_document_controller.dart';
import '../controllers/settings_controller.dart';
import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../i18n/strings.dart';
import '../models/library_models.dart';
import '../models/page_elements.dart';
import '../models/settings.dart';
import '../models/tool.dart';
import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';
import '../services/export_service.dart';
import '../services/image_cache.dart';
import '../theme/nanote_theme.dart';
import '../ui/sheets/audio_panel.dart';
import '../ui/sheets/pages_sheet.dart';
import '../ui/sheets/sticker_picker.dart';
import '../ui/sheets/text_edit_sheet.dart';
import '../ui/sheets/translate_popup.dart';
import 'doc_geometry.dart';
import 'filmstrip.dart';
import 'gesture_router.dart';
import 'ink_painter.dart';
import 'elements_painter.dart';
import 'paper_painter.dart';
import 'pdf_page_tile.dart';
import 'ruler_overlay.dart';
import 'tool_rail.dart';

/// The notebook editor: transformed page stack + gesture router + tool rail
/// + filmstrip + all sheets. Owns the per-session controllers.
class WorkspaceScreen extends StatefulWidget {
  final NotebookRow notebook;
  final LibraryRepository repo;
  final FileStore fs;
  final AppImageCache images;
  final SettingsController settings;

  const WorkspaceScreen({
    super.key,
    required this.notebook,
    required this.repo,
    required this.fs,
    required this.images,
    required this.settings,
  });

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen>
    implements ToolActionHost {
  late List<PageRow> pages;
  late PdfLibrary pdfs;
  late ViewportController viewport;
  late StrokeEngine engine;
  late ToolController tools;
  late LaserController laser;
  late RulerModel ruler;
  late AudioController audio;
  late ExportService exporter;
  late DocGeometry geometry;
  StreamSubscription? _repoSub;
  bool _fitted = false;
  bool _exporting = false;

  static const double docWidth = 794;

  @override
  void initState() {
    super.initState();
    pages = widget.repo.visiblePages(widget.notebook.id);
    pdfs = PdfLibrary();
    viewport = ViewportController();
    engine = StrokeEngine(widget.repo.pages);
    tools = ToolController();
    laser = LaserController();
    ruler = RulerModel();
    audio = AudioController(widget.repo, widget.fs, engine);
    exporter = ExportService(widget.fs, widget.repo, () => widget.settings.s);
    geometry = _buildGeometry();
    _openPdfs();
    if (pages.isNotEmpty) {
      engine.setCurrentPage(pages.first.id);
    }
    widget.repo.touchNotebook(widget.notebook);
    _repoSub = widget.repo.changes.listen((_) => _syncPages());
  }

  DocGeometry _buildGeometry() =>
      DocGeometry(pages: pages, pdfs: pdfs, docWidth: docWidth);

  void _openPdfs() {
    for (final p in pages) {
      final key = p.pdfFileId;
      if (key == null || pdfs.controllerOf(key) != null) continue;
      final bytes = widget.repo.pdfBytes(key);
      if (bytes != null) pdfs.openCached(key, bytes);
    }
  }

  void _syncPages() {
    if (!mounted) return;
    setState(() {
      pages = widget.repo.visiblePages(widget.notebook.id);
      _openPdfs();
      geometry = _buildGeometry();
    });
  }

  @override
  void dispose() {
    _repoSub?.cancel();
    audio.dispose();
    laser.dispose();
    tools.dispose();
    viewport.dispose();
    pdfs.dispose();
    super.dispose();
  }

  // ───────────────────────── ToolActionHost ─────────────────────────

  @override
  void undoAction() => engine.undo();

  @override
  void redoAction() => engine.redo();

  @override
  void toggleRulerAction() {
    if (ruler.active) {
      ruler.toggle();
    } else {
      ruler.showAt(viewport.screenToDoc(
          Offset(viewport.viewportSize.width / 2,
              viewport.viewportSize.height / 2)));
    }
  }

  @override
  void selectAllAction() => engine.selectAll();

  @override
  void clearSelectionAction() => engine.clearSelection();

  @override
  void newPageAction() => _addPageAfterCurrent();

  // ───────────────────────── pages ─────────────────────────

  int get _currentIndex {
    final id = engine.currentPageId;
    final i = pages.indexWhere((p) => p.id == id);
    return i < 0 ? 0 : i;
  }

  void _addPageAfterCurrent() {
    final cur = pages.isEmpty ? null : pages[_currentIndex];
    widget.repo.addPage(widget.notebook.id, afterSortIndex: cur?.sortIndex);
  }

  Future<void> _goToPage(int index) async {
    if (index < 0 || index >= pages.length) return;
    engine.setCurrentPage(pages[index].id);
    setState(() {});
    // let layout settle, then center the page
    await Future<void>.delayed(const Duration(milliseconds: 30));
    final top = geometry.pageTop(index);
    viewport.centerOn(Offset(docWidth / 2, top + geometry.pageHeight(index) / 2));
  }

  // ───────────────────────── sheets & panels ─────────────────────────

  void _openPagesSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => PagesSheet(
        repo: widget.repo,
        notebookId: widget.notebook.id,
        currentPageId: engine.currentPageId,
        onClose: () => Navigator.of(context).pop(),
        onChanged: () => _syncPages(),
        onGoTo: (i) {
          Navigator.of(context).pop();
          _goToPage(i);
        },
      ),
    );
  }

  void _placeText(int pageIndex, Offset pagePoint) {
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    engine.setCurrentPage(pages[pageIndex].id);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => TextEditSheet(
        initial: null,
        tools: tools,
        onSave: (text, fontSize, colorValue, bold, align) {
          Navigator.of(context).pop();
          engine.addElement(TextEl(
            id: 'e${DateTime.now().microsecondsSinceEpoch}',
            x: pagePoint.dx, y: pagePoint.dy,
            w: 260, h: fontSize * 1.4 * 2,
            text: text, colorValue: colorValue,
            fontSize: fontSize, bold: bold, align: align,
          ));
        },
      ),
    );
  }

  void _editText(TextEl el, int pageIndex) {
    if (pageIndex >= 0 && pageIndex < pages.length) {
      engine.setCurrentPage(pages[pageIndex].id);
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => TextEditSheet(
        initial: el,
        tools: tools,
        onSave: (text, fontSize, colorValue, bold, align) {
          Navigator.of(context).pop();
          engine.replaceElement(
            el,
            TextEl(
              id: el.id, x: el.x, y: el.y, w: el.w, h: el.h,
              rotation: el.rotation,
              text: text, colorValue: colorValue,
              fontSize: fontSize, bold: bold, align: align,
            ),
          );
        },
      ),
    );
  }

  Future<void> _pickImage() async {
    final res = await FilePicker.platform.pickFiles(
      type: FileType.image, withData: true,
    );
    final f = res.files.firstOrNull;
    final bytes = f?.bytes;
    if (bytes == null) return;
    final key = await widget.fs.saveBytesAs('images', '.png', bytes);
    // decode to get the aspect ratio
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final img = frame.image;
    final w = 320.0;
    final h = w * img.height / img.width;
    img.dispose();
    final center = _currentPageCenterPoints();
    engine.addElement(ImageEl(
      id: 'e${DateTime.now().microsecondsSinceEpoch}',
      x: center.dx - w / 2, y: center.dy - h / 2, w: w, h: h,
      fileKey: key,
    ));
    tools.setTool(Tool.selector);
  }

  Offset _currentPageCenterPoints() {
    final idx = _currentIndex;
    if (idx >= pages.length) return const Offset(300, 380);
    final pt = geometry.pointSizeOf(pages[idx]);
    return Offset(pt.width / 2, pt.height / 2);
  }

  void _pickSticker() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => StickerPickerSheet(
        repo: widget.repo,
        onPick: (emoji, sticker) async {
          Navigator.of(context).pop();
          if (emoji != null) {
            final center = _currentPageCenterPoints();
            engine.addElement(ImageEl(
              id: 'e${DateTime.now().microsecondsSinceEpoch}',
              x: center.dx - 48, y: center.dy - 48, w: 96, h: 96,
              emoji: emoji, isSticker: true,
            ));
          } else if (sticker?.fileKey != null) {
            final bytes =
                await widget.fs.tryReadBytes('stickers', sticker!.fileKey!);
            double w = 120, h = 120;
            if (bytes != null) {
              final codec = await ui.instantiateImageCodec(bytes);
              final frame = await codec.getNextFrame();
              h = w * frame.image.height / frame.image.width;
              frame.image.dispose();
            }
            final center = _currentPageCenterPoints();
            engine.addElement(ImageEl(
              id: 'e${DateTime.now().microsecondsSinceEpoch}',
              x: center.dx - w / 2, y: center.dy - h / 2, w: w, h: h,
              fileKey: sticker.fileKey, isSticker: true,
            ));
          }
          tools.setTool(Tool.selector);
        },
      ),
    );
  }

  void _openAudioPanel() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => AudioPanelSheet(
        audio: audio,
        pageId: engine.currentPageId ?? pages.first.id,
      ),
    );
  }

  void _openTranslate() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => TranslateSheet(
        engine: engine,
        tools: tools,
        settings: widget.settings,
      ),
    );
  }

  // ───────────────────────── export ─────────────────────────

  Future<ui.Image?> _renderPage(PageRow page, double pixelWidth) async {
    final idx = pages.indexOf(page);
    if (idx < 0) return null;
    final ptSize = geometry.pointSizeOf(page);
    engine.clearSelection();
    ui.Image? pdfImg;
    if (page.isPdf) {
      final c = pdfs.controllerOf(page.pdfFileId!);
      pdfImg = await c?.renderOnce(page.pdfIndex ?? 0, pixelWidth);
    }
    final doc = widget.repo.pages.load(page.id);
    final img = await ExportService.rasterize(
      logicalSize: ptSize,
      pixelWidth: pixelWidth,
      painter: (canvas, size) {
        if (pdfImg != null) {
          canvas.drawImageRect(
            pdfImg,
            Rect.fromLTWH(0, 0,
                pdfImg.width.toDouble(), pdfImg.height.toDouble()),
            Offset.zero & size,
            Paint()..filterQuality = FilterQuality.high,
          );
        } else if (page.isPdf) {
          canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
        } else {
          PaperPainter(template: page.template, dark: false)
              .paint(canvas, size);
        }
        InkPainter(
          doc: doc, liveStroke: null, pointScale: 1,
          selectionColor: Colors.transparent, dark: false,
        ).paint(canvas, size);
        ElementsPainter(
          elements: doc.elements, images: widget.images,
          pointScale: 1, screenScale: pixelWidth / ptSize.width,
          selectionColor: Colors.transparent, dark: false,
        ).paint(canvas, size);
      },
    );
    pdfImg?.dispose();
    return img;
  }

  Future<void> _exportPng() async {
    if (pages.isEmpty || _exporting) return;
    setState(() => _exporting = true);
    try {
      final page = pages[_currentIndex];
      await exporter.exportPng(page, _renderPage);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _exportPdf() async {
    if (_exporting) return;
    setState(() => _exporting = true);
    try {
      await exporter.exportPdf(widget.notebook.id, _renderPage);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  // ───────────────────────── build ─────────────────────────

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final i18n = I18n.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        leading: BackButton(onPressed: () => Navigator.of(context).pop()),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              widget.notebook.title,
              maxLines: 1, overflow: TextOverflow.ellipsis,
              style: theme.appBarTheme.titleTextStyle,
            ),
            Text(
              '${i18n.t('page')} ${i18n.num(_currentIndex + 1)} '
              '/ ${i18n.num(pages.length)}',
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: colors.textMuted),
            ),
          ],
        ),
        actions: [
          ListenableBuilder(
            listenable: Listenable.merge([engine, ruler]),
            builder: (_, __) => Row(children: [
              IconButton(
                tooltip: i18n.t('undo'),
                onPressed: engine.canUndo ? engine.undo : null,
                icon: const Icon(Icons.undo_rounded),
              ),
              IconButton(
                tooltip: i18n.t('redo'),
                onPressed: engine.canRedo ? engine.redo : null,
                icon: const Icon(Icons.redo_rounded),
              ),
              IconButton(
                tooltip: i18n.t('tool_ruler'),
                isSelected: ruler.active,
                onPressed: toggleRulerAction,
                icon: const Icon(Icons.straighten_rounded),
              ),
            ]),
          ),
          IconButton(
            tooltip: i18n.t('page_manager'),
            onPressed: _openPagesSheet,
            icon: const Icon(Icons.layers_rounded),
          ),
          PopupMenuButton<String>(
            tooltip: i18n.t('more'),
            onSelected: (v) {
              switch (v) {
                case 'png': _exportPng();
                case 'pdf': _exportPdf();
                case 'audio': _openAudioPanel();
                case 'translate': _openTranslate();
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'png',
                enabled: !_exporting,
                child: Text(i18n.t('export_png')),
              ),
              PopupMenuItem(
                value: 'pdf',
                enabled: !_exporting,
                child: Text(i18n.t('export_pdf')),
              ),
              const PopupMenuDivider(),
              PopupMenuItem(
                value: 'audio',
                child: Text(i18n.t('tool_audio')),
              ),
              PopupMenuItem(
                value: 'translate',
                child: Text(i18n.t('tool_translate')),
              ),
            ],
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          if (viewport.viewportSize != size) {
            viewport.resize(size);
            if (!_fitted && geometry.docWidth > 0) {
              _fitted = true;
              viewport.fitWidth(geometry.docWidth);
            }
          }
          return Row(children: [
            // filmstrip rail
            Filmstrip(
              pages: pages,
              current: _currentIndex,
              onSelect: _goToPage,
              onAdd: _addPageAfterCurrent,
            ),
            // canvas
            Expanded(
              child: GestureRouter(
                geometry: geometry,
                viewport: viewport,
                engine: engine,
                tools: tools,
                laser: laser,
                ruler: ruler,
                pdfs: pdfs,
                settings: widget.settings.s,
                host: this,
                onPlaceText: _placeText,
                onEditText: _editText,
                child: ClipRect(
                  child: AnimatedBuilder(
                    animation: viewport,
                    child: _DocCanvas(
                      geometry: geometry,
                      pages: pages,
                      pdfs: pdfs,
                      viewport: viewport,
                      engine: engine,
                      images: widget.images,
                      dark: theme.brightness == Brightness.dark,
                      laser: laser,
                      laserColor: kLaserPalette[tools.laserColorIdx
                          .clamp(0, kLaserPalette.length - 1)],
                    ),
                    builder: (context, child) {
                      final m = Matrix4.identity()
                        ..translate(size.width / 2, size.height / 2)
                        ..scale(viewport.scale)
                        ..translate(-viewport.focalDoc.dx,
                            -viewport.focalDoc.dy);
                      return Transform(
                        transform: m,
                        alignment: Alignment.topLeft,
                        child: child,
                      );
                    },
                  ),
                ),
              ),
            ),
          ]);
        },
      ),
      bottomNavigationBar: ToolRail(
        tools: tools,
        engine: engine,
        ruler: ruler,
        onPanelTool: _handlePanelTool,
        onRenameNotebook: () => _renameNotebook(),
      ),
    );
  }

  void _handlePanelTool(Tool t) {
    switch (t) {
      case Tool.image: _pickImage();
      case Tool.sticker: _pickSticker();
      case Tool.audio: _openAudioPanel();
      case Tool.translate: _openTranslate();
      default: break;
    }
  }

  Future<void> _renameNotebook() async {
    final i18n = I18n.of(context);
    final ctrl = TextEditingController(text: widget.notebook.title);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(i18n.t('rename_notebook')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(hintText: i18n.t('notebook_name')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(i18n.t('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(ctrl.text.trim()),
            child: Text(i18n.t('save')),
          ),
        ],
      ),
    );
    if (name != null && name.isNotEmpty) {
      widget.repo.renameNotebook(widget.notebook, name);
    }
  }
}

/// The transformed document: vertical page stack + laser overlay (doc space).
class _DocCanvas extends StatelessWidget {
  final DocGeometry geometry;
  final List<PageRow> pages;
  final PdfLibrary pdfs;
  final ViewportController viewport;
  final StrokeEngine engine;
  final AppImageCache images;
  final bool dark;
  final LaserController laser;
  final Color laserColor;

  const _DocCanvas({
    required this.geometry, required this.pages, required this.pdfs,
    required this.viewport, required this.engine, required this.images,
    required this.dark, required this.laser, required this.laserColor,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final laserColor = this.laserColor;
    return SizedBox(
      width: geometry.docWidth,
      height: geometry.docHeight + 40,
      child: Stack(children: [
        Positioned.fill(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < pages.length; i++) ...[
                  if (i > 0) SizedBox(height: DocGeometry.gap),
                  PageTile(
                    index: i, page: pages[i], geometry: geometry,
                    pdfs: pdfs, viewport: viewport, engine: engine,
                    images: images, dark: dark,
                  ),
                ],
              ],
            ),
          ),
        ),
        // laser trail (doc space — sticks to content while panning)
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: laser,
              builder: (_, __) => CustomPaint(
                painter: LaserOverlayPainter(
                  points: laser.render(),
                  color: laserColor,
                  widthDoc: 5 / viewport.scale *
                      (geometry.pages.isEmpty ? 1 : geometry.pointScale(0)),
                  docScale: viewport.scale,
                ),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
