"""Daftarkan produk baru (hasil konfirmasi user di BERESIN*.xlsx, tidak ada di master) sebagai SKU resmi.
Kategori/brand diambil dari keluarga produk (kata depan) di master bila ada; kalau tidak: 'Belum dikategorikan'/ZANEVA."""
import csv, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as b
sys.stdout.reconfigure(encoding="utf-8")

b.MASTER.clear(); b.FAMILIES.clear()
b.load_master()
fam_cat, fam_brand = defaultdict(Counter), defaultdict(Counter)
for k, e in b.MASTER.items():
    f = b.fam_key(k.split())
    if e["cat"]: fam_cat[f][e["cat"]] += 1
    if e["brand"]: fam_brand[f][e["brand"]] += 1
b.ALIAS.clear(); b.load_alias()
rows = {}
for key, final in b.ALIAS.items():
    k = b.product_key(final)
    if k in b.MASTER or k in rows or re.fullmatch(r"bd \d+", b.product_key(key)) if (re := __import__("re")) else False:
        continue
    f = b.fam_key(k.split())
    cat = fam_cat[f].most_common(1)[0][0] if fam_cat.get(f) else "Belum dikategorikan"
    brand = fam_brand[f].most_common(1)[0][0] if fam_brand.get(f) else "ZANEVA"
    rows[k] = (final, cat, brand)
out = os.path.join(b.MASTER_DIR, "tambahan_master_produk.csv")
with open(out, "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.writer(fh)
    w.writerow(["SKU", "Nama Produk", "Brand", "Kategori", "Unit", "Stok", "ROP", "HPP", "Lead Time", "Status"])
    for sku, cat, brand in sorted(rows.values(), key=lambda x: x[0].casefold()):
        w.writerow([sku, sku, brand, cat, "pcs", 0, 0, 0, 0, "Aktif"])
print("SKU baru didaftarkan:", len(rows), "| dari keluarga dikenal:", sum(1 for v in rows.values() if v[1] != "Belum dikategorikan"))
print(Counter(v[1] for v in rows.values()).most_common(6))
print("contoh:", [(v[0], v[1]) for v in list(rows.values())[:6]])
