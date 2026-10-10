"""Analisis sekali jalan untuk merapikan platform/akun, mengecek duplikat, dan menilai kualitas alamat."""
import csv
import os
import re
import sys
from collections import Counter, defaultdict

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "2- DATA LAMA"))
DATA = os.path.join(BASE, "..", "1- APPS", "zaneva-dashboard", "data")


def shape(no):
    no = str(no or "")
    if len(no) == 8 and all(c in "0123456789abcdef" for c in no):
        return "hash8"
    if len(no) >= 12 and no[:6].isdigit():
        return "shopee-like"
    if no.isdigit() and len(no) > 14:
        return "tiktok-like"
    return "other"


plat = defaultdict(Counter)
null_info = Counter()

for y in (2022, 2023, 2024, 2025, 2026):
    ws = openpyxl.load_workbook(os.path.join(BASE, "APPS LAMA", f"Seller-Report-{y}.xlsx"),
                                read_only=True, data_only=True)["report_seller"]
    for r in ws.iter_rows(min_row=2, values_only=True):
        p = r[12]
        plat[p][f"SR{y}"] += 1
        if p in (None, "NULL", ""):
            null_info[(f"SR{y}", shape(r[0]), str(r[3]))] += 1

ws = openpyxl.load_workbook(os.path.join(BASE, "SUMBER AWAL", "NEW SYSTEM - Periode Okt 24 sd Okt 25.xlsx"),
                            read_only=True, data_only=True)["PENJUALAN"]
for r in ws.iter_rows(min_row=2, values_only=True):
    plat[r[11]]["PENJUALAN"] += 1
    if r[11] in (None, "NULL", ""):
        null_info[("PENJUALAN", shape(r[0]), str(r[3]))] += 1

ws = openpyxl.load_workbook(os.path.join(BASE, "SUMBER AWAL", "BACK UP zaineva hijab_data - 29.08 SORE.xlsx"),
                            read_only=True, data_only=True)["Jual"]
jual_ids = Counter()
for r in ws.iter_rows(min_row=2, values_only=True):
    plat[r[21]]["JUAL"] += 1
    jual_ids[r[1]] += 1
    if r[21] in (None, "NULL", ""):
        null_info[("JUAL", shape(r[1]), str(r[9]))] += 1

csv_products = defaultdict(set)
with open(os.path.join(BASE, "APPS LAMA", "orders_semua-status_2026-01-01_2026-08-31.csv"), encoding="utf-8-sig") as fh:
    for r in csv.DictReader(fh):
        plat[r["Platform"]]["CSV2026"] += 1
        csv_products[r["Platform"]].add(r["Produk"])

with open(os.path.join(DATA, "platform_variants.txt"), "w", encoding="utf-8") as out:
    for k, v in sorted(plat.items(), key=lambda x: -sum(x[1].values())):
        out.write(f"{sum(v.values()):8d}  {k!r:60s} {dict(v)}\n")

print("distinct platform strings:", len(plat))
print("\nNULL/empty platform (source, orderNo shape, metode):")
for k, v in null_info.most_common(25):
    print(f"  {v:7d} {k}")

print("\nJual duplicate IDs:", sum(1 for v in jual_ids.values() if v > 1))

print("\nCSV2026 - kemiripan produk antar varian akun (Jaccard vs 'MP SHOPEE ZANEVA'):")
base = csv_products.get("MP SHOPEE ZANEVA", set())
for k, s in sorted(csv_products.items(), key=lambda x: -len(x[1]))[:22]:
    j = len(s & base) / max(1, len(s | base))
    print(f"  {k!r:45s} produk={len(s):5d} jaccard={j:.2f}")

# --- duplikat pada orders_clean.csv ---
print("\nDuplikat di orders_clean.csv:")
keys_full = Counter()
order_sources = defaultdict(set)
with open(os.path.join(DATA, "orders_clean.csv"), encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        keys_full[(r["orderNo"], r["sku"], r["qty"], r["revenue"], r["orderDate"])] += 1
        order_sources[r["orderNo"]].add(r["sourceFile"])
dup_groups = [(k, v) for k, v in keys_full.items() if v > 1]
print("  grup baris identik (order+sku+qty+revenue+tanggal):", len(dup_groups),
      "| baris berlebih:", sum(v - 1 for _, v in dup_groups))
print("  orderNo muncul di >1 file sumber:", sum(1 for s in order_sources.values() if len(s) > 1))
for k, v in dup_groups[:8]:
    print("   ", v, k)
