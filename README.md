# MyPDF Puzzle 🧩

PWA untuk upload PDF puzzle (word search, murder mystery, dll.) dan conteng terus atasnya guna **jari atau stylus**.
Semua PDF dan conteng disimpan **dalam telefon** (IndexedDB) dan app boleh digunakan **offline**.

## Fungsi
- **Upload PDF atau gambar** (JPG, PNG, WebP, dll.): boleh pilih beberapa fail sekali gus. Gambar ditukar jadi PDF satu halaman supaya semua tool boleh digunakan. Fail disimpan dalam storan telefon.
- **Pen**: ikut tekanan stylus (S Pen / Apple Pencil). Ada 6 warna dan saiz boleh ubah.
- **Highlight**: penanda lutsinar, teks di bawahnya masih nampak.
- **Garis**: highlight garis lurus, sesuai untuk word search. Ia snap sendiri ke arah mendatar, menegak atau pepenjuru.
- **Padam**: sapu atas conteng untuk padamkannya.
- **Undo / Redo**, padam semua conteng satu halaman atau seluruh PDF.
- **Zoom**: cubit dengan 2 jari, atau guna butang − / +.
- **Stylus sahaja**: bila ON, hanya stylus boleh conteng. Jari untuk scroll dan zoom, dan tapak tangan diabaikan. Mod ni ON sendiri bila stylus dikesan.
- **Auto-save**: halaman terakhir dan zoom diingat.
- **Simpan / Kongsi PDF berconteng**: export jadi fail PDF baru.

## Cara guna di telefon
App ni mesti di-host atas **HTTPS** supaya service worker dan install jalan. Cara paling senang ialah GitHub Pages:

1. Pergi ke repo, kemudian **Settings → Pages**.
2. Untuk *Source* pilih **Deploy from a branch**, pilih branch dan folder `/ (root)`, lepas tu **Save**.
3. Buka link `https://noramumiizdihar.github.io/mypdf/` di Chrome (Android) atau Safari (iPhone/iPad).
4. Install: **⋮ → Add to Home screen / Install app** (Android), atau **Share → Add to Home Screen** (iOS).

## Jalankan secara lokal
```bash
python3 -m http.server 8000
# buka http://localhost:8000
```

## Nota
- Library: [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 (paparan) dan [pdf-lib](https://pdf-lib.js.org/) 1.17.1 (export). Kedua-duanya dalam folder `vendor/`, jadi app tak perlu internet.
- Bila ubah fail app, naikkan `VERSION` dalam `sw.js` supaya telefon dapat versi baru.
- App minta storan "kekal" (persistent) supaya browser tak padam PDF bila telefon kurang ruang. Tapi kalau kau *Clear site data* atau uninstall browser, data tetap hilang.
