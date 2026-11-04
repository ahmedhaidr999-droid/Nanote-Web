/// الأدوات المتاحة في مساحة العمل.
enum Tool { pen, highlighter, eraser, hand }

extension ToolX on Tool {
  /// أدوات تُنتج حبراً (تُخزَّن خطوطها وتُمحى بالممحاة المتجهية).
  bool get isInk => this == Tool.pen || this == Tool.highlighter;
}
