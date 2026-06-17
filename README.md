# MYPLMH

**make your photo look more handsome** — fotoğrafını yüklüyorsun, pikselleri
dağılıp rastgele bir Atatürk fotoğrafına dönüşüyor.

yüklediğin fotoğrafın kendi pikselleri yer değiştirip Atatürk'ün portresini
oluşturuyor. yani ekranda başka bir fotoğraf "açılmıyor", senin fotoğrafın
gerçekten o portreye dönüşüyor. sonunda bir de Atatürk sözü çıkıyor, istersen
tüm gösteriyi video olarak kaydedip paylaşabiliyorsun.

## nasıl kullanılır

1. `fotoğraf yükle` (ya da sürükle-bırak)
2. izle: foto dağılır → pikseller yeni yerine gider → portre belirir
3. `başka` ile farklı bir Atatürk fotoğrafı, `tekrar` ile aynısını yeniden,
   `kaydet` ile videosunu indirebilirsin

## altyapı

- **Vite + TypeScript** — geliştirme ve derleme
- **saf HTML5 Canvas (2D)** — tüm animasyon burada, ekstra grafik kütüphanesi yok
- **MediaRecorder API** — gösteriyi WebM videoya çevirip indirme
- **runtime bağımlılığı yok** — `package.json`'da sadece `vite` ve `typescript`
  (ikisi de devDependencies). bundle'da senin yazdığın koddan başka bir şey yok
- **backend yok** — her şey tarayıcıda dönüyor. statik site olarak GitHub Pages /
  Vercel / Netlify'a olduğu gibi atılabilir

## nasıl çalışıyor (motorun içi)

morph mantığı `src/particles.ts` içinde. özetle:

1. **örnekleme** — hem yüklenen foto hem hedef Atatürk fotoğrafı 200×200'lük bir
   ızgaraya indirgenir (yani ~40.000 parçacık). hedef "contain" ile sığdırılır ki
   kafa/kenar kırpılmasın.
2. **eşleme** — iki taraftaki pikseller parlaklığa göre sıralanıp rank rank
   eşlenir. böylece kaynağın koyu pikselleri portrenin koyu bölgelerine, açık
   pikselleri açık bölgelerine düşer. her parçacığın nereye gideceği buradan çıkar.
3. **renk** — her parçacık kendi rengini (tonunu) korur, sadece parlaklığı hedefe
   taşınır (`renk + (hedefParlaklık − kaynakParlaklık)`). luminans doğrusal olduğu
   için sonuç tam hedef parlaklığını alır → portre her fotoğrafta net çıkar, ama
   renkler senin fotoğrafından gelir. yani çıktı yüklediğin görsele göre değişir.
4. **animasyon** — parçacıklar `duruş → dağılma → hedef konum` boyunca easing ve
   parçacık başına küçük gecikmelerle hareket eder. çizim tek bir `ImageData`
   buffer'ına yapılır, her karede buffer hafifçe karartılır (hareket izi). hedef
   Atatürk fotoğrafı ekrana hiç olduğu gibi basılmaz; yalnızca piksel değerlerini
   okumak için görünmez bir tuvalde kullanılır.

## proje yapısı

```
Atam/            dönüşülecek Atatürk fotoğrafları
index.html
src/
  main.ts        arayüz, foto yükleme, akışın yönetimi
  particles.ts   morph motoru (örnekleme, eşleme, animasyon, render)
  recorder.ts    canvas → WebM video kaydı
  quotes.ts      Atatürk sözleri
  style.css
```

## çalıştırma

```bash
npm install
npm run dev      # geliştirme
npm run build    # üretim derlemesi (dist/)
npm run preview  # derlemeyi önizle
```

## fotoğraflar (Atam klasörü)

dönüşülen fotoğraflar projedeki `Atam` klasöründe duruyor. Vite bunları derleme
sırasında `import.meta.glob` ile topluyor, ayrı bir liste/manifest tutmaya gerek
yok. kendi fotoğraflarını eklemek istersen klasöre atman yeterli.

## kaydetme

`kaydet` butonu gösteriyi 60 fps WebM olarak kaydedip indiriyor. paylaşmak için
birebir.
