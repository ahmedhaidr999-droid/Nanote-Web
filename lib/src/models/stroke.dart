import 'package:flutter/material.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

/// لقطة ثابتة من إعدادات الفرشاة لحظة بدء الخط — لا تتغير أثناء الرسم.
class StrokeStyle {
  const StrokeStyle({
    required this.color,
    required this.size,
    this.thinning = 0.65,
    this.smoothing = 0.55,
    this.streamline = 0.45,
    this.simulatePressure = true,
  });

  final Color color;

  /// القطر الأساسي بوحدات "نقاط الصفحة" (PDF points) — ثابت في فضاء
  /// المستند لذا يكبر مع التكبير تماماً كالحبر الحقيقي على الورق.
  final double size;

  /// 0 = سمك ثابت · 1 = استجابة قوية جداً للسرعة/الضغط.
  final double thinning;

  final double smoothing;

  /// قيم أعلى = خط يتبع القلم بتكاسل أكبر (أنعم للكتابة اليدوية).
  final double streamline;

  /// true → السمك يتأثر بسرعة الحركة (محاكاة الحبر الحقيقي)،
  /// ويُعطَّل لأقلام Stylus حقيقية تُبلِّغ عن ضغط فعلي.
  final bool simulatePressure;

  /// [last] = true عند إنهاء الخط لإغلاق طرفه بشكل صحيح
  /// (يسمى isComplete في perfect_freehand 2.5+).
  StrokeOptions toOptions({bool last = false}) => StrokeOptions(
        size: size,
        thinning: thinning,
        smoothing: smoothing,
        streamline: streamline,
        simulatePressure: simulatePressure,
        isComplete: last,
      );
}

/// خط حبر واحد.
///
/// ⚠️ النقاط مخزَّنة في "فضاء نقاط الصفحة" (PDF points) وليس إحداثيات
/// الشاشة — هذا هو ضمان عدم ترحيل الخطوط عند التكبير/التحريك/تدوير
/// الشاشة: التحويل تعرضه مصفوفة واحدة مشتركة، والنقاط لا تتحرك أبداً.
class Stroke {
  Stroke({required this.id, required this.style, required this.points});

  final String id;
  final StrokeStyle style;
  final List<PointVector> points;

  /// مسار محسوب مسبقاً — يُعاد بناؤه فقط أثناء الخط النشط،
  /// ويتجمَّد بعد الالتزام (أداء ثابت مع آلاف الخطوط).
  Path? cachedOutline;
}
