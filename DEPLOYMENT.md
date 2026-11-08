# دليل نشر التطبيق أونلاين مجاناً 24/7 (Deployment Guide)

إذا أردت أن يظل الرابط يعمل دائماً 24 ساعة في اليوم حتى لو قفلت الكمبيوتر، يمكنك رفعه مجاناً بنقرة زر واحدة على أيٍ من المنصات التالية:

---

### الخيار 1: النشر المجاني عبر Render.com (موصى به جداً)
1. قم بإنشاء حساب مجاني على [Render.com](https://render.com).
2. أنشئ مستودعاً جديداً (New Repository) على GitHub وارفع فيه ملفات المشروع.
3. في Render، اختر **New +** ثم **Web Service** واربط المستودع الخاص بك.
4. الإعدادات المطلوبة:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`
5. اضغط **Deploy Web Service**، وخلال دقيقتين سيعطيك Render رابطاً دائماً مثل:
   `https://attendance-system.onrender.com`
   هذا الرابط يعمل للأبد ومجاناً 100%!

---

### الخيار 2: النشر المجاني عبر Railway.app
1. افتح [Railway.app](https://railway.app).
2. اختر **Deploy from GitHub repo**.
3. سيتعرف Railway تلقائياً على مشروع Node.js ويبدأ التشغيل الفوري ويعطيك رابطاً عاماً.

