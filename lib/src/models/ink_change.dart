import 'stroke.dart';

/// تغيير حبر مُلزِم يُبَث من StrokeEngine.onCommit إلى الحفظ التلقائي —
/// وصف تفاضلي دقيق لما حدث فعلاً، حتى تكتب القاعدة تزايدياً
/// (صف واحد لكل عملية) بدل إعادة كتابة المستند كله.
sealed class InkChange {
  const InkChange();
}

/// خط التُزم للتو على صفحة ما (رسم، أو إعادة/تراجع-عن-مسح).
final class InkAdded extends InkChange {
  const InkAdded(this.page, this.stroke);
  final int page;
  final Stroke stroke;
}

/// خط حُذف (ممحاة، تراجع عن رسم، أو إعادة لمسح) — يُحذف عبر معرّفه.
final class InkRemoved extends InkChange {
  const InkRemoved(this.stroke);
  final Stroke stroke;
}

/// استبدال كامل لمحتوى المستند (استيراد/فتح) — نادر.
final class InkReplacedAll extends InkChange {
  const InkReplacedAll(this.pages);
  final Map<int, List<Stroke>> pages;
}
