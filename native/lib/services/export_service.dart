import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import '../models/library_models.dart';
import '../models/paper.dart';
import '../models/settings.dart';
import '../persistence/file_store.dart';
import '../persistence/library_repository.dart';

typedef PageRenderer = Future<ui.Image?> Function(
    PageRow page, double pixelWidth);

/// Export & share: PNG per page (at settings.exportScale) and one PDF
/// containing every page as a full-bleed image (96dpi page-space → 72dpi
/// PDF points via the 0.75 factor).
class ExportService {
  final FileStore fs;
  final LibraryRepository repo;
  final AppSettings Function() settings;

  ExportService(this.fs, this.repo, this.settings);

  static const double pxToPdfPt = 0.75;

  Future<File> _exportPngFile(PageRow page, Uint8List pngBytes) async {
    final tmp = await getTemporaryDirectory();
    final safe = _sanitize(page, repo)
        .replaceAll(RegExp(r'[^A-Za-z0-9_\- ]'), '').trim();
    final f = File('${tmp.path}/nanote_${safe}_${page.sortIndex + 1}.png');
    await f.writeAsBytes(pngBytes, flush: true);
    return f;
  }

  static String _sanitize(PageRow page, LibraryRepository repo) {
    final nb = repo.notebookById(page.notebookId);
    return nb?.title ?? 'page';
  }

  Future<void> exportPng(PageRow page, PageRenderer render) async {
    final scale = settings().exportScale.clamp(1.0, 3.0);
    final size = kPaperSizes[page.sizeIdx.clamp(0, kPaperSizes.length - 1)];
    final img = await render(page, size.w * scale);
    if (img == null) return;
    try {
      final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) return;
      final file = await _exportPngFile(page, bytes.buffer.asUint8List());
      await _shareFiles([file.path], 'Nanote — PNG');
    } finally {
      img.dispose();
    }
  }

  Future<void> exportPdf(String notebookId, PageRenderer render) async {
    final nb = repo.notebookById(notebookId);
    if (nb == null) return;
    final pages = repo.visiblePages(notebookId);
    final scale = settings().exportScale.clamp(1.0, 3.0);
    final doc = pw.Document(theme: pw.ThemeData.withFont(
      base: pw.Font.helvetica(),
      bold: pw.Font.helveticaBold(),
    ));

    for (final page in pages) {
      final size = kPaperSizes[page.sizeIdx.clamp(0, kPaperSizes.length - 1)];
      final img = await render(page, size.w * scale);
      if (img == null) continue;
      Uint8List? png;
      try {
        final bd = await img.toByteData(format: ui.ImageByteFormat.png);
        png = bd?.buffer.asUint8List();
      } finally {
        img.dispose();
      }
      if (png == null) continue;

      final wPt = size.w * pxToPdfPt, hPt = size.h * pxToPdfPt;
      doc.addPage(pw.Page(
        pageFormat: PdfPageFormat(wPt, hPt),
        margin: pw.EdgeInsets.zero,
        build: (_) => pw.Image(
          pw.MemoryImage(png!),
          width: wPt, height: hPt, fit: pw.BoxFit.fill,
        ),
      ));
    }

    final tmp = await getTemporaryDirectory();
    final safe = nb.title
        .replaceAll(RegExp(r'[^A-Za-z0-9_\- ]'), '').trim();
    final f = File('${tmp.path}/nanote_${safe.isEmpty ? "notebook" : safe}.pdf');
    await f.writeAsBytes(await doc.save(), flush: true);
    await _shareFiles([f.path], 'Nanote — PDF');
  }

  Future<void> _shareFiles(List<String> paths, String subject) async {
    await SharePlus.instance.share(ShareParams(
      files: [for (final p in paths) XFile(p)],
      subject: subject,
    ));
  }

  /// Renders a page offscreen: caller supplies the painter pipeline.
  static Future<ui.Image?> rasterize({
    required Size logicalSize,
    required double pixelWidth,
    required void Function(ui.Canvas canvas, Size size) painter,
  }) async {
    final scale = pixelWidth / logicalSize.width;
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.scale(scale, scale);
    painter(canvas, logicalSize);
    final pic = recorder.endRecording();
    try {
      return await pic.toImage(
          (logicalSize.width * scale).round(),
          (logicalSize.height * scale).round());
    } catch (e) {
      debugPrint('Nanote rasterize failed: $e');
      return null;
    }
  }
}
