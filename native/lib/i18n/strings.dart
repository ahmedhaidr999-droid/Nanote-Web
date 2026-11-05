import 'package:flutter/widgets.dart' show BuildContext, Locale, Localizations, TextDirection;

/// Tiny hand-rolled i18n — Arabic-first (default), English secondary.
/// Mirrors the web langpack: keys are stable identifiers.
class I18n {
  final String code; // 'ar' | 'en'
  const I18n(this.code);
  bool get isAr => code == 'ar';
  TextDirection get dir => isAr ? TextDirection.rtl : TextDirection.ltr;

  static const _dict = <String, Map<String, String>>{
    // ── general ──
    'ok': {'ar': 'حسناً', 'en': 'OK'},
    'cancel': {'ar': 'إلغاء', 'en': 'Cancel'},
    'save': {'ar': 'حفظ', 'en': 'Save'},
    'delete': {'ar': 'حذف', 'en': 'Delete'},
    'rename': {'ar': 'إعادة تسمية', 'en': 'Rename'},
    'duplicate': {'ar': 'تكرار', 'en': 'Duplicate'},
    'share': {'ar': 'مشاركة', 'en': 'Share'},
    'close': {'ar': 'إغلاق', 'en': 'Close'},
    'undo': {'ar': 'تراجع', 'en': 'Undo'},
    'redo': {'ar': 'إعادة', 'en': 'Redo'},
    'search': {'ar': 'بحث…', 'en': 'Search…'},
    'more': {'ar': 'المزيد', 'en': 'More'},
    'done': {'ar': 'تم', 'en': 'Done'},
    'retry': {'ar': 'إعادة المحاولة', 'en': 'Retry'},
    'empty': {'ar': 'لا يوجد شيء هنا بعد', 'en': 'Nothing here yet'},
    // ── library ──
    'app_title': {'ar': 'نانوت', 'en': 'Nanote'},
    'tab_notes': {'ar': 'ملاحظاتي', 'en': 'My Notes'},
    'tab_favorites': {'ar': 'المفضلة', 'en': 'Favorites'},
    'tab_trash': {'ar': 'المحذوفات', 'en': 'Trash'},
    'new_notebook': {'ar': 'دفتر جديد', 'en': 'New notebook'},
    'new_folder': {'ar': 'مجلد جديد', 'en': 'New folder'},
    'import_pdf': {'ar': 'استيراد PDF', 'en': 'Import PDF'},
    'notebook': {'ar': 'دفتر', 'en': 'Notebook'},
    'notebooks': {'ar': 'الدفاتر', 'en': 'Notebooks'},
    'folders': {'ar': 'المجلدات', 'en': 'Folders'},
    'pages': {'ar': 'صفحات', 'en': 'pages'},
    'page': {'ar': 'صفحة', 'en': 'page'},
    'opened_days_ago': {'ar': 'فُتح قبل {n}', 'en': 'Opened {n}'},
    'today': {'ar': 'اليوم', 'en': 'today'},
    'yesterday': {'ar': 'أمس', 'en': 'yesterday'},
    'days_ago': {'ar': 'قبل {n} يوم', 'en': '{n} days ago'},
    'move_to_folder': {'ar': 'نقل إلى مجلد', 'en': 'Move to folder'},
    'mark_favorite': {'ar': 'تبديل المفضلة', 'en': 'Toggle favorite'},
    'restore': {'ar': 'استعادة', 'en': 'Restore'},
    'delete_forever': {'ar': 'حذف نهائي', 'en': 'Delete forever'},
    'empty_trash': {'ar': 'إفراغ المحذوفات', 'en': 'Empty trash'},
    'trash_hint': {
      'ar': 'تُمسح العناصر نهائياً بعد 30 يوماً',
      'en': 'Items are permanently deleted after 30 days'
    },
    'grid_view': {'ar': 'عرض شبكي', 'en': 'Grid view'},
    'list_view': {'ar': 'عرض قائمة', 'en': 'List view'},
    'sort_updated': {'ar': 'آخر تعديل', 'en': 'Last updated'},
    'sort_created': {'ar': 'تاريخ الإنشاء', 'en': 'Date created'},
    'sort_title': {'ar': 'الاسم', 'en': 'Title'},
    'rename_notebook': {'ar': 'إعادة تسمية الدفتر', 'en': 'Rename notebook'},
    'notebook_name': {'ar': 'اسم الدفتر', 'en': 'Notebook name'},
    'folder_name': {'ar': 'اسم المجلد', 'en': 'Folder name'},
    'choose_cover': {'ar': 'اختر الغلاف', 'en': 'Choose cover'},
    'choose_paper': {'ar': 'اختر الورق', 'en': 'Choose paper'},
    'create': {'ar': 'إنشاء', 'en': 'Create'},
    'confirm_delete_notebook': {
      'ar': 'حذف «{n}»؟ ستنتقل كل صفحاته إلى المحذوفات.',
      'en': 'Delete “{n}”? All its pages move to trash.'
    },
    'empty_notes_hint': {
      'ar': 'أنشئ دفترك الأول وابدأ الكتابة بالقلم',
      'en': 'Create your first notebook and start inking'
    },
    'empty_fav_hint': {
      'ar': 'اضغط النجمة على أي دفتر ليظهر هنا',
      'en': 'Star a notebook to see it here'
    },
    // ── workspace ──
    'add_page': {'ar': 'إضافة صفحة', 'en': 'Add page'},
    'page_manager': {'ar': 'إدارة الصفحات', 'en': 'Page manager'},
    'paper_template': {'ar': 'نمط الورق', 'en': 'Paper template'},
    'paper_size': {'ar': 'مقاس الورق', 'en': 'Paper size'},
    'template_plain': {'ar': 'سادة', 'en': 'Plain'},
    'template_ruled': {'ar': 'مسطر', 'en': 'Ruled'},
    'template_graph': {'ar': 'مربعات', 'en': 'Graph'},
    'template_dots': {'ar': 'منقط', 'en': 'Dots'},
    'template_isometric': {'ar': 'إيزومتري', 'en': 'Isometric'},
    'template_cornell': {'ar': 'كورنيل', 'en': 'Cornell'},
    'template_hex': {'ar': 'سداسي', 'en': 'Hex grid'},
    'template_music': {'ar': 'موسيقي', 'en': 'Music staff'},
    'template_checklist': {'ar': 'قائمة مهام', 'en': 'Checklist'},
    'size_a4p': {'ar': 'A4 طولي', 'en': 'A4 portrait'},
    'size_a4l': {'ar': 'A4 عرضي', 'en': 'A4 landscape'},
    'size_letter': {'ar': 'Letter طولي', 'en': 'Letter portrait'},
    'export_png': {'ar': 'تصدير صورة PNG', 'en': 'Export PNG'},
    'export_pdf': {'ar': 'تصدير PDF', 'en': 'Export PDF'},
    'exporting': {'ar': 'جارٍ التصدير…', 'en': 'Exporting…'},
    'exported': {'ar': 'تم التصدير', 'en': 'Exported'},
    // ── tools ──
    'tool_pen': {'ar': 'قلم', 'en': 'Pen'},
    'tool_highlighter': {'ar': 'قلم تظليل', 'en': 'Highlighter'},
    'tool_eraser': {'ar': 'ممحاة', 'en': 'Eraser'},
    'tool_laser': {'ar': 'مؤشر ليزر', 'en': 'Laser'},
    'tool_text': {'ar': 'نص', 'en': 'Text'},
    'tool_shape': {'ar': 'شكل', 'en': 'Shape'},
    'tool_image': {'ar': 'صورة', 'en': 'Image'},
    'tool_sticker': {'ar': 'ملصق', 'en': 'Sticker'},
    'tool_selector': {'ar': 'تحديد', 'en': 'Select'},
    'tool_ruler': {'ar': 'مسطرة', 'en': 'Ruler'},
    'tool_pan': {'ar': 'تحريك', 'en': 'Pan'},
    'tool_audio': {'ar': 'تسجيل', 'en': 'Audio'},
    'tool_translate': {'ar': 'ترجمة', 'en': 'Translate'},
    'pen_ballpoint': {'ar': 'جاف', 'en': 'Ballpoint'},
    'pen_brush': {'ar': 'فرشاة', 'en': 'Brush'},
    'pen_pencil': {'ar': 'رصاص', 'en': 'Pencil'},
    'pen_marker': {'ar': 'ماركر', 'en': 'Marker'},
    'eraser_stroke': {'ar': 'ممحاة خطوط', 'en': 'Stroke eraser'},
    'eraser_area': {'ar': 'ممحاة مساحة', 'en': 'Area eraser'},
    'size': {'ar': 'السماكة', 'en': 'Size'},
    'color': {'ar': 'اللون', 'en': 'Color'},
    'shape_fill': {'ar': 'تعبئة', 'en': 'Fill'},
    'shape_stroke': {'ar': 'حدود', 'en': 'Stroke'},
    'recognize_shapes': {'ar': 'تمييز الأشكال', 'en': 'Shape recognition'},
    'snap': {'ar': 'محاذاة', 'en': 'Snap'},
    'cut': {'ar': 'قص', 'en': 'Cut'},
    'copy': {'ar': 'نسخ', 'en': 'Copy'},
    'paste': {'ar': 'لصق', 'en': 'Paste'},
    'select_all': {'ar': 'تحديد الكل', 'en': 'Select all'},
    'clear_selection': {'ar': 'إلغاء التحديد', 'en': 'Deselect'},
    'group': {'ar': 'تجميع', 'en': 'Group'},
    'ungroup': {'ar': 'فك التجميع', 'en': 'Ungroup'},
    'bring_front': {'ar': 'إلى الأمام', 'en': 'Bring to front'},
    'send_back': {'ar': 'إلى الخلف', 'en': 'Send to back'},
    'delete_selection': {'ar': 'حذف المحدد', 'en': 'Delete selection'},
    'ruler_hint': {
      'ar': 'اسحب منتصف المسطرة للتحريك، والمقبض للتدوير',
      'en': 'Drag ruler body to move, handle to rotate'
    },
    // ── text / translate / audio ──
    'edit_text': {'ar': 'تحرير النص', 'en': 'Edit text'},
    'text_placeholder': {'ar': 'اكتب هنا…', 'en': 'Type here…'},
    'translate': {'ar': 'ترجمة', 'en': 'Translate'},
    'translating': {'ar': 'جارٍ الترجمة…', 'en': 'Translating…'},
    'translate_failed': {'ar': 'تعذّرت الترجمة', 'en': 'Translation failed'},
    'translate_offline': {'ar': 'بدون اتصال — نتيجة القاموس', 'en': 'Offline — dictionary result'},
    'open_google': {'ar': 'فتح ترجمة Google', 'en': 'Open Google Translate'},
    'ask_ai': {'ar': 'اسأل الذكاء الاصطناعي', 'en': 'Ask AI'},
    'insert_translation': {'ar': 'إدراج الترجمة', 'en': 'Insert translation'},
    'record_start': {'ar': 'بدء التسجيل', 'en': 'Start recording'},
    'record_stop': {'ar': 'إيقاف التسجيل', 'en': 'Stop recording'},
    'recording': {'ar': 'جارٍ التسجيل', 'en': 'Recording'},
    'play': {'ar': 'تشغيل', 'en': 'Play'},
    'pause': {'ar': 'إيقاف مؤقت', 'en': 'Pause'},
    'replay_ink': {'ar': 'إعادة حبر الصفحة', 'en': 'Replay page ink'},
    'audio_note': {'ar': 'ملاحظة صوتية', 'en': 'Audio note'},
    'mic_permission': {'ar': 'يحتاج التطبيق إذن الميكروفون', 'en': 'Microphone permission required'},
    // ── stickers ──
    'stickers_emoji': {'ar': 'إيموجي', 'en': 'Emoji'},
    'stickers_mine': {'ar': 'ملصقاتي', 'en': 'My stickers'},
    'add_sticker_png': {'ar': 'إضافة PNG', 'en': 'Add PNG'},
    // ── settings ──
    'settings': {'ar': 'الإعدادات', 'en': 'Settings'},
    'sec_appearance': {'ar': 'المظهر', 'en': 'Appearance'},
    'sec_language': {'ar': 'اللغة', 'en': 'Language'},
    'lang_ar': {'ar': 'العربية', 'en': 'Arabic'},
    'lang_en': {'ar': 'English', 'en': 'English'},
    'dark_mode': {'ar': 'الوضع الليلي', 'en': 'Dark mode'},
    'system_theme': {'ar': 'حسب النظام', 'en': 'Follow system'},
    'left_handed': {'ar': 'وضع الأعسر', 'en': 'Left-handed'},
    'sec_pen': {'ar': 'القلم', 'en': 'Stylus'},
    'palm_rejection': {'ar': 'رفض الكف', 'en': 'Palm rejection'},
    'shape_recognition': {'ar': 'تمييز الأشكال عند الكتابة', 'en': 'Shape recognition while drawing'},
    'barrel_button': {'ar': 'زر القلم الجانبي', 'en': 'Pen barrel button'},
    'double_tap': {'ar': 'نقرة مزدوجة', 'en': 'Double tap'},
    'press_hold': {'ar': 'ضغط مطوّل', 'en': 'Press & hold'},
    'hover_button': {'ar': 'زر أثناء التحويم', 'en': 'Button while hovering'},
    'action_none': {'ar': 'معطّل', 'en': 'Disabled'},
    'sec_backup': {'ar': 'النسخ الاحتياطي', 'en': 'Backup'},
    'backup_create': {'ar': 'إنشاء نسخة احتياطية', 'en': 'Create backup'},
    'backup_restore': {'ar': 'استعادة نسخة', 'en': 'Restore backup'},
    'backup_done': {'ar': 'تم إنشاء النسخة', 'en': 'Backup created'},
    'restore_done': {'ar': 'تمت الاستعادة', 'en': 'Backup restored'},
    'restore_failed': {'ar': 'ملف النسخة غير صالح', 'en': 'Invalid backup file'},
    'sec_about': {'ar': 'حول', 'en': 'About'},
    'version': {'ar': 'الإصدار', 'en': 'Version'},
    // ── actions (pen shortcuts) ──
    'action_pen': {'ar': 'قلم', 'en': 'Pen'},
    'action_highlighter': {'ar': 'تظليل', 'en': 'Highlighter'},
    'action_eraser': {'ar': 'ممحاة', 'en': 'Eraser'},
    'action_selector': {'ar': 'تحديد', 'en': 'Selector'},
    'action_laser': {'ar': 'ليزر', 'en': 'Laser'},
    'action_pan': {'ar': 'تحريك', 'en': 'Pan'},
    'action_shape': {'ar': 'شكل', 'en': 'Shape'},
    'action_text': {'ar': 'نص', 'en': 'Text'},
    'action_undo': {'ar': 'تراجع', 'en': 'Undo'},
    'action_redo': {'ar': 'إعادة', 'en': 'Redo'},
    'action_cycle_color': {'ar': 'اللون التالي', 'en': 'Next color'},
    'action_cycle_size': {'ar': 'السماكة التالية', 'en': 'Next size'},
    'action_toggle_ruler': {'ar': 'تبديل المسطرة', 'en': 'Toggle ruler'},
  };

  String t(String key, [Map<String, Object>? params]) {
    var s = _dict[key]?[code] ?? _dict[key]?['en'] ?? key;
    params?.forEach((k, v) => s = s.replaceAll('{$k}', '$v'));
    return s;
  }

  /// Eastern-Arabic digits for Arabic UI numbers.
  String num(int n) {
    if (!isAr) return '$n';
    const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return '$n'.split('').map((d) => int.tryParse(d) == null ? d : ar[int.parse(d)]).join();
  }

  String relativeDays(int days) {
    if (days <= 0) return t('today');
    if (days == 1) return t('yesterday');
    return t('days_ago').replaceAll('{n}', num(days));
  }

  static I18n of(BuildContext context) {
    final loc = Localizations.maybeLocaleOf(context);
    return I18n(loc?.languageCode == 'en' ? 'en' : 'ar');
  }
}

/// The delegate is trivial: we only care about ar/en; everything else falls
/// back to Arabic (the app's primary language).
class NanoteLocalizationsDelegate
    extends LocalizationsDelegate<Locale> {
  const NanoteLocalizationsDelegate();
  @override
  bool isSupported(Locale l) => ['ar', 'en'].contains(l.languageCode);
  @override
  Future<Locale> load(Locale l) async =>
      Locale(l.languageCode == 'en' ? 'en' : 'ar');
  @override
  bool shouldReload(old) => false;
}
