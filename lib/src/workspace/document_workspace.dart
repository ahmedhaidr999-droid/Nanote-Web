import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';
import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../persistence/auto_saver.dart';
import 'doc_geometry.dart';
import 'gesture_router.dart';
import 'pdf_page_tile.dart';
import 'workspace_toolbar.dart';

/// الواجهة الأساسية — معمارية الطبقات الثلاث داخل تحويل واحد:
///
///   Layer 1 (الخلفية): pdfx/PDFium — رندرة متدرجة + تمرير رأسي
///   Layer 2 (الوسطى):  perfect_freehand — حبر شفاف فوق كل صفحة
///   Layer 3 (الموحدة): Transform واحد يكبّر/يحرّك الطبقتين معاً
///
/// استعمال:
///   DocumentWorkspace(pdfPath: file.path)              // من مسار ملف
///   DocumentWorkspace(pdfBytes: bytes)                 // من بايتات
///   DocumentWorkspace(blankPages: 3)                   // دفتر فارغ
///   DocumentWorkspace(pdfPath: p, docId: 'note-42')    // + حفظ تلقائي
///
/// الحفظ التلقائي (عند تمرير [docId]): كل خط يُرسم أو يُمسح يُكتب إلى
/// Isar لحظة حدوثه وفي الخلفية (InkAutoSaver) — دون أي تأثير على
/// الانسيابية، ودون فقدان أي شيء عند إغلاق الشاشة.
class DocumentWorkspace extends StatefulWidget {
  const DocumentWorkspace({
    super.key,
    this.pdfPath,
    this.pdfAsset,
    this.pdfBytes,
    this.blankPages = 0,
    this.showToolbar = true,
    this.tools,
    this.docId,
  }) : assert(
          pdfPath != null || pdfAsset != null || pdfBytes != null || blankPages > 0,
          'Provide a PDF source or a positive blankPages count.',
        );

  final String? pdfPath;
  final String? pdfAsset;
  final Uint8List? pdfBytes;
  final int blankPages;
  final bool showToolbar;

  /// احقن متحكم أدوات خارجياً إذا أردت التحكم من واجهتك الخاصة.
  final ToolController? tools;

  /// عند تمريره يُفعَّل الحفظ التلقائي التزايدي للحبر عبر Isar.
  final String? docId;

  @override
  State<DocumentWorkspace> createState() => _DocumentWorkspaceState();
}

class _DocumentWorkspaceState extends State<DocumentWorkspace> {
  late final PdfDocumentController pdf = PdfDocumentController();
  late final ViewportController viewport = ViewportController();
  late final StrokeEngine engine = StrokeEngine();
  late final ToolController tools = widget.tools ?? ToolController();
  late final bool _ownsTools = widget.tools == null;

  DocGeometry? _geometry;

  late final GestureRouter router = GestureRouter(
    viewport: viewport,
    engine: engine,
    tools: tools,
    // fallback آمن قبل أول بناء (أي إيماءة لا تحدث قبل البناء أصلاً)
    geometry: () => _geometry ?? DocGeometry(docWidth: 1, pdf: pdf),
  );

  InkAutoSaver? _autoSaver;

  // مزامنة المتحكمات بعد اكتمال الإطار (لا notify خلال البناء)
  bool _syncScheduled = false;
  Size? _pendingViewportSize;
  double? _pendingDocHeight;
  double? _pendingDpr;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    final w = widget;
    if (w.blankPages > 0) {
      await pdf.openBlank(pages: w.blankPages);
    } else if (w.pdfPath != null) {
      await pdf.open(path: w.pdfPath);
    } else if (w.pdfBytes != null) {
      await pdf.open(bytes: w.pdfBytes);
    } else if (w.pdfAsset != null) {
      await pdf.open(asset: w.pdfAsset);
    }
    if (w.docId != null) {
      await _initPersistence();
    }
    if (mounted) setState(() {});
  }

  /// فتح قاعدة الحبر وتفعيل الحفظ التلقائي التزايدي: الحبر المحفوظ
  /// يُحمَّل أولاً ثم يُفعَّل الخطاف — بهذا الترتيب لا تُعاد كتابة ما
  /// حُمِّل للتو عند بدء التشغيل.
  Future<void> _initPersistence() async {
    _autoSaver = await InkAutoSaver.attach(engine, widget.docId!);
  }

  @override
  void dispose() {
    // تصريف كل الكتابات المعلقة ثم إسقاط الحفظ — الانتظار يجري في
    // الخلفية فلا يجمّد إغلاق الشاشة، لكنه يضمن ألا يضيع شيء.
    final saver = _autoSaver;
    _autoSaver = null;
    if (saver != null) {
      unawaited(saver.dispose());
    }
    pdf.dispose();
    viewport.dispose();
    engine.dispose();
    if (_ownsTools) tools.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewportSize = constraints.biggest;
        final dpr = MediaQuery.of(context).devicePixelRatio;

        final geometry = DocGeometry(docWidth: viewportSize.width, pdf: pdf);
        _geometry = geometry;
        _scheduleControllerSync(viewportSize, geometry.docHeight, dpr);

        return Scaffold(
          backgroundColor: const Color(0xFFEDEDF2),
          bottomNavigationBar: widget.showToolbar
              ? WorkspaceToolbar(
                  tools: tools,
                  engine: engine,
                  viewport: viewport,
                  pdf: pdf,
                  geometry: () => _geometry ?? geometry,
                )
              : null,
          body: _buildBody(geometry),
        );
      },
    );
  }

  /// تحديث المتحكمات بعد اكتمال الإطار بأحدث القيم (يُدوَّر بنفس الإطار
  /// عدة مرات دون جدولة مكررة — دائماً تُستخدم آخر قيمة).
  void _scheduleControllerSync(
      Size viewportSize, double docHeight, double dpr) {
    _pendingViewportSize = viewportSize;
    _pendingDocHeight = docHeight;
    _pendingDpr = dpr;
    if (_syncScheduled) return;
    _syncScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _syncScheduled = false;
      if (!mounted) return;
      final size = _pendingViewportSize;
      if (size == null) return;
      viewport.viewportSize = size;
      viewport.docSize = Size(size.width, _pendingDocHeight ?? size.width);
      pdf.configure(basePixelWidth: size.width * (_pendingDpr ?? 1));
      _pendingViewportSize = null;
    });
  }

  Widget _buildBody(DocGeometry geometry) {
    if (pdf.error != null) {
      return _Message(
        icon: Icons.error_outline,
        text: 'تعذّر فتح المستند',
        sub: pdf.error,
      );
    }
    if (!pdf.isReady) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    if (geometry.pageCount == 0) {
      return const _Message(text: 'المستند لا يحتوي صفحات');
    }

    final pages = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < geometry.pageCount; i++) ...[
          if (i > 0) const SizedBox(height: DocGeometry.gap),
          PdfPageTile(
            page: i,
            size: geometry.logical(i),
            pdf: pdf,
            viewport: viewport,
            engine: engine,
            tools: tools,
            geometry: geometry,
          ),
        ],
      ],
    );

    return Listener(
      behavior: HitTestBehavior.opaque,
      // كل التوجيه بلا GestureArena — سلوك حتمي على كل المنصات
      onPointerDown: router.onDown,
      onPointerMove: router.onMove,
      onPointerUp: router.onUp,
      onPointerCancel: router.onCancel,
      onPointerSignal: router.onSignal,
      onPointerPanZoomStart: router.onPanZoomStart,
      onPointerPanZoomUpdate: router.onPanZoomUpdate,
      onPointerPanZoomEnd: router.onPanZoomEnd,
      child: ClipRect(
        child: AnimatedBuilder(
          animation: viewport,
          // child مُخزَّن: أثناء التكبير يُحدَّث الـ Transform فقط ولا
          // تُعاد بناء أي صفحة — وهذا جوهر انسيابية 60/120fps.
          child: SizedBox(
            width: geometry.docWidth,
            height: geometry.docHeight,
            child: pages,
          ),
          builder: (context, child) {
            _prefetchVisible(geometry);
            return Transform(transform: viewport.matrix, child: child);
          },
        ),
      ),
    );
  }

  /// نافذة الرندرة: الصفحات المرئية ± صفحة بدقة الأساس —
  /// استدعاءات مُزالة التكرار بالكامل (رخيصة لدرجة استدعائها كل إطار).
  void _prefetchVisible(DocGeometry g) {
    if (g.pageCount == 0) return;
    final rect = viewport.visibleDocRect;
    var first = g.pageAt(rect.topLeft);
    if (first < 0) first = rect.topLeft.dy <= 0 ? 0 : g.pageCount - 1;
    var last = g.pageAt(rect.bottomRight);
    if (last < 0) last = g.pageCount - 1;
    first = math.max(0, first - 1);
    last = math.min(g.pageCount - 1, last + 1);
    for (var i = first; i <= last; i++) {
      pdf.ensureRendered(i, 1.0);
    }
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.sub, this.icon = Icons.info_outline});

  final String text;
  final String? sub;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 42, color: Colors.black38),
          const SizedBox(height: 12),
          Text(text, style: Theme.of(context).textTheme.titleMedium),
          if (sub != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                sub!,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }
}
