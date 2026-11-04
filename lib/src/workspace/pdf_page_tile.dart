import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';
import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import 'doc_geometry.dart';
import 'ink_painter.dart';

/// صفحة واحدة = طبقتان متراكبتان بنفس الحجم والإحداثيات بالضبط:
///   1) الطبقة الخلفية: صورة PDFium (أو placeholder أثناء الرندرة)
///   2) الطبقة الوسطى: CustomPaint الحبر الشفاف
///
/// بلاطة الصفحة لا تُعاد بناؤها أثناء التكبير إطلاقاً — مستمعها يستهدف
/// إشعار "الاستقرار" فقط (settleChanges)، فتظل الصورة الحالية تُكبَّر
/// بمصفوفة GPU حتى تكتمل النسخة الأدق بعد توقف الإصبعين.
class PdfPageTile extends StatelessWidget {
  const PdfPageTile({
    super.key,
    required this.page,
    required this.size,
    required this.pdf,
    required this.viewport,
    required this.engine,
    required this.tools,
    required this.geometry,
  });

  final int page;
  final Size size;
  final PdfDocumentController pdf;
  final ViewportController viewport;
  final StrokeEngine engine;
  final ToolController tools;
  final DocGeometry geometry;

  @override
  Widget build(BuildContext context) {
    return SizedBox.fromSize(
      size: size,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border.fromBorderSide(
            BorderSide(color: Colors.black12, width: 0.5),
          ),
          boxShadow: [
            BoxShadow(
              color: Color(0x14000000),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: ClipRect(
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (!pdf.isBlank)
                ListenableBuilder(
                  listenable: Listenable.merge([pdf, viewport.settleChanges]),
                  builder: (context, _) => _buildBitmap(context),
                ),
              // الطبقة الوسطى الشفافة — فوق الـ PDF تماماً
              CustomPaint(
                painter: InkPainter(
                  engine: engine,
                  tools: tools,
                  viewport: viewport,
                  geometry: geometry,
                  page: page,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBitmap(BuildContext context) {
    final dpr = MediaQuery.of(context).devicePixelRatio;
    final bucket = pdf.bucketFor(viewport.scale, dpr);

    final img = pdf.pickBitmap(page, bucket);
    if (img == null) {
      // أول ظهور للصفحة → اطلب رندرة فورية (حتى أثناء الحركة)
      pdf.ensureRendered(page, bucket);
      return const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }

    // ترقية الدقة فقط بعد استقرار التكبير (لا رندرة ثقيلة أثناء البنش)
    if (viewport.isSettled) {
      pdf.ensureRendered(page, bucket);
    }

    return RawImage(
      image: img,
      fit: BoxFit.fill,
      filterQuality: FilterQuality.medium,
    );
  }
}
