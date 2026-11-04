/// تفضيلات المكتبة — المحفوظ منها يُخزَّن في SettingsEntity
/// (العرض والترتيب)، والفلتر حالة جلسة فقط.
enum LibraryView { grid, list }

enum LibrarySort { updatedDesc, createdDesc, titleAsc }

enum LibraryFilter { all, notes, pdfs, favorites }
