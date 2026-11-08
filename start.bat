@echo off
chcp 65001 >nul
title تشغيل نظام الحضور والغياب الذكي
echo ========================================================
echo        نظام الحضور والغياب الذكي (PWA + Online Link)
echo ========================================================
echo.
echo [1/2] جاري تشغيل خادم التطبيق المحلي على المنفذ 3000...
start /b node server/index.js
timeout /t 2 /nobreak >nul

echo [2/2] جاري إنشاء وتفعيل الرابط الأونلاين العام (Cloudflare HTTPS)...
echo.
echo سيظهر لك الآن الرابط الأونلاين (https://...trycloudflare.com)
echo انسخه وأرسله للطلاب وللدكتور مباشرة!
echo.
.\cloudflared.exe tunnel --url http://localhost:3000
pause

