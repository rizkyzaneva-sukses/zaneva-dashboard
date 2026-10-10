#!/usr/bin/env bash
# Importer dump -> Postgres internal EasyPanel. Melaporkan progres ke ntfy.
set +e

TOPIC="${NTFY_TOPIC:-zaneva-zv-20261010}"
note() { curl -s --max-time 20 -d "$1" "https://ntfy.sh/$TOPIC" >/dev/null 2>&1; echo "$1"; }

note "IMPORT START host=$(hostname) arch=$(uname -m) user=$(whoami) psql=$(command -v psql || echo NO)"

if [ -z "$DUMP_URL" ]; then note "ERR: DUMP_URL kosong"; exit 1; fi
if [ -z "$PGHOST" ] || [ -z "$PGDATABASE" ]; then note "ERR: PGHOST/PGDATABASE kosong"; exit 1; fi

note "Download dump: $DUMP_URL"
curl -fsSL --max-time 900 -o /tmp/zv.dump "$DUMP_URL"
if [ $? -ne 0 ] || [ ! -s /tmp/zv.dump ]; then note "ERR: download gagal/kosong"; exit 1; fi
note "Download OK: $(stat -c%s /tmp/zv.dump) bytes"

note "pg_restore -> $PGHOST:$PGPORT/$PGDATABASE (user $PGUSER)"
pg_restore --no-owner --clean --if-exists \
  -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" /tmp/zv.dump 2>/tmp/err.log
RC=$?
note "pg_restore rc=$RC | err_tail=$(tail -c 400 /tmp/err.log | tr '\n' '|')"

CNT=$(psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -tAc "select count(*) from orders" 2>/tmp/cnt.log)
note "orders_count=$CNT | cnt_err=$(tail -c 200 /tmp/cnt.log | tr '\n' '|')"
UCNT=$(psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -tAc "select count(*) from users" 2>/dev/null)
note "users_count=$UCNT"
note "IMPORT DONE"

# tetap hidup agar status EasyPanel tetap 'running'
sleep infinity
