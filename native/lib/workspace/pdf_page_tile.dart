import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';
import '../controllers/stroke_engine.dart';
import '../controllers/viewport_controller.dart';
import '../models/library_models.dart';
import '../services/image_cache.dart';
import '../theme/nanote_theme.dart';
import 'doc_geometry.dart';
import 'elements_painter.dart';
import 'ink_painter.dart';
import 'paper_painter.dart';

/// One page tile: paper/PDF background + ink layer + elements layer.
/// Rebuilt only when the engine notifies (stroke added, selection, replay…).
class PageTile extends StatelessWidget {
  final int index;
  final PageRow page;
  final DocGeometry geometry;
  final PdfLibrary pdfs;
  final ViewportController viewport;
  final StrokeEngine engine;
  final AppImageCache images;
  final bool dark;

  const PageTile({
    super.key,
    required this.index,
    required this.page,
    required this.geometry,
    required this.pdfs,
    required this.viewport,
    required this.engine,
    required this.images,
    required this.dark,
  });

  @override
  Widget build(BuildContext context) {
    final colors = NanoteColors.of(context);
    final logical = Size(geometry.docWidth, geometry.pageHeight(index));
    final doc = engine.store.load(page.id);
    final isCurrent = engine.currentPageId == page.id;

    return SizedBox.fromSize(
      size: logical,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: dark ? const Color(0xFF101A28) : Colors.white,
          borderRadius: BorderRadius.circular(3),
          border: Border.all(
            color: colors.border,
            width: 0.5,
          ),
          boxShadow: [
            BoxShadow(
              color: colors.scrim.withValues(alpha: 0.35),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: Stack(fit: StackFit.expand, children: [
            // background
            if (!page.isPdf)
              CustomPaint(
                painter: PaperPainter(
                  template: page.template, dark: dark,
                ),
              )
            else
              _PdfBackground(
                page: page, geometry: geometry, pdfs: pdfs,
                viewport: viewport, index: index,
              ),
            // ink
            ListenableBuilder(
              listenable: engine,
              builder: (_, __) => CustomPaint(
                painter: InkPainter(
                  doc: doc,
                  liveStroke: isCurrent ? engine.live : null,
                  pointScale: geometry.pointScale(index),
                  replayCursorMs: engine.replayCursorMs,
                  selectionColor: colors.primary,
                  dark: dark,
                ),
              ),
            ),
            // elements
            ListenableBuilder(
              listenable: Listenable.merge([engine, images]),
              builder: (_, __) => CustomPaint(
                painter: ElementsPainter(
                  elements: doc.elements,
                  images: images,
                  pointScale: geometry.pointScale(index),
                  screenScale: viewport.scale,
                  selectionColor: colors.primary,
                  dark: dark,
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _PdfBackground extends StatelessWidget {
  final PageRow page;
  final DocGeometry geometry;
  final PdfLibrary pdfs;
  final ViewportController viewport;
  final int index;

  const _PdfBackground({
    required this.page, required this.geometry, required this.pdfs,
    required this.viewport, required this.index,
  });

  @override
  Widget build(BuildContext context) {
    final controller = page.pdfFileId == null
        ? null : pdfs.controllerOf(page.pdfFileId!);
    if (controller == null || !controller.isReady) {
      return const Center(
        child: SizedBox(
          width: 22, height: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    return ListenableBuilder(
      listenable: Listenable.merge([controller, viewport.settleChanges]),
      builder: (context, _) {
        final dpr = MediaQuery.of(context).devicePixelRatio;
        final bucket = controller.bucketFor(viewport.scale, dpr);
        final img = controller.pickBitmap(page.pdfIndex ?? 0, bucket);
        if (img == null) {
          controller.ensureRendered(page.pdfIndex ?? 0, bucket);
          return const Center(
            child: SizedBox(
              width: 22, height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        }
        if (viewport.isSettled) {
          controller.ensureRendered(page.pdfIndex ?? 0, bucket);
        }
        return RawImage(
          image: img,
          fit: BoxFit.fill,
          filterQuality: FilterQuality.medium,
        );
      },
    );
  }
}
