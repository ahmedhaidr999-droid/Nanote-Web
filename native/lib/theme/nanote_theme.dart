import 'package:flutter/material.dart';

/// Nanote v1.9.1 design tokens — extracted 1:1 from the web build.
class NanoteColors {
  final Color bg, surface, surfaceAlt, elevated, text, textMuted, primary,
      primaryFg, primarySoft, border, danger, warning, success, scrim;

  const NanoteColors({
    required this.bg, required this.surface, required this.surfaceAlt,
    required this.elevated, required this.text, required this.textMuted,
    required this.primary, required this.primaryFg, required this.primarySoft,
    required this.border, required this.danger, required this.warning,
    required this.success, required this.scrim,
  });

  static const light = NanoteColors(
    bg: Color(0xFFF7F9FC),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFEEF2F8),
    elevated: Color(0xFFFFFFFF),
    text: Color(0xFF16233A),
    textMuted: Color(0xFF5A6B85),
    primary: Color(0xFF1E6FF2),
    primaryFg: Color(0xFFFFFFFF),
    primarySoft: Color(0xFFE8F0FE),
    border: Color(0xFFE2E8F1),
    danger: Color(0xFFE5484D),
    warning: Color(0xFFF5A623),
    success: Color(0xFF30A46C),
    scrim: Color(0x66101828),
  );

  static const dark = NanoteColors(
    bg: Color(0xFF0E1622),
    surface: Color(0xFF16202E),
    surfaceAlt: Color(0xFF1C2838),
    elevated: Color(0xFF1C2838),
    text: Color(0xFFE8EEF7),
    textMuted: Color(0xFF94A6C0),
    primary: Color(0xFF6BA6FF),
    primaryFg: Color(0xFF0B1526),
    primarySoft: Color(0xFF1D2C49),
    border: Color(0xFF24324A),
    danger: Color(0xFFFF6369),
    warning: Color(0xFFFFB224),
    success: Color(0xFF3DD68C),
    scrim: Color(0x99060B14),
  );

  static NanoteColors of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;
}

/// Corner radius used across cards, sheets and popovers (v1.9.1 = 12).
const double kNanoteRadius = 12;

/// Notebook cover palette (8 covers, each with a deep + soft tone).
const List<(Color, Color)> kCoverPalette = [
  (Color(0xFF1E6FF2), Color(0xFF6BA6FF)),
  (Color(0xFF30A46C), Color(0xFF7EE787)),
  (Color(0xFFF5A623), Color(0xFFFFD23F)),
  (Color(0xFFE5484D), Color(0xFFFF8785)),
  (Color(0xFF8E4EC6), Color(0xFFC4A2F0)),
  (Color(0xFFD6409F), Color(0xFFF49CE0)),
  (Color(0xFF0EA5E9), Color(0xFF7DD3FC)),
  (Color(0xFF64748B), Color(0xFFB6C2D4)),
];

/// Cover art styles shown on notebook cards.
enum CoverArt { waves, dots, lines, arc, grid, spiral, sun, triangles }
const kCoverArts = CoverArt.values;

ThemeData nanoteTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? NanoteColors.dark : NanoteColors.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.primary,
    onPrimary: c.primaryFg,
    secondary: c.primary,
    onSecondary: c.primaryFg,
    error: c.danger,
    onError: Colors.white,
    surface: c.surface,
    onSurface: c.text,
    onSurfaceVariant: c.textMuted,
    outline: c.border,
    outlineVariant: c.border,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: 'sans-serif');
  return base.copyWith(
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    splashFactory: InkSparkle.splashFactory,
    textTheme: base.textTheme.apply(
      bodyColor: c.text,
      displayColor: c.text,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      foregroundColor: c.text,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium!.copyWith(
        fontWeight: FontWeight.w700,
        color: c.text,
      ),
    ),
    cardTheme: CardTheme(
      color: c.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        side: BorderSide(color: c.border),
      ),
    ),
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      indicatorColor: c.primarySoft,
      labelTextStyle: WidgetStatePropertyAll(
        base.textTheme.labelMedium!.copyWith(fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surfaceAlt,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      hintStyle: base.textTheme.bodyMedium!.copyWith(color: c.textMuted),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.primary,
        foregroundColor: c.primaryFg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kNanoteRadius),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        textStyle: base.textTheme.labelLarge!.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.text,
        side: BorderSide(color: c.border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kNanoteRadius),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: c.primary),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: c.text),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      modalBackgroundColor: c.surface,
      modalBarrierColor: c.scrim,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      showDragHandle: true,
    ),
    dialogTheme: DialogTheme(
      backgroundColor: c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kNanoteRadius + 4),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: c.elevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kNanoteRadius),
        side: BorderSide(color: c.border),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: brightness == Brightness.dark ? c.elevated : c.text,
      contentTextStyle: base.textTheme.bodyMedium!.copyWith(
        color: brightness == Brightness.dark ? c.text : Colors.white,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kNanoteRadius),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.primaryFg : c.surface,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? c.primary : c.surfaceAlt,
      ),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: c.primary,
      inactiveTrackColor: c.surfaceAlt,
      thumbColor: c.primary,
      overlayColor: c.primary.withValues(alpha: 0.12),
    ),
  );
}
