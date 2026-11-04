import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import 'src/workspace/document_workspace.dart';

void main() {
  runApp(const NanoteApp());
}

class NanoteApp extends StatelessWidget {
  const NanoteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nanote',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF8250DF),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const _sampleAsset = 'assets/sample.pdf';

  late final Future<Uint8List?> _pdfFuture = _loadSample();

  /// يحاول تحميل ملف PDF تجريبي من الـ assets، وإذا لم يوجد
  /// يفتح دفتراً فارغاً (3 صفحات) — تجربة فورية للمحرك بدون أي إعداد.
  Future<Uint8List?> _loadSample() async {
    try {
      final data = await rootBundle.load(_sampleAsset);
      return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _pdfFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        final bytes = snapshot.data;
        return DocumentWorkspace(
          pdfBytes: bytes,
          blankPages: bytes == null ? 3 : 0,
        );
      },
    );
  }
}
