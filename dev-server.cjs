// Menjalankan `next dev` dari folder aplikasi ini, bisa dipanggil dari folder mana pun (mis. oleh launcher IDE).
process.chdir(__dirname);
process.argv = [process.argv[0], "next", "dev"];
require("next/dist/bin/next");
