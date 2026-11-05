/// Workspace tools (13). `pen` & `highlighter` produce ink strokes.
enum Tool {
  pen, highlighter, eraser, laser, text, shape, image, sticker,
  selector, ruler, pan, audio, translate,
}

extension ToolX on Tool {
  /// Tools that lay down persistent ink on the page.
  bool get isInk => this == Tool.pen || this == Tool.highlighter;

  /// Tools whose pointer-down on canvas must NOT pan (drawing tools).
  bool get draws => isInk || this == Tool.eraser || this == Tool.laser;

  /// Tools that spawn a panel/sheet instead of canvas interaction.
  bool get opensPanel =>
      this == Tool.audio || this == Tool.translate ||
      this == Tool.image || this == Tool.sticker;
}
