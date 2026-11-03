import psycopg, sys
host, port, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
kw = dict(host=host, hostaddr="127.0.0.1", port=port, user="u", dbname="d", password="p", sslmode="require", connect_timeout=5)
for e in extra:
    k, v = e.split("=", 1); kw[k] = v
try:
    psycopg.connect(**kw)
except Exception as ex:
    print("libpq", psycopg.pq.version(), host, extra, "->", str(ex).strip().replace("\n", " | "))
