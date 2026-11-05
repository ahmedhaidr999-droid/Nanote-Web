import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';
import '../models/library_models.dart';
import '../models/paper.dart';

/// Document layout: N pages stacked vertically with explicit point sizes.
/// Page i may be paper (template + size) or a PDF page (real PDF points).
/// Ink lives in PAGE-POINT space; `pointScale` maps it into the tile.
class DocGeometry {
  final List<PageRow> pages;
  final PdfLibrary pdfs;
  final double docWidth; // logical width at scale = 1

  static const double gap = 12.0;

  final List<double> _tops = [];
  final List<Size> _pointSizes = [];
  late final double docHeight = _compute();

  DocGeometry({required this.pages, required this.pdfs, required this.docWidth}) {
    _compute();
  }

  double _compute() {
    _tops.clear();
    _pointSizes.clear();
    var top = 0.0;
    for (final p in pages) {
      final s = pointSizeOf(p);
      _pointSizes.add(s);
      _tops.add(top);
      top += docWidth * s.height / s.width + gap;
    }
    return _tops.isEmpty ? 0 : top - gap;
  }

  Size pointSizeOf(PageRow p) {
    if (p.isPdf) {
      final c = pdfs.controllerOf(p.pdfFileId!);
      if (c != null && p.pdfIndex != null && c.isReady) {
        return c.pointSize(p.pdfIndex!);
      }
      return const Size(595, 842);
    }
    return kPaperSizes[p.sizeIdx.clamp(0, kPaperSizes.length - 1)].size;
  }

  int get pageCount => pages.length;

  double pageTop(int i) => _tops[i];
  double pageBottom(int i) => _tops[i] + pageHeight(i);

  double pageHeight(int i) =>
      docWidth * _pointSizes[i].height / _pointSizes[i].width;

  /// Logical (doc-space) rect of page i.
  Rect pageRect(int i) =>
      Rect.fromLTWH(0, _tops[i], docWidth, pageHeight(i));

  /// page-points per doc-space unit for page i.
  double pointScale(int i) => _pointSizes[i].width / docWidth;

  int pageAt(Offset docPos) {
    for (var i = 0; i < pageCount; i++) {
      if (docPos.dy < pageBottom(i) + gap / 2) return i;
    }
    return -1;
  }

  /// doc-space → page-point space of page i.
  Offset docToPoints(int i, Offset docPos) {
    final k = pointScale(i);
    return Offset(docPos.dx * k, (docPos.dy - _tops[i]) * k);
  }

  /// page-point space of page i → doc space.
  Offset pointsToDoc(int i, Offset pt) {
    final k = pointScale(i);
    return Offset(pt.dx / k, _tops[i] + pt.dy / k);
  }

  Rect pointsRectToDoc(int i, Rect r) {
    final a = pointsToDoc(i, r.topLeft);
    final b = pointsToDoc(i, r.bottomRight);
    return Rect.fromPoints(a, b);
  }
}
