import 'dart:async';

import 'package:flutter/material.dart';

/// نظام التحكم المتزامن (Unified Zoom & Pan).
///
/// مصفوفة واحدة `screen = doc × scale + pan` تعرض PDF والحبر معاً داخل
/// Transform واحد → يستحيل هندسياً ترحيل الخطوط أو انزياحها عن الصفحة.
///
/// المدخلات تُحوَّل عبر معكوس نفس المصفوفة (toDoc) — مصدر واحد للحقيقة.
///
/// يحتوي أيضاً على منطق "الاستقرار" (settle): بعد توقف إيماءة التكبير
/// بـ 220ms تُبلَّغ طبقة PDF لترندر الصفحات المرئية بدقة أعلى — أثناء
/// الحركة نفسها صفر رندرة (تكبير GPU للمصفوفة فقط) وهذا سر ثبات 120fps.
class ViewportController extends ChangeNotifier {
  ViewportController({this.minScale = 1.0, this.maxScale = 6.0});

  final double minScale;
  final double maxScale;

  Size _viewportSize = Size.zero;
  Size _docSize = Size.zero;
  double _scale = 1.0;
  Offset _pan = Offset.zero;

  Timer? _settleTimer;
  bool _settled = true;
  final ChangeNotifier _settleNotifier = ChangeNotifier();
  final Matrix4 _matrix = Matrix4.identity();

  double get scale => _scale;
  Offset get pan => _pan;
  bool get isSettled => _settled;

  /// إشعار خفيف يُطلق فقط عند "استقرار" التكبير — لا يُطلق مع كل إطار،
  /// لذا لا تُعاد بناء أي بلاطة صفحة أثناء البنش.
  Listenable get settleChanges => _settleNotifier;

  /// مصفوفة العرض الموحدة (تُحدَّث في المكان — صفر تخصيص لكل إطار).
  ///
  /// كتابة مباشرة بالتخزين العمودي (column-major) للمصفوفة
  /// `screen = doc × scale + pan` أي M = T·S:
  ///   [0] = m11 = scaleX · [5] = m22 = scaleY
  ///   [12] = tx · [13] = ty
  /// أسرع من translate/scale المهملتين في vector_math الحديثة.
  Matrix4 get matrix {
    _matrix.setIdentity();
    _matrix[0] = _scale;
    _matrix[5] = _scale;
    _matrix[12] = _pan.dx;
    _matrix[13] = _pan.dy;
    return _matrix;
  }

  set viewportSize(Size s) {
    if (s == _viewportSize) return;
    _viewportSize = s;
    _clamp();
    notifyListeners();
  }

  set docSize(Size s) {
    if (s == _docSize) return;
    _docSize = s;
    _clamp();
    notifyListeners();
  }

  /// من فضاء الشاشة إلى فضاء المستند (معكوس مصفوفة العرض).
  Offset toDoc(Offset screen) => (screen - _pan) / _scale;

  Rect get visibleDocRect {
    if (_viewportSize == Size.zero) return Rect.zero;
    return Rect.fromPoints(
      toDoc(Offset.zero),
      toDoc(Offset(_viewportSize.width, _viewportSize.height)),
    );
  }

  /// تكبير حول نقطة تركيز ثابتة — النقطة تحت الإصبع تبقى تحته بالضبط.
  void zoomBy(double factor, Offset focalScreen) {
    if (factor <= 0 || factor == 1) return;
    final next = (_scale * factor).clamp(minScale, maxScale).toDouble();
    if ((next - _scale).abs() < 1e-9) return;
    final applied = next / _scale;
    _pan = focalScreen - (focalScreen - _pan) * applied;
    _scale = next;
    _afterTransform();
  }

  void panBy(Offset delta) {
    if (delta == Offset.zero) return;
    _pan += delta;
    _afterTransform();
  }

  /// عودة إلى العرض الكامل (fit-width).
  void reset() {
    _scale = 1.0;
    _pan = Offset.zero;
    _afterTransform();
  }

  void _afterTransform() {
    _clamp();
    notifyListeners();
    _settleTimer?.cancel();
    _settled = false;
    _settleTimer = Timer(const Duration(milliseconds: 220), () {
      _settled = true;
      _settleNotifier.notifyListeners();
    });
  }

  /// لا يُسمح بفقدان المحتوى خارج الشاشة، ويُوسَّط إذا كان أصغر منها.
  void _clamp() {
    if (_viewportSize == Size.zero || _docSize == Size.zero) return;
    final content = _docSize * _scale;

    final double dx;
    if (content.width <= _viewportSize.width) {
      dx = (_viewportSize.width - content.width) / 2;
    } else {
      dx =
          _pan.dx.clamp(_viewportSize.width - content.width, 0.0).toDouble();
    }

    final double dy;
    if (content.height <= _viewportSize.height) {
      dy = (_viewportSize.height - content.height) / 2;
    } else {
      dy = _pan
          .dy.clamp(_viewportSize.height - content.height, 0.0)
          .toDouble();
    }

    _pan = Offset(dx, dy);
  }

  @override
  void dispose() {
    _settleTimer?.cancel();
    _settleNotifier.dispose();
    super.dispose();
  }
}
