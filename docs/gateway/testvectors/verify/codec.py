"""Codificador/decodificador de referencia del protocolo capsule/1 (CAP1/CAPR).
Solo biblioteca estandar de Python 3. Independiente de cualquier libreria de Capsule.
Normativo: docs/gateway/PROTOCOL.md. Aqui se implementan los mismos algoritmos que describe el documento."""
import ipaddress
import re
import struct

MAX_HDR = 1024
MIN_HDR = 17
FIXED = 9
NAME_RE = re.compile(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
TOKEN_CHARS = re.compile(r'^[A-Za-z0-9_.-]+$')
PREFIX = {1: 'cap_', 2: 'cgt_', 3: 'cgc_', 4: 'cgs_'}
CLIENT_ID_RE = re.compile(r'^[A-Za-z0-9._/+-]{1,64}$')
MAX_DGRAM_STREAM = 2048


def valid_name(s):
    return bool(NAME_RE.match(s)) and len(s) <= 63

# ---------- solicitud CAP1 ----------


def encode_request(f):
    proj = f['project'].encode('ascii')
    svc = f['service'].encode('ascii')
    auth = f['auth'].encode('ascii')
    tl = b''
    if f.get('nonce_hex') is not None:
        v = bytes.fromhex(f['nonce_hex'])
        tl += bytes([1, len(v)]) + v
    if f.get('client_id') is not None:
        v = f['client_id'].encode('ascii')
        tl += bytes([2, len(v)]) + v
    if f.get('padding'):
        tl += bytes([0x80, f['padding']]) + b'\x00' * f['padding']
    body = (bytes([len(proj)]) + proj + bytes([len(svc)]) + svc + bytes([f['auth_type']])
            + struct.pack('>H', len(auth)) + auth + tl)
    total = FIXED + len(body)
    return b'CAP1' + bytes([1, f.get('flags', 0)]) + struct.pack('>H', total) + bytes([f['transport']]) + body


def _e(code):
    return ('err', 1, code)


def decode_request(data, eof=True):
    """Devuelve ('incomplete',) | ('ok', campos, consumidos) | ('err', status, codigo)."""
    if len(data) < 8:
        return _e(0x010A) if eof else ('incomplete',)
    if data[0:4] != b'CAP1':
        return _e(0x0102)
    if data[4] != 1:
        return _e(0x0101)
    flags = data[5]
    hl = struct.unpack('>H', data[6:8])[0]
    if hl < MIN_HDR or hl > MAX_HDR:
        return _e(0x0103)
    if len(data) < hl:
        return _e(0x010A) if eof else ('incomplete',)
    h = data[:hl]
    if flags & 0xFE:
        return _e(0x0104)
    transport = h[8]
    if transport not in (1, 2, 3):
        return _e(0x0109)
    cur = FIXED
    names = []
    for _ in range(2):
        if cur + 1 > hl:
            return _e(0x010B)
        n = h[cur]
        cur += 1
        if n < 1 or n > 63:
            return _e(0x0105)
        if cur + n > hl:
            return _e(0x010B)
        raw = h[cur:cur + n]
        cur += n
        try:
            s = raw.decode('ascii')
        except UnicodeDecodeError:
            return _e(0x0105)
        if not valid_name(s):
            return _e(0x0105)
        names.append(s)
    if cur + 3 > hl:
        return _e(0x010B)
    at = h[cur]
    cur += 1
    if at not in PREFIX:
        return _e(0x0106)
    al = struct.unpack('>H', h[cur:cur + 2])[0]
    cur += 2
    if al < 8 or al > 512:
        return _e(0x0106)
    if cur + al > hl:
        return _e(0x010B)
    try:
        tok = h[cur:cur + al].decode('ascii')
    except UnicodeDecodeError:
        return _e(0x0106)
    cur += al
    if not tok.startswith(PREFIX[at]) or not TOKEN_CHARS.match(tok):
        return _e(0x0106)
    out = {'transport': transport, 'flags': flags, 'project': names[0], 'service': names[1],
           'auth_type': at, 'auth': tok, 'ignored_tlvs': 0}
    seen = set()
    while cur < hl:
        if cur + 2 > hl:
            return _e(0x0107)
        t, ln = h[cur], h[cur + 1]
        cur += 2
        if cur + ln > hl:
            return _e(0x0107)
        v = h[cur:cur + ln]
        cur += ln
        if t == 0x01:
            if t in seen or ln != 16:
                return _e(0x0107)
            seen.add(t)
            out['nonce_hex'] = v.hex()
        elif t == 0x02:
            try:
                s = v.decode('ascii')
            except UnicodeDecodeError:
                return _e(0x0107)
            if t in seen or not CLIENT_ID_RE.match(s):
                return _e(0x0107)
            seen.add(t)
            out['client_id'] = s
        elif t >= 0x80:
            out['ignored_tlvs'] += 1
        else:
            return _e(0x0108)
    return ('ok', out, hl)

# ---------- respuesta CAPR ----------


def _enc_addr(a):
    ip = ipaddress.ip_address(a['ip'])
    return bytes([ip.version]) + ip.packed + struct.pack('>H', a['port'])


def encode_response(f):
    msg = f.get('msg', '').encode('ascii')
    ext = b''
    t = f.get('tlvs', {})
    if 'max_version' in t:
        ext += bytes([1, 1, t['max_version']])
    if 'retry_after' in t:
        ext += bytes([2, 2]) + struct.pack('>H', t['retry_after'])
    if 'session_id_hex' in t:
        ext += bytes([3, 8]) + bytes.fromhex(t['session_id_hex'])
    if 'client_addr' in t:
        v = _enc_addr(t['client_addr'])
        ext += bytes([4, len(v)]) + v
    if 'max_datagram' in t:
        ext += bytes([5, 2]) + struct.pack('>H', t['max_datagram'])
    if 'idle_timeout' in t:
        ext += bytes([6, 2]) + struct.pack('>H', t['idle_timeout'])
    if t.get('padding'):
        ext += bytes([0x80, t['padding']]) + b'\x00' * t['padding']
    return (b'CAPR' + bytes([f['version'], f['status']]) + struct.pack('>H', f['code'])
            + bytes([len(msg)]) + msg + struct.pack('>H', len(ext)) + ext)


def _r(name):
    return ('err', name)


def decode_response(data, eof=True):
    if len(data) < 9:
        return _r('truncated') if eof else ('incomplete',)
    if data[0:4] != b'CAPR':
        return _r('bad_magic')
    ver, status = data[4], data[5]
    if ver < 1:
        return _r('bad_version')
    code = struct.unpack('>H', data[6:8])[0]
    ml = data[8]
    if ml > 120:
        return _r('msg_too_long')
    if len(data) < 9 + ml + 2:
        return _r('truncated') if eof else ('incomplete',)
    raw = data[9:9 + ml]
    if any(b < 0x20 or b > 0x7E for b in raw):
        return _r('bad_msg')
    el = struct.unpack('>H', data[9 + ml:11 + ml])[0]
    if el > 256:
        return _r('ext_too_long')
    total = 11 + ml + el
    if len(data) < total:
        return _r('truncated') if eof else ('incomplete',)
    ext = data[11 + ml:total]
    out = {'version': ver, 'status': status, 'code': code, 'msg': raw.decode('ascii'), 'tlvs': {}}
    cur = 0
    seen = set()
    while cur < len(ext):
        if cur + 2 > len(ext):
            return _r('bad_ext')
        t, ln = ext[cur], ext[cur + 1]
        cur += 2
        if cur + ln > len(ext):
            return _r('bad_ext')
        v = ext[cur:cur + ln]
        cur += ln
        if 1 <= t <= 6:
            if t in seen:
                return _r('bad_ext')
            seen.add(t)
        if t == 1:
            if ln != 1:
                return _r('bad_ext')
            out['tlvs']['max_version'] = v[0]
        elif t == 2:
            if ln != 2:
                return _r('bad_ext')
            out['tlvs']['retry_after'] = struct.unpack('>H', v)[0]
        elif t == 3:
            if ln != 8:
                return _r('bad_ext')
            out['tlvs']['session_id_hex'] = v.hex()
        elif t == 4:
            if ln == 7 and v[0] == 4:
                ip = str(ipaddress.IPv4Address(v[1:5]))
            elif ln == 19 and v[0] == 6:
                ip = str(ipaddress.IPv6Address(v[1:17]))
            else:
                return _r('bad_ext')
            out['tlvs']['client_addr'] = {'ip': ip, 'port': struct.unpack('>H', v[-2:])[0]}
        elif t == 5:
            if ln != 2:
                return _r('bad_ext')
            out['tlvs']['max_datagram'] = struct.unpack('>H', v)[0]
        elif t == 6:
            if ln != 2:
                return _r('bad_ext')
            out['tlvs']['idle_timeout'] = struct.unpack('>H', v)[0]
    return ('ok', out, total)

# ---------- UDP sobre flujo (transport 2) ----------


def decode_frames(data):
    """Devuelve ('ok', [datagramas], keepalives, pendientes) | ('err', nombre)."""
    cur, dg, ka = 0, [], 0
    while True:
        if len(data) - cur < 2:
            break
        n = struct.unpack('>H', data[cur:cur + 2])[0]
        if n > MAX_DGRAM_STREAM:
            return ('err', 'frame_too_large')
        if len(data) - cur - 2 < n:
            break
        if n == 0:
            ka += 1
        else:
            dg.append(data[cur + 2:cur + 2 + n])
        cur += 2 + n
    return ('ok', dg, ka, len(data) - cur)

# ---------- IP ----------


def canon_ip(text):
    if '%' in text:
        raise ValueError('zone id')
    ip = ipaddress.ip_address(text)
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip


def ip_allowed(cidrs, text):
    ip = canon_ip(text)
    for c in cidrs:
        net = ipaddress.ip_network(c, strict=True)
        if net.version == ip.version and ip in net:
            return True
    return False

# ---------- URI capsule:// ----------


def _dns(s):
    if len(s) > 253 or not s:
        return False
    return all(NAME_RE.match(label) for label in s.split('.'))


def _pct(s):
    out = bytearray()
    i = 0
    while i < len(s):
        c = s[i]
        if c == '%':
            h = s[i + 1:i + 3]
            if len(h) != 2 or not re.match(r'^[0-9A-Fa-f]{2}$', h):
                raise ValueError('bad_escape')
            out.append(int(h, 16))
            i += 3
        else:
            out += c.encode('utf-8')
            i += 1
    try:
        r = out.decode('ascii')
    except UnicodeDecodeError:
        raise ValueError('bad_param')
    if any(ord(ch) < 0x21 or ord(ch) == 0x7F for ch in r):
        raise ValueError('bad_param')
    return r


def _port(p):
    if not re.match(r'^[0-9]{1,5}$', p) or not (1 <= int(p) <= 65535):
        raise ValueError('bad_gateway')
    return int(p)


def _gateway(v):
    port = 443
    if v.startswith('['):
        end = v.find(']')
        if end < 0:
            raise ValueError('bad_gateway')
        host, rest = v[1:end], v[end + 1:]
        if '%' in host:
            raise ValueError('bad_gateway')
        try:
            ip = ipaddress.IPv6Address(host)
        except ValueError:
            raise ValueError('bad_gateway')
        host, lit = str(ip), True
        if rest:
            if not rest.startswith(':'):
                raise ValueError('bad_gateway')
            port = _port(rest[1:])
    else:
        if v.count(':') > 1:
            raise ValueError('bad_gateway')
        host = v
        if ':' in v:
            host, p = v.split(':')
            port = _port(p)
        lit = False
        if re.match(r'^[0-9.]+$', host):
            try:
                host = str(ipaddress.IPv4Address(host))
                lit = True
            except ValueError:
                raise ValueError('bad_gateway')
        elif not _dns(host):
            raise ValueError('bad_gateway')
    return host, port, lit


def parse_uri(uri, default_zone):
    """Devuelve ('ok', dict) | ('err', nombre)."""
    try:
        return ('ok', _parse_uri(uri, default_zone))
    except ValueError as e:
        return ('err', str(e))


def _parse_uri(uri, default_zone):
    if uri[:10].lower() != 'capsule://':
        raise ValueError('bad_scheme')
    rest = uri[10:]
    if '#' in rest:
        raise ValueError('fragment')
    query = None
    if '?' in rest:
        rest, query = rest.split('?', 1)
    if '/' not in rest:
        proj, svc = rest, None
    else:
        proj, svc = rest.split('/', 1)
    if '@' in proj:
        raise ValueError('userinfo')
    if ':' in proj:
        raise ValueError('port')
    if not valid_name(proj):
        raise ValueError('bad_project')
    if svc is None or '/' in svc:
        raise ValueError('bad_path')
    if not valid_name(svc):
        raise ValueError('bad_service')
    params = {}
    if query is not None:
        if query == '':
            raise ValueError('bad_param')
        for part in query.split('&'):
            if '=' not in part:
                raise ValueError('bad_param')
            k, v = part.split('=', 1)
            if not re.match(r'^[a-z0-9_-]+$', k) or v == '':
                raise ValueError('bad_param')
            if k in params:
                raise ValueError('dup_param')
            if k.startswith('x-'):
                params[k] = None
                continue
            if k not in ('transport', 'family', 'zone', 'gateway', 'sni'):
                raise ValueError('unknown_param')
            params[k] = _pct(v)
    transport = params.get('transport') or 'tcp'
    if transport not in ('tcp', 'udp'):
        raise ValueError('bad_param')
    family = params.get('family') or 'any'
    if family not in ('4', '6', 'any'):
        raise ValueError('bad_param')
    if 'gateway' in params and 'zone' in params:
        raise ValueError('bad_param')
    sni = params.get('sni')
    if sni is not None and not _dns(sni):
        raise ValueError('bad_param')
    if 'gateway' in params:
        host, port, lit = _gateway(params['gateway'])
        if lit and sni is None:
            raise ValueError('sni_required')
        sni = sni or host
    else:
        zone = params.get('zone', default_zone)
        if not _dns(zone) or '.' not in zone:
            raise ValueError('bad_param')
        host = ('tcp' if transport == 'tcp' else 'udp') + '.' + zone
        port = 443
        sni = sni or host
    return {'project': proj, 'service': svc, 'transport': transport, 'family': family,
            'connect_host': host, 'connect_port': port, 'sni': sni}
