@echo off
chcp 65001 >nul
title رفع التطبيق على Google Firebase
echo ========================================================
echo       رفع التطبيق على Google Firebase Hosting
echo ========================================================
echo.
echo [1/2] التحقق من تسجيل الدخول لحساب Google...
call firebase login
echo.
echo [2/2] جاري نشر التطبيق على رابط Google السحابي الدائم...
call firebase deploy --only hosting
echo.
echo ========================================================
echo 🎉 تم الرفع بنجاح!
echo رابط تطبيقك الدائم الرسمي من Google هو:
echo 👉 https://smart-attendance-7019f.web.app
echo ========================================================
pause

