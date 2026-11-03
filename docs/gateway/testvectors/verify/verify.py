"""Verificador de referencia: lee los vectores y confirma que codec.py los reproduce.
Uso:  python -I verify.py   (codigo de salida 0 = todo conforme)
Una implementacion nueva (Go, JS...) debe superar los mismos casos; ver ../README.md."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codec  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = 0
total = 0


def load(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return json.load(f)['vectors']


def check(cond, label, detail=''):
    global fails, total
    total += 1
    if not cond:
        fails += 1
        print('FALLO', label, detail)


# ---- solicitudes ----
for v in load('request.json'):
    data = bytes.fromhex(v['hex'])
    r = codec.decode_request(data, v['eof'])
    e = v['expect']
    lab = 'request/' + v['name']
    if e.get('incomplete'):
        check(r == ('incomplete',), lab, r)
    elif e['ok']:
        check(r[0] == 'ok' and r[1] == e['fields'] and r[2] == e['consumed'], lab, r)
        if v.get('canonical'):
            check(codec.encode_request(e['fields']) == data, lab + '/encode')
    else:
        check(r == ('err', e['status'], int(e['code'], 16)), lab, r)
    # los datos tras 'consumed' nunca cambian el resultado
    if e.get('ok'):
        r2 = codec.decode_request(data + b'\xde\xad\xbe\xef', True)
        check(r2 == r, lab + '/trailing', r2)

# ---- respuestas ----
for v in load('response.json'):
    data = bytes.fromhex(v['hex'])
    r = codec.decode_response(data, v['eof'])
    e = v['expect']
    lab = 'response/' + v['name']
    if e.get('incomplete'):
        check(r == ('incomplete',), lab, r)
    elif e['ok']:
        check(r[0] == 'ok' and r[1] == e['fields'] and r[2] == e['consumed'], lab, r)
        if v.get('canonical'):
            check(codec.encode_response(e['fields']) == data, lab + '/encode')
    else:
        check(r == ('err', e['error']), lab, r)

# ---- URI ----
for v in load('uri.json'):
    r = codec.parse_uri(v['uri'], v['default_zone'])
    e = v['expect']
    lab = 'uri/' + v['name']
    if e['ok']:
        check(r == ('ok', e['fields']), lab, r)
    else:
        check(r == ('err', e['error']), lab, r)

# ---- trama UDP ----
for v in load('udp_frames.json'):
    r = codec.decode_frames(bytes.fromhex(v['hex']))
    e = v['expect']
    lab = 'udp/' + v['name']
    if 'error' in e:
        check(r == ('err', e['error']), lab, r)
    else:
        check(r[0] == 'ok' and [d.hex() for d in r[1]] == e['datagrams'] and r[2] == e['keepalives'] and r[3] == e['pending'], lab, r)

# ---- listas de IP ----
for v in load('ip_allowlist.json'):
    check(codec.ip_allowed(v['cidrs'], v['ip']) == v['allowed'], 'ip/' + v['name'])

# ---- los .hex y .bin coinciden con los JSON ----
for kind, fn in (('req', 'request.json'), ('resp', 'response.json')):
    for v in load(fn):
        hp = os.path.join(ROOT, 'hex', '%s_%s.hex' % (kind, v['name']))
        bp = os.path.join(ROOT, 'bin', '%s_%s.bin' % (kind, v['name']))
        with open(hp) as f:
            check(f.read().strip() == v['hex'], 'hex/' + v['name'])
        with open(bp, 'rb') as f:
            check(f.read().hex() == v['hex'], 'bin/' + v['name'])

print('%d comprobaciones, %d fallos' % (total, fails))
sys.exit(1 if fails else 0)
