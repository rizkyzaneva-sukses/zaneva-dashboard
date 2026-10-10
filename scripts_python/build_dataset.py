"""
ETL v2: konsolidasi semua sumber data Zaneva jadi satu CSV bersih (data/orders_clean.csv).
Grain: satu baris = satu SKU di dalam satu pesanan.

SUMBER PER PERIODE (disepakati dengan user; mentah = acuan, APPS LAMA menambal lubang):
  2022-01-11..2022-12-02  Seller-Report-2022        (mentah belum ada)
  2022-12-03..2024-08-29  BACK UP: Jual + Juald     (Juald = detail dari Jual)
  2024-08-30..2024-09-30  Seller-Report-2024        (lubang)
  2024-10-01..2025-11-10  NEW SYSTEM: PENJUALAN
  2025-11-11..2025-12-31  Seller-Report-2025        (lubang, dikonfirmasi user)
  2026-01-01..2026-08-31  orders_semua-status CSV   (app terbaru, dianggap paling benar)
  ORDERAN DARI SHOPEE.xlsx tidak dipakai (sudah tercakup Jual; mencegah duplikat).

ANTI-DUPLIKAT:
  1. baris identik (orderNo, produk, qty, revenue) dalam satu sumber dibuang
  2. pesanan yang sudah ada di sumber berprioritas lebih tinggi dibuang dari sumber lain
     prioritas: Jual > PENJUALAN > OPS2026 > SR2022 > SR2024 > SR2025
  3. tanggal Seller-Report/PENJUALAN yang menyimpang >30 hari dari tanggal di nomor pesanan
     (YYMMDD...) dikoreksi ke tanggal nomor pesanan (batch import ulang).

PLATFORM: dipecah jadi marketplace + akun toko + brand. Tanda kurung = brand produk
(terbukti dari kemiripan produk di CSV 2026). Platform kosong -> MP SHOPEE (instruksi user).
LOKASI: kota/kecamatan/provinsi diisi dari alamat (format Shopee, pola 'Kec.', gazetteer dari data sendiri).
"""

import csv
import datetime
import difflib
import os
import re
import sys
from collections import Counter, defaultdict
from functools import lru_cache

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

# Struktur folder (relatif terhadap lokasi script, jadi bisa dipindah ke PC lain):
#   RAPIHKAN DATA/1- APPS/zaneva-dashboard/scripts_python  <- file ini
#   RAPIHKAN DATA/2- DATA LAMA/{SUMBER AWAL, APPS LAMA, GABUNGAN ALL, OperationZV-*.xlsx}
#   RAPIHKAN DATA/3- MASTER PRODUK   4- ISIAN TIM (BERESIN*, PEMETAAN)   5- LAPORAN   6- BISA DIBUANG
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BASE = os.path.abspath(os.path.join(APP_DIR, "..", ".."))
DATA_LAMA = os.path.join(BASE, "2- DATA LAMA")
MASTER_DIR = os.path.join(BASE, "3- MASTER PRODUK")
ISIAN_DIR = os.path.join(BASE, "4- ISIAN TIM")
LAPORAN_DIR = os.path.join(BASE, "5- LAPORAN")
SUMBER = os.path.join(DATA_LAMA, "SUMBER AWAL")
LAMA = os.path.join(DATA_LAMA, "APPS LAMA")
OUT_DIR = os.path.join(APP_DIR, "data")
OUT_CSV = os.path.join(OUT_DIR, "orders_clean.csv")
REPORT = os.path.join(OUT_DIR, "etl_report.txt")
os.makedirs(OUT_DIR, exist_ok=True)

FIELDS = ["orderNo", "resi", "orderDate", "paymentMethod", "sku", "qty", "revenue", "shippingCost",
          "city", "district", "province", "platformRaw", "marketplace", "account", "brand", "category", "sourceFile", "venue"]
NO_PRODUCT = "(produk tidak tercatat)"
D = datetime.date


# ---------------------------------------------------------------- util umum
def clean_text(v):
    if v is None:
        return ""
    s = str(v).replace("\xa0", " ").replace("\u807d", " ").replace("???", " ")
    s = s.replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()


def is_null(v):
    s = clean_text(v)
    return s == "" or s.upper() in ("NULL", "NONE")


def to_number(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or s.upper() == "NULL":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def to_int(v, default=1):
    n = to_number(v)
    return default if n is None else int(round(n))


def to_date(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    if isinstance(v, (int, float)):
        try:
            return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=v)).date()
        except OverflowError:
            return None
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%d/%m/%Y %H:%M:%S"):
            try:
                return datetime.datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


ORDER_DATE_RE = re.compile(r"^(\d{2})(\d{2})(\d{2})[0-9A-Z]{6,}$")


def date_from_order_no(no):
    m = ORDER_DATE_RE.match(no or "")
    if not m:
        return None
    try:
        return D(2000 + int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def order_shape(no):
    no = no or ""
    if len(no) == 8 and all(c in "0123456789abcdef" for c in no):
        return "hash"
    if no.isdigit() and len(no) > 14:
        return "tiktok"
    return "shopee"


# ---------------------------------------------------------------- platform
BRANDS = ["ZANEVA", "BESYARI", "OBERBE", "MUSWIM", "ELYASR"]
OPERATORS = ["DITA", "YUNI", "TRINDA", "DILLA", "MARIS"]
ACCOUNT_TOKENS = BRANDS + OPERATORS + ["CURVE"]
MARKETS = ["SHOPEE", "TIKTOK", "LAZADA"]
COURIERS = ["JNT", "SAP", "LION", "SICEPAT", "POS", "JNE", "LEX", "WAHANA", "MENGANTAR",
            "DROPSHIP", "DROPSHIPPER", "JAGOPACK", "COD", "CASH", "PENGIRIMAN"]


def _collapse(tok):
    return re.sub(r"(.)\1{2,}", r"\1", tok)


def _fuzzy(tok, choices, cutoff=0.8):
    if tok in choices:
        return tok
    m = difflib.get_close_matches(tok, choices, n=1, cutoff=cutoff)
    return m[0] if m else None


@lru_cache(maxsize=None)
def parse_platform(raw, shape):
    """Return (marketplace, account, brand, brand_src, filled). brand_src: explicit|account|default."""
    s = clean_text(raw).upper().replace("'", "")
    s = re.sub(r"[-_/]+", " ", s)
    m = re.search(r"\(([^)]*)\)?", s)
    paren = m.group(1) if m else ""
    outer = (s[:m.start()] + " " + s[m.end():]) if m else s
    t_out = [_collapse(t) for t in re.findall(r"[A-Z]+", outer)]
    t_par = [_collapse(t) for t in re.findall(r"[A-Z]+", paren)]

    market = None
    accounts = []
    courier = False
    lainnya = False
    for t in t_out:
        if t == "MP":
            continue
        mk = _fuzzy(t, MARKETS, 0.8)
        if mk:
            market = mk
            continue
        if t == "LAINNYA":
            lainnya = True
            continue
        ac = _fuzzy(t, ACCOUNT_TOKENS, 0.8)
        if ac:
            if ac not in accounts:
                accounts.append(ac)
            continue
        if _fuzzy(t, COURIERS, 0.85) or t == "EXPRESS":
            courier = True

    if market == "SHOPEE" and "EXPRESS" in t_out:
        market, courier = None, True

    explicit = _fuzzy("".join(t_par), BRANDS, 0.75) if t_par else None

    filled = False
    if market:
        marketplace = market
    elif courier:
        marketplace = "CASH_COD"
    elif lainnya or accounts:
        marketplace = "LAINNYA"
    else:
        filled = True
        marketplace = {"tiktok": "TIKTOK", "hash": "LAINNYA"}.get(shape, "SHOPEE")

    # Operator = nama operator yang tertulis di platform (DITA/YUNI/...). Brand = tanda kurung, atau nama toko
    # bila itu nama brand (OBERBE/BESYARI/MUSWIM/ELYASR), selain itu ZANEVA. Operator tidak tertulis = ZANEVA (di main).
    operator = next((a for a in accounts if a in OPERATORS), None)
    outer_brand = next((a for a in accounts if a in BRANDS and a != "ZANEVA"), None)
    if explicit:
        brand, src = explicit, "explicit"
    elif outer_brand:
        brand, src = outer_brand, "account"
    else:
        brand, src = "ZANEVA", "default"
    return marketplace, operator, brand, src, filled


# ---------------------------------------------------------------- produk
PCS_RE = re.compile(r"\s*:\s*\d+\s*\(\s*pcs\s*\)\s*$", re.I)


def clean_product(v):
    s = clean_text(v)
    s = PCS_RE.sub("", s)
    s = re.sub(r"\s*\(\s*pcs\s*\)\s*$", "", s, flags=re.I).strip(" :")
    if not s or re.fullmatch(r"[\d.,\s-]*", s):
        return NO_PRODUCT
    return s


def product_key(name):
    return re.sub(r"[^a-z0-9]+", " ", name.casefold()).strip()


# ---------------------------------------------------------------- loader
RECORDS = defaultdict(list)   # sumber -> list of dict
STATS = Counter()


def add(source, order_no, resi, src_date, payment, product, qty, revenue, shipping,
        city, district, province, address, platform, **extra):
    order_no = clean_text(order_no)
    if not order_no or src_date is None or revenue is None:
        return
    if revenue == 0 and to_int(qty) > 100:
        STATS["dibuang: omzet 0 & qty>100 (salah input)"] += 1
        return
    RECORDS[source].append(dict(
        orderNo=order_no, resi=clean_text(resi), srcDate=src_date, payment=clean_text(payment),
        sku=clean_product(product), qty=to_int(qty), revenue=revenue, shipping=shipping,
        city=None if is_null(city) else clean_text(city),
        district=None if is_null(district) else clean_text(district),
        province=None if is_null(province) else clean_text(province),
        address="" if is_null(address) else str(address), platform=platform, source=source,
        product_raw=clean_text(product), extra=extra))


CODE_FILE = os.path.join(ISIAN_DIR, "KODE PRODUK TANPA NAMA - isi nama di kolom terakhir.xlsx")


def load_code_names():
    """Nama produk yang diisi user untuk kode yang namanya kosong di Juald (opsional)."""
    if not os.path.exists(CODE_FILE):
        return {}
    ws = openpyxl.load_workbook(CODE_FILE, read_only=True, data_only=True)["Kode Produk"]
    out = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is not None and r[7] and str(r[7]).strip():
            out[str(r[0]).strip()] = str(r[7]).strip()
    return out


TIKTOK_CATALOG = os.path.join(MASTER_DIR, "DATA PRODUK TIKTOKSHOP ZANEVA.xlsx")


def load_tiktok_catalog():
    """Katalog TikTok Shop: ID SKU -> 'SKU Penjual' (mis. 'Daizy Maroon'). Kode produk di Juald untuk MP TIKTOK = ID SKU ini."""
    if not os.path.exists(TIKTOK_CATALOG):
        return {}
    ws = openpyxl.load_workbook(TIKTOK_CATALOG, read_only=True, data_only=True).worksheets[0]
    out = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[2] is not None and r[4] and str(r[4]).strip():
            out[str(r[2]).strip()] = str(r[4]).strip()
    return out


CODE_NAMES = {**load_tiktok_catalog(), **load_code_names()}   # isian user menang atas katalog


def in_win(d, a, b):
    return d is not None and a <= d <= b


def load_seller_report(source, path, a, b):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["report_seller"]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[23] != "selesai":
            continue
        d = to_date(r[2])
        if not in_win(d, a, b):
            continue
        add(source, r[0], r[1], d, r[3], r[4], r[8], to_number(r[7]), to_number(r[6]),
            r[9], r[10], r[11], r[16], r[12], penginput=r[17])


def load_ops2026(source, path, a, b):
    """OperationZV-Orders (app terbaru). tanggal_pesanan berjam 17:00 = UTC untuk tanggal WIB hari berikutnya
    (terbukti cocok dengan CSV lama: 57.685 baris selisih +1 hari, 924 baris jam 00:00 selisih 0).

    KOREKSI OMZET: pada sebagian order (mis. order manual CRM-...), harga_akhir tiap baris berisi TOTAL ORDER yang
    diulang, bukan harga baris (contoh: 22 baris x Rp 7,7 jt = Rp 169 jt untuk order yang totalnya Rp 7,7 jt).
    Aturan: bila order multi-baris dan jumlah harga_akhir > 1,05 x nilai_order, pakai harga_setelah_diskon
    (total per baris; terbukti = harga_akhir pada 756 baris normal bertipe qty>1)."""
    include = {"PAID_OUT", "SHIPPED", "DISPUTE_WON"}
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["Orders"]
    head = [str(c).strip() for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    ix = {h: i for i, h in enumerate(head)}
    by = defaultdict(list)
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[ix["no_pesanan"]] or str(r[ix["status_order"]]).strip().upper() not in include:
            continue
        try:
            t = datetime.datetime.strptime(str(r[ix["tanggal_pesanan"]])[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        d = (t + datetime.timedelta(hours=7)).date() if t.hour == 17 else t.date()
        if in_win(d, a, b):
            by[r[ix["no_pesanan"]]].append((d, r))
    fx = lambda r, k: to_number(r[ix[k]]) or 0.0
    for no, items in by.items():
        rs = [r for _, r in items]
        nilai, sa = fx(rs[0], "nilai_order"), sum(fx(r, "harga_akhir") for r in rs)
        fix = len(rs) > 1 and nilai > 0 and sa > 1.05 * nilai
        if fix:
            STATS["OPS2026: order dikoreksi (harga_akhir menggelembung)"] += 1
            STATS["OPS2026: kelebihan hitung yang dibuang (Rp)"] += round(sa - sum(fx(r, "harga_setelah_diskon") for r in rs))
        for d, r in items:
            g = lambda k: r[ix[k]]
            rev = fx(r, "harga_setelah_diskon") if fix else to_number(g("harga_akhir"))
            add(source, g("no_pesanan"), g("resi") or g("tracking_no"), d, g("metode_pembayaran"),
                g("nama_produk") or g("sku"), g("qty"), rev, to_number(g("ongkir")),
                g("kota_db") or g("kota_kabupaten"), g("kecamatan"), g("provinsi_db") or g("provinsi"),
                g("alamat_lengkap"), g("platform"))


def load_jual(source, path, a, b):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    header = {}
    for r in wb["Jual"].iter_rows(min_row=2, values_only=True):
        if r[23] != "Terkirim":
            continue
        d = to_date(r[2])
        if not in_win(d, a, b):
            continue
        header[r[1]] = dict(date=d, prov=r[13], city=r[14], dist=r[15], addr=r[4], plat=r[21],
                            resi=r[22], pay=r[9], ongkir=to_number(r[18]), total=to_number(r[16]),
                            isi=r[10], peng=r[31])
    per_order = defaultdict(list)
    for r in wb["Juald"].iter_rows(min_row=2, values_only=True):
        if r[1] in header:
            per_order[r[1]].append(r)
    sub = lambda r: to_number(r[5]) or 0.0
    for oid, rows in per_order.items():
        h = header[oid]
        seen, uniq = set(), []
        for r in rows:
            k = (clean_text(r[6]), to_int(r[3]), sub(r))
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        keep = rows
        extra = len(rows) - len(uniq)
        if extra and h["total"] is not None:
            if abs(sum(map(sub, uniq)) - h["total"]) < 1 <= abs(sum(map(sub, rows)) - h["total"]):
                keep = uniq
                STATS["Jual: baris kembar DIBUANG (total order membuktikan salah input)"] += extra
            else:
                STATS["Jual: baris kembar DIPERTAHANKAN (total order cocok / tidak terbukti)"] += extra
        elif extra:
            STATS["Jual: baris kembar DIPERTAHANKAN (total order kosong)"] += extra
        for r in keep:
            prod = r[6] or r[2]
            if clean_product(prod) == NO_PRODUCT:
                prod = CODE_NAMES.get(str(r[2]).strip() if r[2] is not None else "", prod)
            add(source, oid, h["resi"], h["date"], h["pay"], prod, r[3], to_number(r[5]),
                h["ongkir"], h["city"], h["dist"], h["prov"], h["addr"], h["plat"],
                penginput=h["peng"], kode=r[2], isi_paket=h["isi"])


def load_penjualan(source, path, a, b):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["PENJUALAN"]
    for r in ws.iter_rows(min_row=2, values_only=True):
        d = to_date(r[2])
        if not in_win(d, a, b):
            continue
        add(source, r[0], r[1], d, r[3], r[4], r[8], to_number(r[7]), to_number(r[6]),
            r[9], None, r[10], r[15], r[11], penginput=r[16])


# ---------------------------------------------------------------- lokasi
TAIL_RE = re.compile(r",\s*([^,]{2,60}?)\s*,\s*([^,]{2,60}?)\s*,\s*([^,]{2,40}?)\s*,\s*ID\s*,\s*(\d{5})\s*$", re.I)
CITY_PREFIX = re.compile(r"^(KOTA ADMINISTRASI|KOTA ADM\.?|KOTAMADYA|KODYA|KOTA\s|KABUPATEN|KAB\.?)\s*(.+)$")
KEC_RE = re.compile(
    r"\bKEC(?:AMATAN)?\b\.?\s*[:\-]?\s*([A-Z][A-Z' \-]{2,35}?)"
    r"(?=\s+(?:KOTA|KAB|KABUPATEN|KEL|KELURAHAN|DESA|PROV|PROPINSI|RT|RW|NO)\b|[,;(\d]|$)")

GAZ_CITY = defaultdict(Counter)      # base -> Counter(typ)
GAZ_DIST = defaultdict(Counter)      # canon city -> Counter(district)
GAZ_PROV = defaultdict(Counter)      # canon city -> Counter(province)
PROVINCES = Counter()


DIRS = {"WEST": "BARAT", "EAST": "TIMUR", "SOUTH": "SELATAN", "NORTH": "UTARA", "CENTRAL": "TENGAH"}
ENG_WORDS = {"JAVA": "JAWA", "SUMATRA": "SUMATERA", "ISLANDS": "KEPULAUAN", "ISLAND": ""}
ENG_MARK = re.compile(r"\b(REGENCY|CITY|WEST|EAST|SOUTH|NORTH|CENTRAL|JAVA|SUMATRA|ISLANDS?)\b")
ABBREV = {"SEL": "SELATAN", "UT": "UTARA", "BAR": "BARAT", "TIM": "TIMUR", "TENG": "TENGAH"}
PROV_MAP = {"NANGGROE ACEH DARUSSALAM": "ACEH", "DAERAH ISTIMEWA YOGYAKARTA": "DI YOGYAKARTA",
            "YOGYAKARTA": "DI YOGYAKARTA", "JAKARTA": "DKI JAKARTA", "BANGKA BELITUNG": "KEPULAUAN BANGKA BELITUNG",
            "SG": "LUAR NEGERI", "MY": "LUAR NEGERI"}


def anglicize(s):
    typ = None
    if re.search(r"\bREGENCY\b", s):
        typ, s = "KAB.", re.sub(r"\s*\bREGENCY\b", "", s)
    if re.search(r"\bCITY\b", s):
        typ, s = "KOTA", re.sub(r"\s*\bCITY\b", "", s)
    toks = s.split()
    if len(toks) > 1 and toks[0] in DIRS:
        toks = toks[1:] + [DIRS[toks[0]]]
    elif len(toks) > 1 and toks[-1] in DIRS:
        toks = toks[:-1] + [DIRS[toks[-1]]]
    return typ, " ".join(t for t in (ENG_WORDS.get(t, t) for t in toks) if t)


def split_city(name):
    s = re.sub(r"[^A-Z0-9 .'/-]", " ", clean_text(name).upper())
    s = re.sub(r"^[A-Z]{2}\d{2}\s*-\s*", "", re.sub(r"\s+", " ", s).strip())
    eng_typ = None
    if ENG_MARK.search(s):
        eng_typ, s = anglicize(s)
    m = CITY_PREFIX.match(s)
    if m:
        typ = "KAB." if m[1].startswith("KAB") else "KOTA"
        return typ, re.sub(r"\s+", " ", m[2].replace(".", " ")).strip().replace("JAKARTA TENGAH", "JAKARTA PUSAT")
    return eng_typ, re.sub(r"\s+", " ", s.replace(".", " ")).strip().replace("JAKARTA TENGAH", "JAKARTA PUSAT")


def norm_district(name):
    s = clean_text(name).upper()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"\s*-\s*(KOTA|KAB\.?|KABUPATEN)\s*$", "", s)
    s = re.sub(r"^(KECAMATAN|KEC\.?)\s+", "", s)
    s = re.sub(r"[-]+", " ", s)
    s = re.sub(r"[^A-Z0-9' /]", " ", s)
    return " ".join(ABBREV.get(t, t) for t in s.split())


def norm_prov_text(p):
    s = clean_text(p).upper()
    s = re.sub(r"^[A-Z]{2}\s*-\s*", "", s)
    s = re.sub(r"\s*\(.*?\)", "", s).strip()
    s = re.sub(r"\s*\b(PROVINCE|PROVINSI)\b", "", s).strip()
    if ENG_MARK.search(s):
        _, s = anglicize(s)
    return PROV_MAP.get(s, s)


def parse_tail(addr):
    if not addr or addr.count("*") > 5:
        return None
    m = TAIL_RE.search(clean_text(addr))
    if not m:
        return None
    typ, base = split_city(m[1])
    if not base:
        return None
    return typ or "KOTA", base, norm_district(m[2]), norm_prov_text(m[3])


def build_gazetteer():
    for recs in RECORDS.values():
        for r in recs:
            t = parse_tail(r["address"])
            if not t:
                continue
            typ, base, dist, prov = t
            canon = f"{typ} {base}"
            GAZ_CITY[base][typ] += 1
            if dist:
                GAZ_DIST[canon][dist] += 1
            GAZ_PROV[canon][prov] += 1
            PROVINCES[prov] += 1


@lru_cache(maxsize=None)
def resolve_city(raw, dist_hint):
    typ, base = split_city(raw)
    if not base or base.replace(" ", "").isdigit():
        return None
    if base not in GAZ_CITY:
        m = difflib.get_close_matches(base, list(GAZ_CITY), n=1, cutoff=0.9)
        if m:
            base = m[0]
    types = GAZ_CITY.get(base)
    if not types:
        if re.search(r"\d", base) or len(base) > 40:
            return None
        return f"{typ} {base}" if typ else base
    if typ and types.get(typ):
        return f"{typ} {base}"
    if len(types) == 1:
        return f"{next(iter(types))} {base}"
    if dist_hint:
        for t in types:
            if dist_hint in GAZ_DIST.get(f"{t} {base}", {}):
                return f"{t} {base}"
    return f"{types.most_common(1)[0][0]} {base}"


@lru_cache(maxsize=None)
def dist_regex(city):
    names = [d for d in GAZ_DIST.get(city, {}) if len(d) >= 5]
    if not names:
        return None
    names.sort(key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b")


@lru_cache(maxsize=None)
def match_district(city, cand):
    known = GAZ_DIST.get(city)
    if not known:
        return None
    if cand in known:
        return cand
    m = difflib.get_close_matches(cand, list(known), n=1, cutoff=0.86)
    return m[0] if m else None


@lru_cache(maxsize=None)
def norm_province(p):
    p = norm_prov_text(p)
    if not p:
        return None
    if p in PROVINCES:
        return p
    m = difflib.get_close_matches(p, list(PROVINCES), n=1, cutoff=0.85)
    return m[0] if m else p


def match_prefix(city, cand):
    toks = cand.split()
    for n in range(len(toks), 0, -1):
        c = " ".join(toks[:n])
        if len(c) >= 4:
            hit = match_district(city, c)
            if hit:
                return hit
    return None


@lru_cache(maxsize=1)
def base_regex():
    names = sorted((b for b in GAZ_CITY if len(b) >= 5 and not b.isdigit()), key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b")


def fill_location(r):
    tail = parse_tail(r["address"])
    addr_u = re.sub(r"\s+", " ", clean_text(r["address"]).upper()) if r["address"] and r["address"].count("*") <= 5 else ""

    city = dist = prov = None
    if tail:
        typ, base, dist, prov = tail
        city = f"{typ} {base}"
        if base not in GAZ_CITY:
            city = resolve_city(f"{typ} {base}", "") or city
    if not city and r["city"]:
        hint = norm_district(r["district"]) if r["district"] else ""
        city = resolve_city(r["city"], hint)
    if not city and addr_u:
        found = set(base_regex().findall(addr_u))
        if len(found) == 1:
            city = resolve_city(found.pop(), "")

    if not dist and city:
        cand = norm_district(r["district"]) if r["district"] else ""
        if cand:
            dist = match_district(city, cand)
        if not dist and addr_u:
            m = KEC_RE.search(addr_u)
            if m:
                dist = match_prefix(city, norm_district(m[1]))
        if not dist and addr_u:
            rx = dist_regex(city)
            if rx:
                found = set(rx.findall(addr_u))
                if len(found) == 1:
                    dist = found.pop()

    if not prov:
        if city and GAZ_PROV.get(city):
            prov = GAZ_PROV[city].most_common(1)[0][0]
        elif r["province"]:
            prov = norm_province(r["province"])
    return city, dist or None, prov


# ---------------------------------------------------------------- master produk
import glob

ALIAS_FILE = os.path.join(ISIAN_DIR, "PEMETAAN NAMA PRODUK - koreksi di kolom SKU FINAL.xlsx")
STOP_EXTRA = {"jumbo", "extra", "kids", "anak"}
MASTER, ALIAS = {}, {}


def load_master():
    files = sorted(glob.glob(os.path.join(MASTER_DIR, "master_produk_*.csv")))
    if not files:
        return None
    extra = os.path.join(MASTER_DIR, "tambahan_master_produk.csv")      # SKU baru yang disetujui user (dibuat buat_master_tambahan.py)
    for path in [files[-1]] + ([extra] if os.path.exists(extra) else []):
        with open(path, encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                sku = clean_text(r.get("SKU"))
                if not sku or sku.upper() == "SKU" or product_key(sku) in MASTER:
                    continue
                brand = re.sub(r"[^A-Z]", "", clean_text(r.get("Brand")).upper()) or None
                MASTER[product_key(sku)] = dict(sku=sku, brand=brand, cat=clean_text(r.get("Kategori")) or None)
    build_families()
    build_colors()
    return os.path.basename(files[-1])


def load_alias():
    """Koreksi SKU dari user: kolom 'SKU FINAL'/'FINAL SKU' di file PEMETAAN NAMA PRODUK atau BERESIN*.xlsx
    (header dicari otomatis: kolom 'Nama di data' + kolom yang namanya memuat 'FINAL')."""
    files = [ALIAS_FILE] + sorted(glob.glob(os.path.join(ISIAN_DIR, "BERESIN*.xlsx")))
    for path in files:
        if not os.path.exists(path) or os.path.basename(path).startswith("~$"):
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb:
            name_i = fin_i = None
            for r in ws.iter_rows(values_only=True):
                if name_i is None:
                    cells = [clean_text(c).casefold() for c in r]
                    if "nama di data" in cells or "nama di data (kunci)" in cells:
                        name_i = next(i for i, c in enumerate(cells) if c.startswith("nama di data"))
                        fin_i = next((i for i, c in enumerate(cells) if "final" in c), None)
                    continue
                if fin_i is not None and len(r) > fin_i and r[name_i] and r[fin_i] and clean_text(r[fin_i]):
                    ALIAS[product_key(str(r[name_i]))] = clean_text(r[fin_i])


def _tm(q, m):
    return q == m or (len(q) >= 3 and m.startswith(q))


FAMILIES = defaultdict(list)   # kata depan (atau 2 kata bila awalan 1 huruf, mis. "y raudia") -> kunci master


def fam_key(tokens):
    if len(tokens) > 1 and len(tokens[0]) == 1:
        return " ".join(tokens[:2])
    return tokens[0]


def build_families():
    for k in MASTER:
        FAMILIES[fam_key(k.split())].append(k)


def family_of(qt):
    """Keluarga produk dari KATA DEPAN (kata belakang sering ngaco). -> (kunci master, jml kata keluarga, catatan)"""
    fk = fam_key(qt)
    if fk in FAMILIES:
        return FAMILIES[fk], len(fk.split()), ""
    m = difflib.get_close_matches(fk, list(FAMILIES), n=1, cutoff=0.85)
    if m:
        return FAMILIES[m[0]], len(m[0].split()), f"kata depan mirip '{m[0]}'"
    return None, 0, ""


SIZE_WORDS = {"jumbo", "extra"}


def score(qt, nf, mkey):
    rq, pool = qt[nf:], mkey.split()[nf:]
    for flag in SIZE_WORDS:
        if (flag in rq) != (flag in pool):
            return None
    used, matched, matched_ns = [False] * len(pool), 0, 0
    for q in rq:
        for i, m in enumerate(pool):
            if not used[i] and _tm(q, m):
                used[i] = True
                matched += 1
                matched_ns += q not in SIZE_WORDS
                break
    return dict(matched=matched, matched_ns=matched_ns, unmatched=len(rq) - matched,
                extra=len(pool) - matched, rest=len(pool))


def resolve_family(qkey):
    qt = qkey.split()
    if not qt:
        return None, "-", []
    fam, nf, note = family_of(qt)
    if not fam:
        return None, "-", []
    sc = [(m, s) for m in fam if (s := score(qt, nf, m))]
    tag = f"; {note}" if note else ""
    if not sc:
        return None, "ukuran (jumbo/extra) tidak ada di master", fam[:5]
    perfect = [(m, s) for m, s in sc if s["unmatched"] == 0 and len(qt) > nf]
    if perfect:
        best = min(s["extra"] for _, s in perfect)
        top = [m for m, s in perfect if s["extra"] == best]
        if len(top) == 1:
            return top[0], ("singkatan/urutan kata" if best == 0 else f"kata depan + kata cocok (+{best} kata)") + tag, []
        return None, "ambigu: lebih dari satu SKU master cocok", top[:5]
    if all(s["matched_ns"] == 0 for _, s in sc):
        rest_q = [t for t in qt[nf:] if t not in SIZE_WORDS]
        pools = {t for m, _ in sc for t in m.split()[nf:]}
        # angka (kode produk beda, mis. ELS 10 vs ELS 07) atau kata mirip (typo, mis. navi vs navy) bukan "varian dasar"
        risky = any(t.isdigit() or any(difflib.SequenceMatcher(None, t, w).ratio() >= 0.75 for w in pools) for t in rest_q)
        shortest = min(s["rest"] for _, s in sc)
        top = [m for m, s in sc if s["rest"] == shortest]
        if not risky and len(top) == 1:
            return top[0], "kata depan (kata belakang tak dikenal -> varian dasar)" + tag, []
    ranked = sorted(sc, key=lambda x: (-x[1]["matched"], -difflib.SequenceMatcher(None, qkey, x[0]).ratio()))
    return None, "keluarga produk ada, kata belakang tidak ada di master", [m for m, _ in ranked[:5]]


ABBREV_TOKENS = {"jum": "jumbo", "jmb": "jumbo", "jumb": "jumbo", "standar": "", "standard": "", "stan": "", "std": ""}


def expand_abbrev(qkey):
    """Singkatan tim: Jum=Jumbo, D.Pink/DPink=Dusty Pink, standar/stan = ukuran standar (dibuang)."""
    t = qkey.replace("dpink", "d pink").split()
    out, i = [], 0
    while i < len(t):
        if t[i] == "d" and i + 1 < len(t) and t[i + 1] == "pink":
            out += ["dusty", "pink"]
            i += 2
            continue
        w = ABBREV_TOKENS.get(t[i], t[i])
        if w:
            out.append(w)
        i += 1
    return " ".join(out)


def is_ambiguous(qkey, method, sug):
    """Belum cocok = benar-benar ambigu bila ada beberapa kandidat sama kuat, atau sangat mirip SKU master (dugaan
    typo). Selain itu (tidak ada yang mirip) dianggap PRODUK BARU dan tidak perlu keputusan."""
    if method.startswith("ambigu"):
        return True
    if not sug:
        return False
    if max(difflib.SequenceMatcher(None, qkey, x).ratio() for x in sug) >= 0.85:
        return True
    q_tokens = [t for t in qkey.split()[1:] if len(t) >= 3 and not t.isdigit()]
    return any(t != w and difflib.SequenceMatcher(None, t, w).ratio() >= 0.75
               for t in q_tokens for x in sug for w in x.split()[1:])


@lru_cache(maxsize=None)
def resolve_one(qkey):
    """-> (entry master atau None, metode/alasan, saran SKU)."""
    # aturan BD didahulukan dari alias: BD nn selalu Bergo Diamond nn (permintaan user, konsisten dgn BD lain)
    bd = re.fullmatch(r"bd (\d+)", qkey)
    if bd:  # BD = singkatan Bergo Diamond
        full = f"bergo diamond {bd[1]}"
        if full in MASTER:
            return MASTER[full], "singkatan BD -> Bergo Diamond", ()
        return dict(sku=f"Bergo Diamond {bd[1]}", brand=None, cat=None), "singkatan BD -> Bergo Diamond (produk baru)", ()
    if qkey in ALIAS:
        e = MASTER.get(product_key(ALIAS[qkey]))
        return (e or dict(sku=ALIAS[qkey], brand=None, cat=None)), "alias (koreksi user)", ()
    if qkey in MASTER:
        return MASTER[qkey], "master", ()
    norm = expand_abbrev(qkey)
    if norm != qkey:
        if norm in MASTER:
            return MASTER[norm], "singkatan kata", ()
        qkey = norm
    m, method, sug = resolve_family(qkey)
    if m:
        return MASTER[m], method, ()
    close = difflib.get_close_matches(qkey, list(MASTER), n=1, cutoff=0.92)
    if close:
        return MASTER[close[0]], "fuzzy", ()
    if not sug:
        sug = difflib.get_close_matches(qkey, list(MASTER), n=5, cutoff=0.5)
        method = "keluarga produk tidak ditemukan di master"
    return None, method, tuple(sug)


def split_parts(name):
    """Paket 'A + B' = dua produk. Nama yang persis ada di master/alias tidak dipecah."""
    k = product_key(name)
    if k in MASTER or k in ALIAS or "+" not in name:
        return [name]
    parts = [p.strip() for p in name.split("+") if product_key(p)]
    return parts if len(parts) > 1 else [name]



COLORS = set()
LOC_FIX = {}
ORDER_FIX = {}


COLOR_LIST = {"black", "white", "navy", "grey", "gray", "maroon", "cream", "red", "blue", "green", "brown", "pink", "purple",
              "silver", "gold", "beige", "tan", "khaki", "mocca", "mocha", "milk", "choco", "chocolate", "olive", "army",
              "mustard", "orange", "yellow", "peach", "lilac", "sage", "dusty", "hazelnut", "taupe", "latte", "blush",
              "mint", "denim", "smoke", "coffee", "salem", "lavender", "indigo"}


def build_colors():
    tokens = {t for k in MASTER for t in k.split()}
    COLORS.update(COLOR_LIST & tokens)


def norm_tokens(name):
    """Token nama produk setelah singkatan diperluas (Jum=Jumbo, D.Pink, Whi=White, Bla=Black)."""
    out = []
    for w in expand_abbrev(product_key(name)).split():
        if w not in COLORS and 3 <= len(w) <= 4 and not w.isdigit():
            m = [c for c in COLORS if c.startswith(w)]
            if len(m) == 1:
                w = m[0]
        out.append(w)
    return out


def cluster_new_products(final):
    """Produk yang tidak ada di master: satu produk = satu nama. Gabung varian penulisan (huruf besar/kecil, tanda
    baca, urutan kata, singkatan warna/ukuran, typo kecil) per keluarga produk. -> (nama sebelum, nama sesudah)."""
    groups = defaultdict(lambda: [0.0, Counter()])   # kunci token -> [omzet, Counter(nama asli)]
    for r in final:
        if r["category"] is None and r["sku"] != NO_PRODUCT:
            toks = norm_tokens(r["sku"])
            if not toks:
                continue
            g = groups[tuple(sorted(toks))]
            g[0] += r["revenue"]
            g[1][r["sku"]] += 1
    parent = {k: k for k in groups}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    # keluarga dari token pertama NAMA ASLI (kunci sudah diurutkan alfabet)
    by_first = defaultdict(list)
    for k, (_, names) in groups.items():
        first = norm_tokens(names.most_common(1)[0][0])
        by_first[fam_key(first)].append(k)
    for keys in by_first.values():
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = keys[i], keys[j]
                if {t for t in a if t.isdigit()} != {t for t in b if t.isdigit()}:
                    continue
                if (("jumbo" in a) != ("jumbo" in b)) or (("extra" in a) != ("extra" in b)):
                    continue
                sa, sb = " ".join(a), " ".join(b)
                if len(sa) >= 10 and difflib.SequenceMatcher(None, sa, sb).ratio() >= 0.94:
                    parent[find(a)] = find(b)
    canon = {}
    merged = defaultdict(lambda: [0.0, Counter()])
    for k, (rev, names) in groups.items():
        m = merged[find(k)]
        m[0] += rev
        m[1].update(names)
    for root, (rev, names) in merged.items():
        best = max(names.items(), key=lambda kv: kv[1])[0]
        for k in groups:
            if find(k) == root:
                canon[k] = best
    before = len({r["sku"] for r in final if r["category"] is None and r["sku"] != NO_PRODUCT})
    for r in final:
        if r["category"] is None and r["sku"] != NO_PRODUCT:
            toks = norm_tokens(r["sku"])
            if toks:
                r["sku"] = canon[tuple(sorted(toks))]
    after = len({r["sku"] for r in final if r["category"] is None and r["sku"] != NO_PRODUCT})
    return before, after


def load_loc_fix():
    """Isian 'Kecamatan FINAL' per No Pesanan dari file BERESIN*.xlsx (sheet mana pun yang punya kedua kolom itu)."""
    for path in sorted(glob.glob(os.path.join(ISIAN_DIR, "BERESIN*.xlsx"))):
        if os.path.basename(path).startswith("~$"):
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb:
            no_i = kec_i = None
            for r in ws.iter_rows(values_only=True):
                if no_i is None:
                    cells = [clean_text(c).casefold() for c in r]
                    if "no pesanan" in cells:
                        no_i = cells.index("no pesanan")
                        fin = {k: next((i for i, c in enumerate(cells) if c.startswith(k + " final")), None)
                               for k in ("kecamatan", "kota", "provinsi", "produk")}
                        if all(v is None for v in fin.values()):
                            break
                    continue
                if not r or len(r) <= no_i or not r[no_i]:
                    continue
                no = clean_text(r[no_i])
                for k, i in fin.items():
                    if i is not None and len(r) > i and r[i] and clean_text(r[i]) not in ("", "-"):
                        if k == "kecamatan":
                            LOC_FIX[no] = norm_district(r[i])
                        else:
                            ORDER_FIX.setdefault(no, {})[k] = clean_text(r[i])


def write_mapping_review(unresolved, auto_rows):
    from openpyxl import Workbook
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Perlu keputusan"
    ws1.append(["Nama di data", "Jumlah baris", "Omzet (Rp)", "Usulan SKU master (berdasarkan kata depan)",
                "Alasan belum cocok", "SKU FINAL (isi/koreksi)"])
    for name, (n, rev, sug, why) in sorted(unresolved.items(), key=lambda kv: -kv[1][1])[:2000]:
        ws1.append([name, n, rev, " | ".join(MASTER[s]["sku"] for s in sug), why, ALIAS.get(product_key(name))])
    ws2 = wb.create_sheet("Otomatis (cek)")
    ws2.append(["Nama di data", "Jumlah baris", "Omzet (Rp)", "Hasil SKU master", "Cara cocok", "SKU FINAL (isi/koreksi)"])
    for name, (n, rev, sku, method) in sorted(auto_rows.items(), key=lambda kv: -kv[1][1])[:2000]:
        ws2.append([name, n, rev, sku, method, ALIAS.get(product_key(name))])
    written = {product_key(str(row[0].value)) for ws in (ws1, ws2) for row in ws.iter_rows(min_row=2)}
    left = {k: v for k, v in ALIAS.items() if k not in written}
    if left:
        ws3 = wb.create_sheet("Alias tersimpan")
        ws3.append(["Nama di data (kunci)", "", "", "", "", "SKU FINAL (isi/koreksi)"])
        for k, v in left.items():
            ws3.append([k, None, None, None, None, v])
    for ws in wb:
        ws.freeze_panes = "A2"
        for col, w in zip("ABCDEF", [46, 13, 16, 60, 42, 40]):
            ws.column_dimensions[col].width = w
    wb.save(ALIAS_FILE)


# ---------------------------------------------------------------- file audit
AUDIT_XLSX = os.path.join(LAPORAN_DIR, "AUDIT - data yang perlu dicek.xlsx")
AUDIT_COLS = ["Tanggal", "No Pesanan", "Sumber", "Platform asli", "Marketplace", "Akun", "Brand",
              "Produk (bersih)", "Label produk asli", "Kode produk", "Isi paket (header Jual)", "Qty", "Omzet",
              "Kota (hasil)", "Kecamatan (hasil)", "Kota asli", "Kecamatan asli", "Provinsi asli",
              "Alamat (dipotong 200 huruf)", "Penginput", "Alasan"]
ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def xl(v):
    return ILLEGAL.sub("", v) if isinstance(v, str) else v


def reason_product(r):
    if r["source"] == "Jual":
        kode = clean_text(r["extra"].get("kode"))
        return f"Nama produk kosong di sheet Juald (kode produk: {kode})" if kode else \
            "Nama & kode produk kosong di sheet Juald (ISI PAKET header juga tidak memuat nama)"
    return "Nama produk kosong atau hanya angka di file sumber"


def reason_loc(r, need):
    addr = r["address"]
    if r["marketplace"] in ("BOOTH", "KOMUNITAS"):
        return "Booth/acara komunitas: lokasi = lokasi acara, bukan asal pembeli (memang dikosongkan)"
    if not addr:
        return "Alamat kosong di data sumber"
    if addr.count("*") > 5:
        return "Alamat disensor (****) oleh marketplace"
    return "Alamat ada tapi kota tidak terbaca" if need == "city" else "Alamat tidak memuat kecamatan yang dikenali"


def write_audit(final):
    from openpyxl import Workbook
    cats = [
        ("Produk kosong", "Produk Kosong", lambda r: r["sku"] == NO_PRODUCT,
         lambda r: reason_product(r)),
        ("Lokasi tidak diketahui (kota kosong)", "Lokasi Kosong", lambda r: not r["city_n"],
         lambda r: reason_loc(r, "city")),
        ("Kota ada, kecamatan kosong", "Kecamatan Kosong", lambda r: r["city_n"] and not r["dist_n"],
         lambda r: reason_loc(r, "district")),
    ]
    wb = Workbook(write_only=True)
    ws_sum = wb.create_sheet("Ringkasan")
    sheets = {}
    for _, name, _, _ in cats:
        ws = wb.create_sheet(name)
        ws.freeze_panes = "A2"
        for i, w in enumerate([11, 20, 11, 28, 11, 20, 10, 32, 32, 12, 40, 6, 13, 24, 20, 20, 20, 18, 55, 12, 60], 1):
            ws.column_dimensions[chr(64 + i)].width = w
        ws.append(AUDIT_COLS)
        sheets[name] = ws

    agg = defaultdict(lambda: [0, set(), 0.0])
    why = defaultdict(lambda: [0, set(), 0.0])
    counts = {}
    for cat, name, test, reason in cats:
        rows = sorted((r for r in final if test(r)), key=lambda r: -r["revenue"])
        counts[name] = len(rows)
        for r in rows:
            rs = reason(r)
            x = r["extra"]
            sheets[name].append([xl(v) for v in [
                r["date"], r["orderNo"], r["source"], clean_text(r["platform"]), r["marketplace"], r["account"] or "",
                r["brand"], r["sku"], r["product_raw"], clean_text(x.get("kode")),
                clean_text(x.get("isi_paket"))[:150], r["qty"], r["revenue"], r["city_n"] or "", r["dist_n"] or "",
                r["city"] or "", r["district"] or "", r["province"] or "", clean_text(r["address"])[:200],
                clean_text(x.get("penginput")), rs]])
            for d, key in ((agg, (cat, r["source"], r["date"].year)), (why, (cat, rs))):
                d[key][0] += 1
                d[key][1].add(r["orderNo"])
                d[key][2] += r["revenue"]

    ws_sum.column_dimensions["A"].width = 38
    ws_sum.column_dimensions["B"].width = 70
    for c in "CDEF":
        ws_sum.column_dimensions[c].width = 16
    ws_sum.append(["RINGKASAN DATA YANG PERLU DICEK (tiap kategori punya sheet sendiri, urut omzet terbesar)"])
    ws_sum.append([])
    ws_sum.append(["Kategori", "Alasan", "Baris", "Order", "Omzet (Rp)"])
    for (cat, rs), (n, orders, rev) in sorted(why.items(), key=lambda kv: (kv[0][0], -kv[1][2])):
        ws_sum.append([cat, rs, n, len(orders), rev])
    ws_sum.append([])
    ws_sum.append(["Kategori", "Sumber file", "Tahun", "Baris", "Order", "Omzet (Rp)"])
    for (cat, src, y), (n, orders, rev) in sorted(agg.items()):
        ws_sum.append([cat, src, y, n, len(orders), rev])
    wb.save(AUDIT_XLSX)
    return counts



# ---------------------------------------------------------------- data mentah lama (GABUNGAN ALL)
import gabungan as GB

GB_OK_STATUS = ("Selesai", "Pesanan Diterima")
GB_ADMIN_FACTOR = 0.83     # aturan user: pesanan belum terekap = (harga setelah diskon - voucher penjual) - 17% biaya admin
GB_FILE_PLATFORM = {"DITA_MERGED.xlsx": "MP SHOPEE DITA", "TRINDA_MERGED.xlsx": "MP SHOPEE TRINDA",
                    "Data Penjualan CHIC 2022 - 2026.xlsx": "MP SHOPEE YUNI"}   # toko CHIC = operator Yuni, brand Zaneva (+ produk Besyari via master)
GB_LAST_DATE = D(2026, 8, 31)
TT_SKIPPED = Counter()
COLORISH = COLOR_LIST | {"all", "size", "standar", "standard", "std", "jumbo", "dark", "light", "lt", "abu", "hitam", "putih",
                         "free", "one", "xl", "l", "m", "s"}


def gb_title(t):
    t = re.sub(r"\[[^\]]*\]|\{[^}]*\}|\([^)]*\)", " ", t)
    t = re.split(r"\s+[lI|]\s+|\s+\|\s+", t)[0]
    t = re.sub(r"(?i)\b(new collection|zaneva hijab|zaneva)\b\s*-?", " ", t)
    t = re.sub(r"(?i)\bby\b", " ", t)
    return re.sub(r"\s+", " ", t).strip(" -")


def gb_label(l):
    """Label produk dari baris mentah: Nomor Referensi SKU > Nama Variasi (bila berisi nama produk) > judul + variasi."""
    if l["sku"]:
        return l["sku"]
    first = l["variasi"].split(",")[0].strip()
    toks = first.casefold().split()
    if toks and not (len(toks) == 1 and toks[0] in COLORISH):
        return first
    return f"{gb_title(l['produk'])} {first}".strip()


def gb_line_total(o, l):
    return l["harga"] if o["tiktok"] else l["harga"] * l["qty"]


def _gb_month(o):
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(o["dibuat"][:10], fmt).date().strftime("%Y-%m")
        except ValueError:
            pass
    return "?"


def load_gabungan_missing(existing, existing_resi, tiktok_month):
    """Pesanan Selesai di data mentah yang BELUM ada di sumber lain. Omzet mengikuti aturan user (lihat GB_ADMIN_FACTOR).
    ANTI-DUPLIKAT: (1) nomor pesanan sama -> lewati; (2) nomor resi sama dengan pesanan yang sudah ada -> lewati;
    (3) TikTok: nomor pesanan di data lama rusak (format ilmiah 5,8E+17) sehingga tidak bisa dicocokkan -> TikTok
    hanya ditambahkan pada bulan yang data lamanya (hampir) kosong."""
    idx = GB.load_gabungan()
    raw_tt = Counter(_gb_month(o) for o in idx.values() if o["tiktok"] and o["status"] == "Selesai")
    n_orders = 0
    for no, o in idx.items():
        if no in existing or o["status"] not in GB_OK_STATUS:
            continue
        if o["resi"] and o["resi"].strip().upper() in existing_resi:
            STATS["GABUNGAN: dilewati (resi sudah ada = duplikat)"] += 1
            continue
        if o["tiktok"]:
            m = _gb_month(o)
            if tiktok_month.get(m, 0) > 0.1 * raw_tt.get(m, 1):
                STATS["GABUNGAN: TikTok dilewati (bulan itu sudah ada di data lama)"] += 1
                TT_SKIPPED[m] += 1
                continue
        lines = [l for l in o["lines"] if not l["retur"]]
        d = None
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                d = datetime.datetime.strptime(o["dibuat"][:10], fmt).date()
                break
            except ValueError:
                pass
        if not lines or d is None or d > GB_LAST_DATE or d < D(2022, 1, 1):
            continue
        totals = [gb_line_total(o, l) for l in lines]
        gross = sum(totals)
        if gross <= 0:
            continue
        voucher = max(l["voucher"] for l in lines)
        platform = ("MP TIKTOK" if o["tiktok"] else GB_FILE_PLATFORM.get(o["file"], "MP SHOPEE"))
        n_orders += 1
        for l, t in zip(lines, totals):
            rev = round(max(t - voucher * (t / gross), 0.0) * GB_ADMIN_FACTOR, 2)
            add("GABUNGAN", no, "", d, "", gb_label(l), l["qty"], rev, None, o["kota"], None, o["prov"], o["alamat"], platform)
    STATS["GABUNGAN: pesanan baru ditambahkan"] = n_orders
    return idx


def fix_sr2024_repeated(final, idx):
    """SR2024 (30 Agu-30 Sep 2024): pada order multi-baris, tiap baris berisi TOTAL ORDER (kotor) yang diulang.
    Bila jumlah baris > 1,15x total order menurut data mentah, skala ulang proporsional supaya jumlah = total order."""
    by_order = defaultdict(list)
    for r in final:
        if r["source"] == "SR2024":
            by_order[r["orderNo"]].append(r)
    n_fix = cut = 0.0
    for no, rows in by_order.items():
        o = idx.get(no)
        if len(rows) < 2 or not o or not o["lines"]:
            continue
        target = sum(gb_line_total(o, l) for l in o["lines"]) - max(l["voucher"] for l in o["lines"])
        total = sum(r["revenue"] for r in rows)
        if target > 0 and total > 1.15 * target:
            k = target / total
            for r in rows:
                r["revenue"] = round(r["revenue"] * k, 2)
            n_fix += 1
            cut += total - target
    gross_before = sum(r["revenue"] for rows in by_order.values() for r in rows)
    for rows in by_order.values():
        for r in rows:
            r["revenue"] = round(r["revenue"] * GB_ADMIN_FACTOR, 2)   # aturan user: yang belum dipotong admin -> dipotong 17%
    STATS["SR2024: dipotong 17% biaya admin (Rp dikurangi)"] = round(gross_before * (1 - GB_ADMIN_FACTOR))
    STATS["SR2024: order multi-baris dikoreksi (total order terulang)"] = int(n_fix)
    STATS["SR2024: kelebihan hitung yang dibuang (Rp)"] = round(cut)


def enrich_from_gabungan(final, idx):
    """Isi nama produk kosong dan alamat kosong pada pesanan yang sudah ada, dari data mentah (nomor pesanan sama)."""
    by_order = defaultdict(list)
    for r in final:
        if r["source"] != "GABUNGAN" and r["orderNo"] in idx:
            by_order[r["orderNo"]].append(r)
    n_prod = n_addr = 0
    canon = lambda name: (lambda e: e[0]["sku"] if e[0] else product_key(name))(resolve_one(product_key(name)))
    for no, rows in by_order.items():
        o = idx[no]
        for r in rows:
            if (not r["address"] or r["address"].count("*") > 5) and o["alamat"]:
                r["address"] = o["alamat"]
                n_addr += 1
            if not r["city"] and o["kota"]:
                r["city"] = o["kota"]
            if not r["province"] and o["prov"]:
                r["province"] = o["prov"]
        blanks = [r for r in rows if r["sku"] == NO_PRODUCT]
        if not blanks:
            continue
        cands = [(gb_label(l), l, gb_line_total(o, l)) for l in o["lines"] if not l["retur"] and gb_label(l)]
        used = Counter(canon(r["sku"]) for r in rows if r["sku"] != NO_PRODUCT)
        free = []
        for label, l, t in cands:
            c = canon(label)
            if used.get(c, 0) > 0:
                used[c] -= 1
            else:
                free.append((label, l, t))
        for r in sorted(blanks, key=lambda x: -x["revenue"]):
            if not free:
                break
            best = min(free, key=lambda f: (f[1]["qty"] != r["qty"], abs(f[2] * GB_ADMIN_FACTOR - r["revenue"])))
            free.remove(best)
            r["sku"] = clean_product(best[0])
            n_prod += 1
    STATS["GABUNGAN: baris produk kosong terisi"] = n_prod
    STATS["GABUNGAN: alamat kosong terisi"] = n_addr


# ---------------------------------------------------------------- main
def main():
    lama = lambda f: os.path.join(LAMA, f)
    backup = os.path.join(SUMBER, "BACK UP zaineva hijab_data - 29.08 SORE.xlsx")
    newsys = os.path.join(SUMBER, "NEW SYSTEM - Periode Okt 24 sd Okt 25.xlsx")

    master_name = load_master()
    load_alias()
    print(f"Master produk: {master_name} ({len(MASTER)} SKU) | alias dari user: {len(ALIAS)} | nama kode produk: {len(CODE_NAMES)}")
    print("Membaca sumber...")
    load_jual("Jual", backup, D(2022, 12, 3), D(2024, 8, 29))
    load_penjualan("PENJUALAN", newsys, D(2024, 10, 1), D(2025, 11, 10))
    load_ops2026("OPS2026", os.path.join(DATA_LAMA, "OperationZV-Orders-JanAgustus2026.xlsx"),
                 D(2026, 1, 1), D(2026, 12, 31))
    load_seller_report("SR2022", lama("Seller-Report-2022.xlsx"), D(2022, 1, 1), D(2022, 12, 2))
    load_seller_report("SR2024", lama("Seller-Report-2024.xlsx"), D(2024, 8, 30), D(2024, 9, 30))
    load_seller_report("SR2025", lama("Seller-Report-2025.xlsx"), D(2025, 11, 11), D(2025, 12, 31))

    # ---- data mentah lama: hanya pesanan yang belum ada di sumber lain
    existing = {r["orderNo"] for recs in RECORDS.values() for r in recs}
    existing_resi = {r["resi"].strip().upper() for recs in RECORDS.values() for r in recs if r["resi"]}
    tt_orders = defaultdict(set)
    for recs in RECORDS.values():
        for r in recs:
            if "TIKTOK" in clean_text(r["platform"]).upper():
                tt_orders[r["srcDate"].strftime("%Y-%m")].add(r["orderNo"])
    tiktok_month = {m: len(v) for m, v in tt_orders.items()}
    gidx = load_gabungan_missing(existing, existing_resi, tiktok_month)

    # ---- anti duplikat
    print("Menghapus duplikat...")
    final, seen_orders = [], set()
    dropped_line, dropped_cross, raw_n, dropped_rev = Counter(), Counter(), Counter(), Counter()
    for source in ["Jual", "PENJUALAN", "OPS2026", "SR2022", "SR2024", "SR2025", "GABUNGAN"]:
        seen_lines, mine = set(), set()
        for r in RECORDS[source]:
            raw_n[source] += 1
            if r["orderNo"] in seen_orders:
                dropped_cross[source] += 1
                continue
            if source != "Jual":
                key = (r["orderNo"], product_key(r["sku"]), r["qty"], r["revenue"])
                if key in seen_lines:
                    dropped_line[source] += 1
                    dropped_rev[source] += r["revenue"]
                    continue
                seen_lines.add(key)
            mine.add(r["orderNo"])
            final.append(r)
        seen_orders |= mine

    # ---- koreksi tanggal
    fixed_dates = Counter()
    for r in final:
        d0 = date_from_order_no(r["orderNo"])
        r["date"] = r["srcDate"]
        if d0 and D(2021, 1, 1) <= d0 < r["srcDate"] - datetime.timedelta(days=30):
            r["date"] = d0
            fixed_dates[r["source"]] += 1

    # ---- isi data kosong dari data mentah lama
    enrich_from_gabungan(final, gidx)
    fix_sr2024_repeated(final, gidx)
    load_loc_fix()
    for r in final:
        pf = ORDER_FIX.get(r["orderNo"], {}).get("produk")
        if pf and r["sku"] == NO_PRODUCT:
            r["sku"] = clean_product(pf)

    # ---- lokasi
    print("Membangun gazetteer & mengisi lokasi...")
    build_gazetteer()
    load_loc_fix()
    n_locfix = 0
    unknown_fix, rejected = Counter(), {}
    for r in final:
        r["city_n"], r["dist_n"], r["prov_n"] = fill_location(r)
        of = ORDER_FIX.get(r["orderNo"], {})
        if of.get("kota") and not r["city_n"]:
            r["city_n"] = resolve_city(of["kota"], "") or r["city_n"]
        if of.get("provinsi") and not r["prov_n"]:
            r["prov_n"] = norm_province(of["provinsi"])
        if r["city_n"] == "ANONIM" and not r["dist_n"] and True:
            r["dist_n"] = "ANONIM"
        d = LOC_FIX.get(r["orderNo"])
        if d and r["city_n"]:
            canon = "ANONIM" if d == "ANONIM" else match_district(r["city_n"], d)   # ANONIM = kategori sah dari tim
            if not canon:
                addr_u = clean_text(r["address"]).upper()
                others = [c for c, dd in GAZ_DIST.items() if d in dd]
                my_base = split_city(r["city_n"])[1]
                sibling = [c for c in others if split_city(c)[1] == my_base]
                if len(d) >= 4 and re.search(r"" + re.escape(d) + r"", addr_u):
                    canon = d                       # tertulis di alamat pesanan
                elif sibling:
                    r["city_n"], canon = sibling[0], d   # Kota/Kabupaten tertukar (mis. ABEPURA ada di KOTA Jayapura)
                elif not others and not re.match(r"^(KOTA|KAB)", d):
                    canon = d                       # nama kecamatan baru yang tidak dikenal di kota mana pun
                else:
                    why = (f"kecamatan {d} milik {', '.join(others[:2])}, bukan {r['city_n']} (kemungkinan isian tertarik ke bawah)"
                           if others else "nama kecamatan tidak dikenal dan mirip nama kota")
                    rejected.setdefault(r["orderNo"], (r["orderNo"], r["city_n"], d, why))
                    unknown_fix[(r["city_n"], d)] += 1
                    continue
            r["dist_n"] = canon
            n_locfix += 1

    if rejected:
        from openpyxl import Workbook as _WB
        wbr = _WB()
        wsr = wbr.active
        wsr.title = "Ditolak"
        wsr.append(["No Pesanan", "Kota pesanan", "Kecamatan yang diisi", "Alasan ditolak"])
        for row in sorted(rejected.values(), key=lambda x: (x[2], x[1])):
            wsr.append(list(row))
        for col, w in zip("ABCD", [28, 26, 24, 90]):
            wsr.column_dimensions[col].width = w
        wbr.save(os.path.join(LAPORAN_DIR, "KECAMATAN DITOLAK - cek ulang.xlsx"))

    # ---- platform
    for r in final:
        mk, ac, br, src, filled = parse_platform(clean_text(r["platform"]), order_shape(r["orderNo"]))
        r.update(marketplace=mk, account=ac, brand=br, brand_src=src, plat_filled=filled)

    # ---- operator: tertulis di platform > kolom PENGINPUT > ZANEVA (aturan user: tidak tertulis = operator ZANEVA)
    def person_operator(name):
        t = _collapse(re.sub(r"[^a-z]", "", clean_text(name).casefold()).upper())
        o = _fuzzy(t, OPERATORS, 0.8) if t else None
        return o if o and o[0] == t[0] else None

    est = Counter()
    for r in final:
        if r["account"]:
            est["tertulis di platform"] += 1
        else:
            o = person_operator(r["extra"].get("penginput"))
            r["account"] = o or "ZANEVA"
            est["dari PENGINPUT" if o else "default ZANEVA"] += 1

    # ---- channel offline dari pola nomor order ZNV-<kode>. Komunitas: lokasi dikosongkan (acara, bukan pembeli).
    #      Kantor (CODOFFICE): lokasi kantor (Cimahi) dipakai.
    # Booth mall: lokasi = alamat mall tempat booth (bukan alamat pembeli); nama mall disimpan di kolom venue.
    # Alamat: PVJ Jl. Sukajadi 137-139 (Sukajadi); Ciwalk Jl. Cihampelas 160 (Coblong); TSM Jl. Gatot Subroto 289 (Batununggal); Braga City Walk Jl. Braga 99-101 (Sumur Bandung).
    MALLS = {
        "PVJ": ("Paris Van Java Mall", "KOTA BANDUNG", "SUKAJADI", "JAWA BARAT"),
        "CIWALK": ("Cihampelas Walk", "KOTA BANDUNG", "COBLONG", "JAWA BARAT"),
        "TSM": ("Trans Studio Mall Bandung", "KOTA BANDUNG", "BATUNUNGGAL", "JAWA BARAT"),
        "BRAGA": ("Braga City Walk", "KOTA BANDUNG", "SUMUR BANDUNG", "JAWA BARAT"),
    }
    CHANNEL_RULES = [
        (re.compile(r"^ZNV-(?:HIJABFAIR)?(PVJ)", re.I), "BOOTH", "mall"),
        (re.compile(r"^ZNV-(CIWALK|TSM|BRAGA)", re.I), "BOOTH", "mall"),
        (re.compile(r"^ZNV-HIJABFAIR", re.I), "BOOTH", "blank"),
        (re.compile(r"^ZNV-(BUNDLING)?PUNDFIT", re.I), "KOMUNITAS", "blank"),
        # Kantor: lokasi kantor Cimahi dipaksa (data mentah 8 dari 10 order tercatat Bandung; permintaan user: Cimahi)
        (re.compile(r"^ZNV-CODOFFICE", re.I), "KANTOR", ("KOTA CIMAHI", "CIMAHI UTARA", "JAWA BARAT")),
    ]
    n_channel = Counter()
    for r in final:
        r["venue"] = ""
        for rx, ch, loc in CHANNEL_RULES:
            m = rx.match(r["orderNo"])
            if m:
                r["marketplace"] = ch
                if loc == "blank":
                    r["city_n"] = r["dist_n"] = r["prov_n"] = None
                elif loc == "mall":
                    r["venue"], r["city_n"], r["dist_n"], r["prov_n"] = MALLS[m.group(1).upper()]
                else:
                    r["city_n"], r["dist_n"], r["prov_n"] = loc
                n_channel[ch] += 1
                break

    # ---- TikTok menyensor kecamatan & alamat di export -> kecamatan diberi kategori "TIKTOK" (permintaan user)
    for r in final:
        if r["marketplace"] == "TIKTOK" and r["city_n"] and not r["dist_n"]:
            r["dist_n"] = "TIKTOK"

    # ---- lokasi yang tetap kosong = kategori "ANONIM" (keputusan user; Booth/Komunitas memang tanpa lokasi pembeli)
    n_anon = Counter()
    for r in final:
        if r["marketplace"] in ("BOOTH", "KOMUNITAS"):
            continue
        for k, nm in (("city_n", "kota"), ("prov_n", "provinsi"), ("dist_n", "kecamatan")):
            if not r[k]:
                r[k] = "ANONIM"
                n_anon[nm] += 1
    print("lokasi kosong -> ANONIM (baris):", dict(n_anon))

    # ---- brand dari produk (khusus yang brand-nya default) berdasar katalog CSV 2026
    prod_brand = defaultdict(Counter)
    for r in final:
        if r["source"] == "OPS2026":
            prod_brand[product_key(r["sku"])][r["brand"]] += 1
    reclass = Counter()
    for r in final:
        if r["brand_src"] != "default":
            continue
        c = prod_brand.get(product_key(r["sku"]))
        if c and len(c) == 1:
            b, n = next(iter(c.items()))
            if b != r["brand"] and n >= 3:
                r["brand"] = b
                r["brand_src"] = "produk"
                reclass[r["source"]] += 1

    # ---- master produk: SKU resmi, kategori, brand. Paket "A + B" dipecah jadi 2 baris:
    #      omzet dibagi rata, qty tiap produk = qty baris paket (permintaan user).
    stats_m, rev_m, conflicts = Counter(), Counter(), Counter()
    conf_rev = 0.0
    unresolved, auto, new_prod = {}, {}, {}
    expanded, n_split = [], 0
    for r in final:
        r["category"] = None
        if r["sku"] == NO_PRODUCT or not MASTER:
            expanded.append(r)
            continue
        parts = split_parts(r["sku"])
        rows = [r]
        if len(parts) > 1:
            n_split += 1
            share = round(r["revenue"] / len(parts), 2)
            ship = None if r["shipping"] is None else round(r["shipping"] / len(parts), 2)
            rows = []
            for i, part in enumerate(parts):
                x = dict(r)
                x["sku"] = part
                x["revenue"] = share if i < len(parts) - 1 else round(r["revenue"] - share * (len(parts) - 1), 2)
                x["shipping"] = ship
                rows.append(x)
        for x in rows:
            orig = x["sku"]
            e, method, sug = resolve_one(product_key(orig))
            if not e and not is_ambiguous(product_key(orig), method, sug):
                stats_m["produk baru (tidak ada di master)"] += 1
                rev_m["produk baru (tidak ada di master)"] += x["revenue"]
                new_prod.setdefault(orig, [0, 0.0])
                new_prod[orig][0] += 1
                new_prod[orig][1] += x["revenue"]
            elif not e:
                # aturan user: yang mirip dimasukkan ke SKU master terdekat (tidak perlu keputusan manual)
                qk = product_key(orig)
                nearest = max(sug, key=lambda k: difflib.SequenceMatcher(None, qk, k).ratio())
                e, method = MASTER[nearest], "terdekat (mirip, otomatis)"
                stats_m[method] += 1
                rev_m[method] += x["revenue"]
                x["sku"], x["category"] = e["sku"], e["cat"]
                a2 = auto.setdefault(orig, [0, 0.0, e["sku"], method])
                a2[0] += 1
                a2[1] += x["revenue"]
                if e["brand"] and e["brand"] != x["brand"]:
                    conflicts[(x["brand"], e["brand"])] += 1
                    conf_rev += x["revenue"]
                    x["brand"], x["brand_src"] = e["brand"], "master"
            else:
                stats_m[method.split(";")[0]] += 1
                rev_m[method.split(";")[0]] += x["revenue"]
                x["sku"], x["category"] = e["sku"], e["cat"]
                if method != "master" and not method.startswith("alias"):
                    a2 = auto.setdefault(orig, [0, 0.0, e["sku"], method])
                    a2[0] += 1
                    a2[1] += x["revenue"]
                if e["brand"] and e["brand"] != x["brand"]:
                    conflicts[(x["brand"], e["brand"])] += 1
                    conf_rev += x["revenue"]
                    x["brand"], x["brand_src"] = e["brand"], "master"
            expanded.append(x)
    final = expanded
    if MASTER:
        write_mapping_review(unresolved, auto)
        with open(os.path.join(OUT_DIR, "product_review.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["kind", "name", "rows", "omzet", "suggestions", "note", "resultSku"])
            for name, (n, rev, sug, why) in sorted(unresolved.items(), key=lambda kv: -kv[1][1])[:500]:
                w.writerow(["BELUM_COCOK", name, n, round(rev, 2), " | ".join(MASTER[k]["sku"] for k in sug), why, ""])
            for name, (n, rev, sku, method) in sorted(auto.items(), key=lambda kv: -kv[1][1])[:500]:
                w.writerow(["OTOMATIS", name, n, round(rev, 2), "", method, sku])

    # ---- produk di luar master: satu produk = satu nama (tidak ada duplikat penulisan)
    n_before, n_after = cluster_new_products(final)
    variants = defaultdict(Counter)
    for r in final:
        variants[product_key(r["sku"])][r["sku"]] += 1
    for r in final:
        r["sku"] = variants[product_key(r["sku"])].most_common(1)[0][0]

    # ---- tulis
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(FIELDS)
        for r in final:
            w.writerow([r["orderNo"], r["resi"], r["date"].isoformat(), r["payment"], r["sku"], r["qty"],
                        r["revenue"], "" if r["shipping"] is None else r["shipping"],
                        r["city_n"] or "", r["dist_n"] or "", r["prov_n"] or "",
                        clean_text(r["platform"]), r["marketplace"], r["account"] or "", r["brand"],
                        r["category"] or "", r["source"], r["venue"]])

    print("Menulis file audit...")
    audit_counts = write_audit(final)

    # ---- laporan
    lines = []
    P = lines.append
    P("=== LAPORAN ETL ===")
    P(f"Operator berasal dari: {dict(est)} | channel offline (baris): {dict(n_channel)}")
    P("File audit: " + str(audit_counts))
    tot_rev = sum(r["revenue"] for r in final)
    P("\nPemetaan ke master produk (omzet | baris):")
    for m, v in rev_m.most_common():
        P(f"  {m:32s} Rp {v/1e9:6.2f} M ({v/tot_rev:.1%}) | {stats_m[m]} baris")
    P(f"Produk di luar master: {n_before} nama -> {n_after} setelah varian penulisan digabung | kecamatan dikoreksi user: {n_locfix} baris (DITOLAK karena tidak masuk akal: {sum(unknown_fix.values())} baris / {len(rejected)} pesanan)")
    P(f"Baris paket A+B yang dipecah: {n_split} | nama produk unik AMBIGU: {len(unresolved)} | produk baru: {len(new_prod)} | "
      f"hasil otomatis non-persis (perlu dicek): {len(auto)}")
    P(f"Brand diganti mengikuti master: {sum(conflicts.values())} baris, omzet Rp {conf_rev/1e9:.2f} M | pola: "
      + str(conflicts.most_common(6)))
    P(f"Baris akhir: {len(final)} | total revenue Rp {sum(r['revenue'] for r in final):,.0f}")
    P("\nPer sumber: mentah -> dibuang(dup baris) / dibuang(pesanan sudah ada di sumber lain) -> masuk")
    for s in ["Jual", "PENJUALAN", "OPS2026", "SR2022", "SR2024", "SR2025", "GABUNGAN"]:
        P(f"  {s:10s} {raw_n[s]:8d} -> {dropped_line[s]:6d} / {dropped_cross[s]:6d} -> {raw_n[s]-dropped_line[s]-dropped_cross[s]:8d}"
          f" | tanggal dikoreksi: {fixed_dates[s]}")
    P("\nOmzet baris kembar yang dibuang (non-Jual): " + str({k: f"Rp {v:,.0f}" for k, v in dropped_rev.items()}))
    P(f"Pembersihan lain: {dict(STATS)} | total qty {sum(r['qty'] for r in final):,}")
    P(f"Platform kosong/tidak dikenali diisi otomatis: {sum(1 for r in final if r['plat_filled'])} baris")
    P("Marketplace: " + str(Counter(r['marketplace'] for r in final).most_common()))
    P("Brand: " + str(Counter(r['brand'] for r in final).most_common()))
    P("Brand asal: " + str(Counter(r['brand_src'] for r in final).most_common()))
    P("Brand direklasifikasi dari nama produk: " + str(dict(reclass)))
    P("Akun: " + str(Counter(r['account'] for r in final).most_common(15)))
    P("\nKelengkapan lokasi per tahun (persen baris | persen omzet):")
    by = defaultdict(lambda: Counter())
    for r in final:
        y = r["date"].year
        c = by[y]
        c["n"] += 1
        c["rev"] += r["revenue"]
        if r["city_n"]:
            c["city"] += 1
            c["city_rev"] += r["revenue"]
        if r["dist_n"]:
            c["dist"] += 1
            c["dist_rev"] += r["revenue"]
    for y in sorted(by):
        c = by[y]
        P(f"  {y}: kota {c['city']/c['n']:.0%} | {c['city_rev']/max(c['rev'],1):.0%}   "
          f"kecamatan {c['dist']/c['n']:.0%} | {c['dist_rev']/max(c['rev'],1):.0%}   (baris {c['n']})")
    text = "\n".join(lines)
    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(os.path.join(OUT_DIR, "tiktok_bulan.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["bulan", "order TikTok data lama", "order TikTok data mentah (Selesai)", "mentah tidak ditambahkan"])
        raw_m = Counter(_gb_month(o) for o in gidx.values() if o["tiktok"] and o["status"] == "Selesai")
        for m in sorted(set(raw_m) | set(tiktok_month)):
            w.writerow([m, tiktok_month.get(m, 0), raw_m.get(m, 0), TT_SKIPPED.get(m, 0)])
    print(text)


if __name__ == "__main__":
    main()
