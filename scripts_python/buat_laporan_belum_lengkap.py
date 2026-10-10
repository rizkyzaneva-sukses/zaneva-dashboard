"""Laporan Excel: data yang TETAP kosong setelah dilengkapi dari data mentah, supaya user bisa memutuskan.
Kolom '... FINAL' (kuning) dibaca ETL bila file disimpan di folder RAPIHKAN DATA dengan awalan BERESIN."""
import os
import sys
from collections import defaultdict

import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as b  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
AUDIT = b.AUDIT_XLSX
OUT = os.path.join(b.ISIAN_DIR, "BERESIN-3 LAPORAN data belum lengkap (isi kolom FINAL).xlsx")
b.load_master()
YEL = PatternFill("solid", fgColor="FFF2CC")
HEAD = PatternFill("solid", fgColor="DDEBF7")


def per_order(sheet, cols):
    """Gabungkan baris AUDIT menjadi satu baris per pesanan. cols: nama kolom AUDIT yang dibawa."""
    wa = openpyxl.load_workbook(AUDIT, read_only=True, data_only=True)
    it = wa[sheet].iter_rows(values_only=True)
    hdr = list(next(it))
    ix = {h: i for i, h in enumerate(hdr)}
    out = {}
    for r in it:
        no = r[ix["No Pesanan"]]
        if not no:
            continue
        o = out.get(no)
        if o is None:
            o = out[no] = {c: r[ix[c]] for c in cols}
            o["No Pesanan"], o["Omzet"], o["Baris"] = no, 0.0, 0
        o["Omzet"] += float(r[ix["Omzet"]] or 0)
        o["Baris"] += 1
    return sorted(out.values(), key=lambda o: -o["Omzet"])


def sheet(wb, title, intro, header, rows, widths, final_cols):
    ws = wb.create_sheet(title)
    ws.append([intro])
    ws.append([])
    ws.append(header)
    for c in ws[3]:
        c.font = Font(bold=True)
        c.fill = HEAD
    for row in rows:
        ws.append(row)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "C4"
    ws.auto_filter.ref = f"A3:{openpyxl.utils.get_column_letter(len(header))}{3 + len(rows)}"
    for r in range(4, 4 + len(rows)):
        for c in final_cols:
            ws.cell(r, c).fill = YEL
    return ws


wb = Workbook()
ws0 = wb.active
ws0.title = "Ringkasan"

cols = ["Tanggal", "Sumber", "Marketplace", "Label produk asli", "Kode produk", "Kota (hasil)", "Kecamatan (hasil)",
        "Provinsi asli", "Alamat (dipotong 200 huruf)", "Alasan"]
prod = per_order("Produk Kosong", cols)
loc = per_order("Lokasi Kosong", cols)
kec = per_order("Kecamatan Kosong", cols)


def readable(o):
    w = (o["Alasan"] or "").casefold()
    return "disensor" not in w and "kosong di data" not in w


kec.sort(key=lambda o: (not readable(o), -o["Omzet"]))

sheet(wb, "Produk Kosong",
      "Pesanan yang nama produknya tetap kosong setelah dilengkapi dari data mentah. Isi 'Produk FINAL' (nama/SKU produk). Kosongkan bila tidak diketahui.",
      ["No", "No Pesanan", "Tanggal", "Sumber", "Channel", "Baris", "Omzet (Rp)", "Label asli", "Kode produk", "Alasan", "Produk FINAL (isi di sini)"],
      [[i, o["No Pesanan"], o["Tanggal"], o["Sumber"], o["Marketplace"], o["Baris"], o["Omzet"], o["Label produk asli"],
        o["Kode produk"], o["Alasan"], None] for i, o in enumerate(prod, 1)],
      [6, 26, 12, 11, 12, 7, 14, 26, 24, 52, 34], [11])

sheet(wb, "Kota-Provinsi Kosong",
      "Pesanan yang kotanya tetap kosong (Booth/Komunitas memang dikosongkan dan tidak ikut). Isi 'Kota FINAL' dan/atau 'Provinsi FINAL'.",
      ["No", "No Pesanan", "Tanggal", "Sumber", "Channel", "Baris", "Omzet (Rp)", "Provinsi asli", "Alamat (dipotong)", "Alasan",
       "Kota FINAL (isi di sini)", "Provinsi FINAL (isi di sini)"],
      [[i, o["No Pesanan"], o["Tanggal"], o["Sumber"], o["Marketplace"], o["Baris"], o["Omzet"], o["Provinsi asli"],
        o["Alamat (dipotong 200 huruf)"], o["Alasan"], None, None]
       for i, o in enumerate([x for x in loc if x["Marketplace"] not in ("BOOTH", "KOMUNITAS")], 1)],
      [6, 26, 12, 11, 12, 7, 14, 20, 50, 46, 26, 22], [11, 12])

sheet(wb, "Kecamatan Kosong",
      "Kota ada, kecamatan kosong (satu baris per pesanan). Atas = alamat terbaca (bisa diisi dari alamat); bawah = alamat disensor marketplace. Isi 'Kecamatan FINAL'; '-' = tidak diketahui.",
      ["No", "No Pesanan", "Tanggal", "Sumber", "Channel", "Kota", "Baris", "Omzet (Rp)", "Alamat (dipotong)", "Status alamat", "Kecamatan FINAL (isi di sini)"],
      [[i, o["No Pesanan"], o["Tanggal"], o["Sumber"], o["Marketplace"], o["Kota (hasil)"], o["Baris"], o["Omzet"],
        o["Alamat (dipotong 200 huruf)"], "Alamat terbaca" if readable(o) else "Alamat disensor / kosong", None]
       for i, o in enumerate(kec, 1)],
      [6, 26, 12, 11, 12, 24, 7, 14, 60, 24, 32], [11])

import csv as _csv
tk = wb.create_sheet("TikTok per bulan")
tk.append(["Perbandingan jumlah pesanan TikTok: data lama vs data mentah. 'Tidak ditambahkan' = bulan yang sudah ada di data lama; nomor pesanan TikTok lama rusak (format ilmiah) sehingga tidak bisa dicocokkan per pesanan, jadi tidak ditambahkan agar tidak dobel."])
tk.append([])
with open(os.path.join(os.path.dirname(__file__), "..", "data", "tiktok_bulan.csv"), encoding="utf-8") as fh:
    for i, row in enumerate(_csv.reader(fh)):
        tk.append([int(x) if i and x.isdigit() else x for x in row])
for col, w in zip("ABCD", [12, 26, 34, 26]):
    tk.column_dimensions[col].width = w
ms = wb.create_sheet("Master SKU")
ms.append(["SKU master", "Kategori", "Brand"])
for e in sorted(b.MASTER.values(), key=lambda e: e["sku"].casefold()):
    ms.append([e["sku"], e["cat"], e["brand"]])
ms.column_dimensions["A"].width = 46
dv = DataValidation(type="list", formula1=f"='Master SKU'!$A$2:$A${len(b.MASTER) + 1}", allow_blank=True, showErrorMessage=False)
wb["Produk Kosong"].add_data_validation(dv)
dv.add(f"K4:K{3 + len(prod)}")

n_read = sum(1 for o in kec if readable(o))
ws0.append(["LAPORAN DATA YANG MASIH KOSONG (setelah dilengkapi dari data mentah GABUNGAN ALL)"])
ws0.append([])
ws0.append(["Jenis", "Pesanan", "Omzet (Rp)", "Catatan"])
for c in ws0[3]:
    c.font = Font(bold=True)
    c.fill = HEAD
ws0.append(["Produk kosong", len(prod), sum(o["Omzet"] for o in prod), "Sheet 'Produk Kosong'"])
ws0.append(["Kota/Provinsi kosong", len([x for x in loc if x["Marketplace"] not in ("BOOTH", "KOMUNITAS")]),
            sum(o["Omzet"] for o in loc if o["Marketplace"] not in ("BOOTH", "KOMUNITAS")), "Booth/Komunitas memang tanpa lokasi pembeli"])
ws0.append(["Kecamatan kosong - alamat terbaca", n_read, sum(o["Omzet"] for o in kec if readable(o)), "Bisa diisi dari alamat"])
ws0.append(["Kecamatan kosong - alamat disensor", len(kec) - n_read, sum(o["Omzet"] for o in kec if not readable(o)),
            "TikTok menyensor kecamatan & alamat di export; hampir tidak bisa dipulihkan"])
ws0.column_dimensions["A"].width = 38
ws0.column_dimensions["C"].width = 18
ws0.column_dimensions["D"].width = 70
wb.save(OUT)
print("file:", OUT)
print("produk kosong:", len(prod), "| kota/prov kosong:", len(loc), "| kecamatan kosong:", len(kec), "(terbaca", n_read, ")")
