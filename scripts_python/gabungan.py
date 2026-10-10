"""Indeks pesanan dari data mentah marketplace lama di folder GABUNGAN ALL (export Shopee & TikTok).
Dipakai untuk mengisi data yang kosong (nama produk, alamat/kecamatan) berdasarkan nomor pesanan.
Hasil dicache ke data/gabungan_index.pkl (dibaca ulang hanya kalau file sumber berubah)."""
import glob
import os
import pickle
import re

import openpyxl

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
FOLDER = os.path.join(BASE, "2- DATA LAMA", "GABUNGAN ALL")
CACHE = os.path.join(BASE, "1- APPS", "zaneva-dashboard", "data", "gabungan_index.pkl")

SHOPEE_COLS = {
    "no": "No. Pesanan", "status": "Status Pesanan", "dibuat": "Waktu Pesanan Dibuat",
    "produk": "Nama Produk", "sku": "Nomor Referensi SKU", "variasi": "Nama Variasi",
    "harga": "Harga Setelah Diskon", "harga_awal": "Harga Awal", "subtotal": "Subtotal Pesanan", "total_bayar": "Total Pembayaran",
    "qty": "Jumlah", "alamat": "Alamat Pengiriman", "voucher": "Voucher Ditanggung Penjual",
    "retur": "Status Pembatalan/ Pengembalian", "resi": "No. Resi", "kota": "Kota/Kabupaten", "prov": "Provinsi",
}
TIKTOK_COLS = {
    "no": "Order ID", "status": "Order Status", "dibuat": "Created Time", "produk": "Product Name",
    "sku": "Seller SKU", "variasi": "Variation", "harga": "SKU Subtotal After Discount", "harga_awal": "SKU Unit Original Price",
    "subtotal": "SKU Subtotal Before Discount", "total_bayar": "Order Amount", "qty": "Quantity",
    "retur": "Cancelation/Return Type", "resi": "Tracking ID",
    "alamat": "Detail Address", "kota": "Regency and City", "prov": "Province",
}


def idr(v):
    """'169.000' / 169000 / '169,000.00' -> float"""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("Rp", "").replace(" ", "")
    if not s:
        return 0.0
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        return float(s.replace(".", ""))
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", s):
        return float(s.replace(",", ""))
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return 0.0


def _cell(r, i):
    if i is None or i >= len(r) or r[i] is None:
        return ""
    return str(r[i]).strip()


def _small_int(v):
    t = str(v).strip() if v is not None else ""
    return bool(re.fullmatch(r"\d{1,3}", t)) and 1 <= int(t) <= 200


def _index_file(path, index):
    name = os.path.basename(path)
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(it)]
    tiktok = "Order ID" in header
    cols = TIKTOK_COLS if tiktok else SHOPEE_COLS
    ix = {k: header.index(v) if v in header else None for k, v in cols.items()}
    n = 0
    for r in it:
        if not r:
            continue
        # Beberapa file (CHIC) menggabungkan ekspor bersusunan kolom beda: seluruh kolom sejak indeks 3 bergeser.
        # Pergeseran dideteksi dari kolom qty (harus bilangan bulat kecil).
        s = 0
        if not tiktok and ix["qty"] is not None:
            for cand in (0, 1, -1, 2, -2, 3, -3):
                j = ix["qty"] + cand
                if 0 <= j < len(r) and _small_int(r[j]):
                    s = cand
                    break

        def col(k):
            i = ix.get(k)
            if i is None:
                return None
            j = i + s if i >= 3 else i
            return j if 0 <= j < len(r) else None

        def txt(k):
            j = col(k)
            return "" if j is None or r[j] is None else str(r[j]).strip()

        def num(k):
            j = col(k)
            return idr(r[j]) if j is not None else 0.0

        no = txt("no")
        # baris ke-2 export TikTok adalah deskripsi kolom; abaikan baris tanpa nomor pesanan yang masuk akal
        if not no or len(no) < 6 or " " in no:
            continue
        o = index.setdefault(no, dict(file=name, status=txt("status"), dibuat=txt("dibuat")[:19],
                                      alamat=txt("alamat"), kota=txt("kota"), prov=txt("prov"), resi=txt("resi"),
                                      tiktok=tiktok, lines=[]))
        if o["file"] != name:      # pesanan sama muncul di dua file: pakai file pertama saja (hindari baris ganda)
            continue
        if not o["alamat"] and txt("alamat"):
            o["alamat"] = txt("alamat")
        line = dict(produk=txt("produk"), sku=txt("sku"), variasi=txt("variasi"), harga=num("harga"),
                    harga_awal=num("harga_awal"), subtotal=num("subtotal"), total_bayar=num("total_bayar"),
                    voucher=num("voucher"), retur=txt("retur"), raw_harga=txt("harga"),
                    qty=int(num("qty") or 1))
        if line in o["lines"]:     # baris identik penuh dalam satu pesanan = ekspor ganda
            continue
        o["lines"].append(line)
        n += 1
    return n


def load_gabungan(force=False):
    files = sorted(f for f in glob.glob(os.path.join(FOLDER, "*.xlsx")) if not os.path.basename(f).startswith("~$"))
    sig = [(os.path.basename(f), os.path.getmtime(f), os.path.getsize(f)) for f in files]
    if not force and os.path.exists(CACHE):
        with open(CACHE, "rb") as fh:
            data = pickle.load(fh)
        if data.get("sig") == sig:
            return data["index"]
    index, counts = {}, {}
    for f in files:
        counts[os.path.basename(f)] = _index_file(f, index)
    with open(CACHE, "wb") as fh:
        pickle.dump(dict(sig=sig, index=index, counts=counts), fh)
    return index


if __name__ == "__main__":
    import time
    t = time.time()
    idx = load_gabungan(force=True)
    print(f"{len(idx)} pesanan terindeks dalam {time.time() - t:.0f}s")
