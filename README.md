# Bookly 2.0 — AI Book Creator

> *Your story. Your creation.*

Bookly — g‘oyani professional elektron kitobga aylantiruvchi mobile-first platforma:
**G‘oya → AI yaratish → Tahrir → Muqova → Ko‘rish → Eksport → Shaxsiy kutubxona.**

Bu repozitoriy **1-bosqich (Phase 1)**: to‘liq ishlaydigan frontend ilova. Barcha ma’lumotlar
foydalanuvchi qurilmasida saqlanadi (IndexedDB + localStorage). AI funksiyalari **DEMO**
provayderlar orqali ishlaydi va UI’da aniq belgilangan. Supabase va haqiqiy AI 2-bosqichda ulanadi.

## Ishga tushirish

```bash
npm install
npm run dev        # http://localhost:5173 (live reload)
npm run build      # dist/ — istalgan statik hostingga joylash mumkin
npm run preview    # dist/ ni lokal serverda ko‘rish
npm test           # unit + brauzer (e2e) testlari
```

Node.js ≥ 20 kerak. E2E testlar Playwright va Chrome/Chromium bilan ishlaydi
(`CHROME_PATH=/path/to/chrome npm run test:e2e`, yoki `npx playwright install chromium`).

Test yordamchi parametrlari: `?fastAI=1` (DEMO AI kechikishsiz), `?noIntro=1` (kirish animatsiyasisiz).

## GitHub Pages’ga joylash

Sayt manzili: **https://omadbek7109-lang.github.io/bookly.v2/**

Repo ildizida manba kod turadi (`src/`, `public/index.html` — bu shablon, tayyor sahifa emas).
Brauzer ochadigan tayyor ilova faqat `npm run build` dan keyin `dist/` papkasida paydo bo‘ladi.
Shuning uchun Pages **main / (root)** dan emas, build natijasidan berilishi kerak:

1. `.github/workflows/deploy.yml` har `main` push’ida: `npm install` → unit testlar → `npm run build`
   → `dist/` tekshiruvi → `dist/` ni **`gh-pages`** branch’iga joylaydi.
2. Bir martalik sozlama: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: `gh-pages` / `(root)` → Save.**

Build `.nojekyll` (Jekyll o‘chirilgan) va `404.html` (masalan `/bookly.v2/books` → `/bookly.v2/#/books`)
fayllarini ham yaratadi. Asset yo‘llari nisbiy (`./assets/...`), shuning uchun ilova `/bookly.v2/`
ostida ham, Telegram webview’da ham ishlaydi. Boshqa yo‘l uchun: `BASE_PATH=/ npm run build`.

Lokal tekshirish (GitHub Pages bilan bir xil URL tuzilmasi): `npm run build && npm run preview`
→ http://127.0.0.1:5173/bookly.v2/

## Imkoniyatlar

| Bo‘lim | Nima ishlaydi |
|---|---|
| Splash intro | 3D ochiladigan kitob, yorug‘lik zarralari, logo va shior (~4.6 s). O‘tkazib yuborish, `prefers-reduced-motion`, faqat bir marta ko‘rsatiladi, profildan qayta ko‘rish |
| Navigatsiya | Mobil: pastki tab bar + markaziy “+” tugma. Desktop (≥900px): yon panel |
| Bosh sahifa | Salomlashish, 3 slaydli AI banner, 8 ta tezkor amal, davom ettirish, so‘nggi va sevimli kitoblar, tezkor boshlash, statistika, bo‘sh holatlar |
| AI Book Creator | Mavzu, nom, til, toifa, auditoriya, 6 uslub, 3–20 bob, tavsif, ko‘rsatmalar → validatsiya → reja (tahrirlash, tartiblash, qo‘shish/o‘chirish) → **bob-bob generatsiya** progress bilan, to‘xtatish/davom ettirish → saqlash |
| Tahrirlagich | Kitob/bob ma’lumotlari, boblar: qo‘shish, nomlash, o‘chirish, tartiblash. Bloklar: sarlavha (3 daraja), paragraf, iqtibos, ro‘yxat (oddiy/raqamli), rasm, jadval, ajratgich, audio, sahifa uzilishi. Qalin/kursiv/tagiga chizish, tekislash, blok turini o‘zgartirish, Enter bilan bo‘lish, Backspace bilan birlashtirish, undo/redo (Ctrl+Z/Y), avtosaqlash + holat ko‘rsatkichi, qo‘lda saqlash (Ctrl+S), jonli ko‘rish. Mobil: bottom sheet’lar, bob tanlash drawer’i, klaviaturaga moslashuvchi toolbar |
| AI Writing Assistant | Davom ettirish, qayta yozish, kengaytirish, qisqartirish, grammatika, imlo, uslub, tarjima, bob nomlari, kirish, xulosa. Belgilangan matn yoki butun blok. Asl matn **faqat “Qabul qilish”dan keyin** almashtiriladi |
| Muqova dizayneri | Sarlavha/qo‘shimcha/muallif, 6 shrift, 8 muqova shabloni, 4 joylashuv, 10 palitra, gradient/bir rang, o‘z rasmini yuklash (pozitsiya, zoom, qoraytirish), DEMO AI fon (5 uslub), PNG/JPG yuklab olish |
| Shablonlar | 8 toifada 12 ta dizayn shabloni, ko‘rinish, yangi kitob yaratish yoki mavjud kitobga qo‘llash |
| Kutubxona | Barchasi, Qoralamalar, Tugallangan, Sevimlilar, Yaqinda, Savat (30 kun). Qidiruv (matn ichida ham), saralash, toifa filtri. Ochish, tahrir, ko‘rish, nusxa, sevimli, nomlash, o‘chirish/tiklash, eksport |
| O‘quvchi | Muqova sahifasi, mundarija, bob navigatsiyasi, shrift o‘lchami/qator oralig‘i/shrift, yorug‘/sepiya/tungi rejim, o‘qish progressi (saqlanadi), to‘liq ekran, klaviatura (← → Space) |
| Eksport | **PDF, PPTX, EPUB 3, DOCX** — yagona hujjat modelidan; muqova, mundarija, metama’lumot, rasmlar, jadvallar, to‘g‘ri bob tartibi; A4/A5/Letter |
| Import | TXT/Markdown, DOCX, EPUB → Bookly modeli; ogohlantirishlar va xatolar ko‘rsatiladi |
| Profil | Lokal demo profil (ism, avatar), til (uz/ru/en beta), mavzu, standart eksport sozlamalari, zaxira nusxa / tiklash, barcha ma’lumotlarni o‘chirish, kirish animatsiyasi, Bookly haqida, maxfiylik |

## Arxitektura

Batafsil: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Qisqacha:

```
src/
  app/            App shell, router (hash), kontekstlar (sozlamalar, kutubxona, UI)
  components/     Umumiy UI: Icon, Button, Sheet, BookCover, BookMenu …
  features/       home · ai-creator · editor · ai-assistant · cover-designer · templates
                  library · reader · export · import · profile · studio
  models/         book.ts (yagona hujjat modeli + migratsiyalar), templates.ts
  services/
    ai/           TextAIProvider / ImageAIProvider interfeyslari + Demo provayderlar
    storage/      IndexedDB, BookRepository / AssetRepository, sozlamalar, zaxira
    export/       pdf.ts · docx.ts · pptx.ts · epub.ts (DOM’siz, Node’da testlanadi)
    import/       TXT / DOCX / EPUB importerlari
    cover/        Yagona muqova renderer (canvas)
    platform/     Telegram Mini App integratsiyasi
  i18n/           uz (asosiy), ru, en
  styles/         Dizayn tizimi (yorug‘ va qorong‘i mavzu)
tests/
  unit/           Model + eksport fayllarini tekshirish (pdf-lib, JSZip, xmllint, python-docx/pptx)
  e2e/            Playwright: asosiy foydalanuvchi oqimlari, 320–1280px responsive
```

## Xavfsizlik

- Ilovada hech qanday API kaliti yoki maxfiy ma’lumot yo‘q. 1-bosqichda tarmoqqa so‘rov yuborilmaydi.
- Matn va rasm faqat ruxsat etilgan inline teglarga (`b`, `i`, `u`, `br`) sanitizatsiya qilinadi.
- 2-bosqichda AI kalitlari faqat server tomonda (Supabase Edge Functions) saqlanadi.

## Ma’lum cheklovlar (1-bosqich)

- AI natijalari namunaviy (DEMO) generator — haqiqiy til modeli emas.
- PDF standart 14 shriftdan foydalanadi: kirill harflari lotinga transliteratsiya qilinadi (2-bosqichda Unicode shrift qo‘shiladi). EPUB/DOCX/PPTX’da Unicode to‘liq ishlaydi.
- Audio faqat EPUB va ilova ichida ijro etiladi; PDF/DOCX/PPTX’da izoh sifatida chiqadi.
- Ma’lumotlar faqat shu brauzerda; sinxronlash 2-bosqichda.
- Rus va ingliz tarjimalari qisman (yetishmagan matnlar o‘zbekcha).
- Paket qulfi (`package-lock.json`) hali yaratilmagan — birinchi `npm install`da paydo bo‘ladi.
