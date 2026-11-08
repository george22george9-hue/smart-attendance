/**
 * Offline Excel File Generator using SheetJS
 * Formats and downloads formatted attendance spreadsheets directly in the browser
 */
class AttendanceExcelExporter {
  static exportLecture(lecture, attendanceList) {
    if (!window.XLSX) {
      alert('مكتبة تصدير الإكسيل غير محملة');
      return;
    }

    // 1. Prepare worksheet rows
    const rows = [];

    // Header info rows
    rows.push(['نظام الحضور والغياب الذكي - كشف حضور معتمد']);
    rows.push(['نوع الجلسة:', lecture.session_type || 'محاضرة نظري', 'اسم المادة / المحاضرة:', lecture.title || 'بدون عنوان']);
    rows.push(['المحاضر / المعيد:', lecture.instructor_name || 'غير محدد', 'التاريخ:', lecture.lecture_date || new Date().toLocaleDateString('ar-EG')]);
    rows.push(['القسم المستهدف:', lecture.target_dept || 'الكل', 'إجمالي الحضور:', attendanceList.length + ' طالب']);
    rows.push([]); // blank line separator

    // Table Columns Header
    rows.push([
      'م',
      'الاسم ثلاثي',
      'الرقم القومي',
      'القسم',
      'وقت الحضور',
      'حالة المزامنة'
    ]);

    // Data rows
    attendanceList.forEach((record, index) => {
      const syncStatusText = record.is_synced === 1 ? 'تمت المزامنة بالسيرفر' : 'محفوظ محلياً';
      rows.push([
        index + 1,
        record.student_name,
        // Prepend quote or keep as string to ensure Excel treats 14 digits as text
        String(record.national_id),
        record.department,
        record.scan_time || '',
        syncStatusText
      ]);
    });

    // Summary at bottom
    rows.push([]);
    rows.push(['إحصائية الحضور حسب الأقسام:']);
    const deptCounts = { 'آلات': 0, 'نظم': 0, 'ري': 0, 'عام': 0 };
    attendanceList.forEach(r => {
      if (deptCounts[r.department] !== undefined) {
        deptCounts[r.department]++;
      } else {
        deptCounts[r.department] = (deptCounts[r.department] || 0) + 1;
      }
    });

    Object.entries(deptCounts).forEach(([dept, count]) => {
      rows.push(['قسم ' + dept, count + ' طالب']);
    });

    // 2. Create Sheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set Column Widths
    ws['!cols'] = [
      { wch: 8 },  // م
      { wch: 32 }, // الاسم ثلاثي
      { wch: 22 }, // الرقم القومي
      { wch: 14 }, // القسم
      { wch: 18 }, // وقت الحضور
      { wch: 22 }  // حالة المزامنة
    ];

    // Right-to-Left sheet view configuration
    ws['!views'] = [{ rightToLeft: true }];

    // 3. Create Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحضور');

    // 4. Clean filename
    const safeTitle = (lecture.title || 'محاضرة').replace(/[\\/:*?"<>|]/g, '_');
    const safeDate = (lecture.lecture_date || new Date().toISOString().split('T')[0]).replace(/[\\/:*?"<>|]/g, '-');
    const filename = `حضور_${safeTitle}_${safeDate}.xlsx`;

    // 5. Trigger download
    XLSX.writeFile(wb, filename);
  }
}

window.AttendanceExcelExporter = AttendanceExcelExporter;

