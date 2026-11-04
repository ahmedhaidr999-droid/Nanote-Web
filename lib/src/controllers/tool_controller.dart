import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import '../models/stroke.dart';
import '../models/tool.dart';

/// مصدر الحقيقة الوحيد لحالة الأدوات: القلم/التظليل/الممحاة/اليد + الفرشاة.
///
/// نمط التبديل:
///   - الـ Toolbar "يكتب" هنا (setTool / setColor / setSize ...).
///   - الـ GestureRouter "يقرأ" لحظة كل PointerDown ليقرر:
///     هل هذا المؤشر يرسم أم يمسح أم يحرّك؟
///   - الأداة تُقرأ عند بدء اللمس فقط — يستحيل أن "يتغير النمط"
///     في منتصف خط واحد.
class ToolController extends ChangeNotifier {
  ToolController({Color? color, double size = 3.5})
      : _color = color ?? palette.first,
        _size = size;

  static const palette = <Color>[
    Color(0xFF1C1C1E), // أسود
    Color(0xFFE5484D), // أحمر
    Color(0xFF2E6B4F), // أخضر
    Color(0xFF1D4ED8), // أزرق
  ];

  /// القيم الافتراضية القابلة للاختيار من الشريط.
  static const penPresets = <double>[2.0, 3.5, 6.0];
  static const eraserPresets = <double>[16, 32, 56];

  Tool _tool = Tool.pen;
  Color _color = palette.first;
  double _size = 3.5;

  /// قطر الممحاة بالبكسل الشاشي — ثابت "بصرياً" مهما كان التكبير.
  double _eraserSize = 32;
  bool _fingerDraw = true;

  Tool get tool => _tool;
  Color get color => _color;
  double get size => _size;
  double get eraserSize => _eraserSize;
  bool get fingerDrawEnabled => _fingerDraw;

  void setTool(Tool t) {
    if (t != _tool) {
      _tool = t;
      notifyListeners();
    }
  }

  void setColor(Color c) {
    _color = c;
    // اختيار لون وأنت على أداة غير حبرية → عودة تلقائية للقلم
    if (!_tool.isInk) _tool = Tool.pen;
    notifyListeners();
  }

  void setSize(double s) {
    _size = s;
    notifyListeners();
  }

  void setEraserSize(double s) {
    _eraserSize = s;
    notifyListeners();
  }

  void toggleFingerDraw() {
    _fingerDraw = !_fingerDraw;
    notifyListeners();
  }

  /// لقطة النمط الذي سيُرسم به الخط القادم.
  /// [simulatedPressure] = true للأصابع/الماوس (تنعيم قائم على السرعة)،
  /// و false لأقلام Stylus الحقيقية (يستخدم ضغط القلم الفعلي).
  StrokeStyle activeStyle({required bool simulatedPressure}) {
    if (_tool == Tool.highlighter) {
      return StrokeStyle(
        color: _color.withValues(alpha: 0.30),
        size: _size * 6,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
      );
    }
    return StrokeStyle(
      color: _color,
      size: _size,
      simulatePressure: simulatedPressure,
    );
  }
}
