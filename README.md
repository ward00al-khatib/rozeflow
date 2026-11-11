# ROZEFLOW

موقع ألعاب خاص بالدعوات، بنقاط افتراضية فقط لا تُشترى ولا تُسحب ولا تُحوّل. المواصفات الكاملة في [docs/SPEC.md](docs/SPEC.md).

## التشغيل محلياً

```bash
npm ci
cp .env.example .env.local   # ثم املأ القيم
npm run dev
```

## الفحوص

| الأمر | ماذا يفحص |
|---|---|
| `npm test` | اختبارات الوحدات، ومنها مطابقة محرك العشوائية لمتجهات الاختبار |
| `npm run vectors` | يعيد توليد متجهات الاختبار من المرجع المستقل بلغة Python (`scripts/fairness_reference.py`) |
| `npm run test:db` | يطبّق ملفات `supabase/migrations` على قاعدة فارغة ويشغّل فحوص الحماية (يحتاج `DATABASE_URL`) |
| `npm run lint` / `npm run typecheck` / `npm run build` | الجودة والبناء |

## البنية

- `src/lib/fairness/` محرك العشوائية القابل للتحقق (المواصفات 6).
- `supabase/migrations/` مخطط القاعدة: المحفظة والدفتر والجولات والبذور.
- `docs/SPEC.md` وثيقة المواصفات المعتمدة.
