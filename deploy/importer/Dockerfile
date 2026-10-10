# Importer sekali-pakai: jalankan DI DALAM server EasyPanel.
# Download dump dari DUMP_URL lalu restore ke Postgres internal (sama project).
FROM postgres:18-bookworm
COPY run.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
