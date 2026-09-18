import csv
 
# Girdi ve çıktı dosya yollarını buradan değiştirebilirsin
GIRDI_DOSYASI = "C:\\Users\\emrev\\Documents\\Antigravity Projects\\kelime_oyunu\\turkish-dictionary-dataset-and-statistics-main\\turkish_words_clean.csv"
CIKTI_DOSYASI = "C:\\Users\\emrev\\Documents\\Antigravity Projects\\kelime_oyunu\\bes_harfli_kelimeler\\bes_harfli_kelimeler_cikti.csv"
 
bes_harfli_kelimeler = []
 
with open(GIRDI_DOSYASI, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for satir in reader:
        kelime = satir["word"].strip()
        if len(kelime) == 5:
            bes_harfli_kelimeler.append(satir["word"])
 
# Sonuçları yeni bir CSV dosyasına yaz
if bes_harfli_kelimeler:
    with open(CIKTI_DOSYASI, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["word"])
        writer.writeheader()
        for kelime in bes_harfli_kelimeler:
            writer.writerow({"word": kelime.lower()})
 
print(f"Toplam {len(bes_harfli_kelimeler)} adet 5 harfli kelime bulundu.")
print(f"Sonuçlar '{CIKTI_DOSYASI}' dosyasına kaydedildi.")