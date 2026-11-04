import 'package:flutter/material.dart';

import '../controllers/pdf_document_controller.dart';

/// هندسة المستند: مقاسات الصفحات والفواصل والتحويل بين الفضاءات:
/// الشاشة ← المستند ← نقاط الصفحة (PDF points).
///
/// تُبنى نسخة جديدة عند كل تغيّر في التخطيط (تغيّر حجم النافذة أو وصول
/// مقاسات صفحات حقيقية)، وتحسب الإزاحات مرة واحدة فقط (O(n)) ثم تخدم
/// كل الاستعلامات O(1) — لا حسابات متداخلة داخل حلقة الإطارات.
class DocGeometry {
  DocGeometry({required this.docWidth, required this.pdf});

  /// عرض المستند المنطقي عند scale = 1 (fit-width).
  final double docWidth;
  final PdfDocumentController pdf;

  /// الفاصل البصري بين الصفحات.
  static const double gap = 12.0;

  final List<double> _tops = [];
  final List<double> _heights = [];
  final List<double> _pointWidths = [];
  double _docHeight = 0;
  bool _computed = false;

  int get pageCount => pdf.pageCount;

  void _ensure() {
    if (_computed) return;
    _computed = true;
    var top = 0.0;
    for (var i = 0; i < pdf.pageCount; i++) {
      final s = pdf.pointSize(i);
      final h = docWidth * s.height / s.width;
      _tops.add(top);
      _heights.add(h);
      _pointWidths.add(s.width);
      top += h + gap;
    }
    _docHeight = _tops.isEmpty ? 0 : top - gap;
  }

  double get docHeight {
    _ensure();
    return _docHeight;
  }

  double pageTop(int page) {
    _ensure();
    return _tops[page];
  }

  /// مقاس الصفحة بالبكسل المنطقي (عرضها = عرض المستند).
  Size logical(int page) {
    _ensure();
    return Size(docWidth, _heights[page]);
  }

  /// بكسل منطقي لكل نقطة PDF في هذه الصفحة.
  double pointScale(int page) {
    _ensure();
    return docWidth / _pointWidths[page];
  }

  /// رقم الصفحة عند نقطة بفضاء المستند، أو -1 إذا كانت النقطة خلف
  /// الصفحات (يتحمّل نصف الفاصل كإحداثيات تابعة للصفحة المجاورة).
  int pageAt(Offset docPos) {
    _ensure();
    for (var i = 0; i < _heights.length; i++) {
      if (docPos.dy < _tops[i] + _heights[i] + gap / 2) return i;
    }
    return -1;
  }

  /// تحويل نقطة من فضاء المستند إلى فضاء نقاط الصفحة.
  Offset docToPoints(int page, Offset docPos) {
    _ensure();
    final k = docWidth / _pointWidths[page];
    return Offset(docPos.dx / k, (docPos.dy - _tops[page]) / k);
  }
}
