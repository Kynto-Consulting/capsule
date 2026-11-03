"""Genera los vectores de prueba (JSON + hex + bin). Construye los bytes a mano (sin usar codec.py)
para que verify.py compruebe dos caminos independientes. Uso: python -I gen_vectors.py"""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
ZONE = 'apps.tumi-ai.com'
TOK = {1: 'cap_' + 'A' * 43, 2: 'cgt_' + 'B' * 43, 3: 'cgc_aGVhZGVy.cGF5bG9hZA.c2ln', 4: 'cgs_' + 'C' * 43}
NONCE = '000102030405060708090a0b0c0d0e0f'


def raw_req(proj=b'mi-proyecto', svc=b'db', at=1, auth=None, tlv=b'', flags=0, transport=1,
            version=1, magic=b'CAP1', hdr_len=None, plen=None, slen=None, alen=None):
    auth = TOK[1].encode() if auth is None else auth
    body = (bytes([len(proj) if plen is None else plen]) + proj + bytes([len(svc) if slen is None else slen]) + svc
            + bytes([at]) + struct.pack('>H', len(auth) if alen is None else alen) + auth + tlv)
    total = 9 + len(body)
    if hdr_len is not None:
        total = hdr_len
    return magic + bytes([version, flags]) + struct.pack('>H', total) + bytes([transport]) + body


def tlv(t, v):
    return bytes([t, len(v)]) + v


def okf(**kw):
    d = {'transport': 1, 'flags': 0, 'project': 'mi-proyecto', 'service': 'db', 'auth_type': 1,
         'auth': TOK[1], 'ignored_tlvs': 0}
    d.update(kw)
    return d


reqs = []


def add(name, desc, data, expect, canonical=False, eof=True, extra=None, fields=None):
    v = {'name': name, 'desc': desc, 'hex': data.hex(), 'eof': eof, 'expect': expect}
    if canonical:
        v['canonical'] = True
    if extra:
        v['trailing_hex'] = extra.hex()
    reqs.append(v)


def good(fields, data, canonical=True, **kw):
    return {'ok': True, 'consumed': len(data), 'fields': fields}


def err(code):
    return {'ok': False, 'status': 1, 'code': '0x%04X' % code}


# ---- validos ----
d = raw_req()
add('valid_minimal', 'tcp, cap_, sin TLV', d, good(okf(), d), True)
d = raw_req(at=2, auth=TOK[2].encode())
add('valid_cgt', 'token cgt_', d, good(okf(auth_type=2, auth=TOK[2]), d), True)
d = raw_req(at=3, auth=TOK[3].encode())
add('valid_cgc', 'token cgc_ (JWT compacto)', d, good(okf(auth_type=3, auth=TOK[3]), d), True)
d = raw_req(at=4, auth=TOK[4].encode())
add('valid_cgs', 'token de servicio cgs_', d, good(okf(auth_type=4, auth=TOK[4]), d), True)
d = raw_req(transport=2, flags=1, svc=b'minecraft-bedrock')
add('valid_udp_stream_flag_proxy', 'transport 2 (UDP sobre flujo), bit0 de banderas', d,
    good(okf(transport=2, flags=1, service='minecraft-bedrock'), d), True)
d = raw_req(transport=3)
add('valid_transport_quic_syntax', 'transport 3 es sintacticamente valido (la politica del servidor puede rechazarlo)', d,
    good(okf(transport=3), d), True)
d = raw_req(tlv=tlv(1, bytes.fromhex(NONCE)) + tlv(2, b'capsule-go/0.1.0'))
add('valid_nonce_clientid', 'TLV 0x01 y 0x02', d, good(okf(nonce_hex=NONCE, client_id='capsule-go/0.1.0'), d), True)
d = raw_req(tlv=tlv(0x80, b'\x00' * 10))
add('valid_padding', 'relleno 0x80 (no canonico: solo decodificacion)', d, good(okf(ignored_tlvs=1), d), False)
d = raw_req(tlv=tlv(0x90, b'xyz') + tlv(0x80, b'') + tlv(0xFF, b'\x01'))
add('valid_unknown_ignorable_tlv', 'TLV >=0x80 desconocidos se ignoran', d, good(okf(ignored_tlvs=3), d), False)
d = raw_req(proj=b'a', svc=b'b')
add('valid_one_char_names', 'nombres de 1 caracter', d, good(okf(project='a', service='b'), d), True)
n63 = b'a' + b'b' * 61 + b'c'
d = raw_req(proj=n63, svc=n63)
add('limit_names_63', 'nombres de 63 caracteres', d, good(okf(project=n63.decode(), service=n63.decode()), d), True)
at512 = ('cap_' + 'Z' * 508)
d = raw_req(auth=at512.encode())
add('limit_auth_512', 'token de 512 bytes', d, good(okf(auth=at512), d), True)
at8 = 'cap_1234'
d = raw_req(auth=at8.encode())
add('limit_auth_8', 'token minimo (8)', d, good(okf(auth=at8), d), True)
d = raw_req(auth=b'cap_a.b-c_d')
add('valid_token_charset', 'caracteres . - _ permitidos', d, good(okf(auth='cap_a.b-c_d'), d), True)
# encabezado de 1024 exactos: relleno
base = raw_req(auth=at512.encode())
pad = 1024 - len(base)
t = b''
npad = 0
while pad > 0:
    take = min(pad - 2, 255) if pad - 2 >= 0 else 0
    if take < 0 or pad < 2:
        break
    t += tlv(0x80, b'\x00' * take)
    pad -= 2 + take
d = raw_req(auth=at512.encode(), tlv=t)
assert len(d) == 1024, len(d)
add('limit_hdr_1024', 'encabezado de exactamente 1024 B', d, good(okf(auth=at512, ignored_tlvs=t.count(b'\x80')) if False else okf(auth=at512, ignored_tlvs=2), d), False)
d = raw_req() + b'SSH-2.0-OpenSSH_10.2\r\n'
add('valid_trailing_payload', 'bytes de datos tras el encabezado (envio optimista): no se consumen', d,
    {'ok': True, 'consumed': len(raw_req()), 'fields': okf()}, False)
# ---- invalidos ----
add('bad_magic', 'magic distinto', raw_req(magic=b'CAP2'), err(0x0102))
add('bad_magic_http', 'trafico HTTP', b'GET / HTTP/1.1\r\n\r\n', err(0x0102))
add('unknown_version_2', 'version 2', raw_req(version=2), err(0x0101))
add('unknown_version_0', 'version 0', raw_req(version=0), err(0x0101))
add('unknown_version_255_garbage', 'version 255 con cuerpo arbitrario', b'CAP1\xff\x00\x00\x20' + b'\xaa' * 30, err(0x0101))
add('hdr_len_too_small', 'hdr_len 16', raw_req(hdr_len=16), err(0x0103))
add('hdr_len_too_large', 'hdr_len 1025', raw_req(hdr_len=1025), err(0x0103))
add('hdr_len_zero', 'hdr_len 0', raw_req(hdr_len=0), err(0x0103))
add('hdr_len_short_of_fields', 'hdr_len menor que los campos reales', raw_req(hdr_len=20), err(0x010B))
add('hdr_len_beyond_data', 'hdr_len mayor que los datos y fin de flujo', raw_req(hdr_len=200), err(0x010A))
add('flags_reserved_bit1', 'bit1 activo', raw_req(flags=2), err(0x0104))
add('flags_reserved_bit7', 'bit7 activo', raw_req(flags=0x81), err(0x0104))
add('transport_0', 'transport 0', raw_req(transport=0), err(0x0109))
add('transport_4', 'transport 4', raw_req(transport=4), err(0x0109))
add('proj_len_0', 'proj_len 0', raw_req(proj=b'', ), err(0x0105))
add('proj_len_64', 'proyecto de 64', raw_req(proj=b'a' * 64), err(0x0105))
add('proj_uppercase', 'mayusculas', raw_req(proj=b'Mi-Proyecto'), err(0x0105))
add('proj_leading_hyphen', 'guion inicial', raw_req(proj=b'-abc'), err(0x0105))
add('proj_trailing_hyphen', 'guion final', raw_req(proj=b'abc-'), err(0x0105))
add('proj_underscore', 'guion bajo', raw_req(proj=b'ab_c'), err(0x0105))
add('proj_nonascii', 'byte no ASCII', raw_req(proj=b'ab\xc3\xa9'), err(0x0105))
add('svc_len_0', 'svc_len 0', raw_req(svc=b''), err(0x0105))
add('svc_dot', 'punto en el servicio', raw_req(svc=b'a.b'), err(0x0105))
add('proj_len_overrun', 'proj_len mayor que el encabezado', raw_req(proj=b'ab', plen=63), err(0x010B))
add('auth_type_0', 'auth_type 0', raw_req(at=0), err(0x0106))
add('auth_type_5', 'auth_type 5', raw_req(at=5), err(0x0106))
add('auth_prefix_mismatch', 'auth_type 2 con prefijo cap_', raw_req(at=2), err(0x0106))
add('auth_len_0', 'auth_len 0', raw_req(auth=b''), err(0x0106))
add('auth_len_7', 'token de 7 B', raw_req(auth=b'cap_123'), err(0x0106))
add('auth_len_513', 'token de 513 B', raw_req(auth=b'cap_' + b'Z' * 509), err(0x0106))
add('auth_bad_charset', 'espacio en el token', raw_req(auth=b'cap_abc def'), err(0x0106))
add('auth_len_overrun', 'auth_len mayor que lo que queda', raw_req(alen=300), err(0x010B))
add('tlv_truncated_header', 'TLV con un solo byte', raw_req(tlv=b'\x80'), err(0x0107))
add('tlv_len_overrun', 'TLV con longitud que excede el encabezado', raw_req(tlv=b'\x80\x05\x00'), err(0x0107))
add('tlv_nonce_wrong_len', 'nonce de 8 B', raw_req(tlv=tlv(1, b'\x00' * 8)), err(0x0107))
add('tlv_nonce_duplicate', 'nonce repetido', raw_req(tlv=tlv(1, b'\x00' * 16) * 2), err(0x0107))
add('tlv_clientid_bad_charset', 'id de cliente con espacio', raw_req(tlv=tlv(2, b'a b')), err(0x0107))
add('tlv_clientid_empty', 'id de cliente vacio', raw_req(tlv=tlv(2, b'')), err(0x0107))
add('tlv_unknown_critical', 'tipo 0x03 desconocido (<0x80)', raw_req(tlv=tlv(3, b'x')), err(0x0108))
add('tlv_unknown_critical_0', 'tipo 0x00', raw_req(tlv=tlv(0, b'')), err(0x0108))
# ---- truncados ----
full = raw_req(tlv=tlv(1, bytes.fromhex(NONCE)))
for cut in (0, 3, 7, 8, 9, 17, len(full) - 1):
    add('truncated_%d_stream_open' % cut, 'prefijo de %d B, el flujo sigue abierto: faltan datos' % cut, full[:cut],
        {'incomplete': True}, eof=False)
    add('truncated_%d_eof' % cut, 'prefijo de %d B y fin de flujo' % cut, full[:cut], err(0x010A), eof=True)
add('empty_eof', 'sin bytes y fin de flujo', b'', err(0x010A))

# ---- respuestas ----
resps = []


def radd(name, desc, data, expect, canonical=False, eof=True):
    v = {'name': name, 'desc': desc, 'hex': data.hex(), 'eof': eof, 'expect': expect}
    if canonical:
        v['canonical'] = True
    resps.append(v)


def raw_resp(version=1, status=0, code=0, msg=b'', ext=b'', magic=b'CAPR', ml=None, el=None):
    return (magic + bytes([version, status]) + struct.pack('>H', code) + bytes([len(msg) if ml is None else ml]) + msg
            + struct.pack('>H', len(ext) if el is None else el) + ext)


def rf(version=1, status=0, code=0, msg='', tlvs=None):
    return {'version': version, 'status': status, 'code': code, 'msg': msg, 'tlvs': tlvs or {}}


def rok(f, data):
    return {'ok': True, 'consumed': len(data), 'fields': f}


def rerr(n):
    return {'ok': False, 'error': n}


d = raw_resp(msg=b'ok')
radd('ok_minimal', 'status 0', d, rok(rf(msg='ok'), d), True)
d = raw_resp()
radd('ok_empty_msg', 'status 0 sin mensaje', d, rok(rf(), d), True)
ext = tlv(3, bytes.fromhex('1122334455667788')) + tlv(4, bytes([4, 192, 0, 2, 10]) + struct.pack('>H', 51234)) + tlv(5, struct.pack('>H', 1472)) + tlv(6, struct.pack('>H', 60))
d = raw_resp(msg=b'ok', ext=ext)
radd('ok_udp_session_ipv4', 'sesion UDP, direccion observada IPv4', d,
     rok(rf(msg='ok', tlvs={'session_id_hex': '1122334455667788', 'client_addr': {'ip': '192.0.2.10', 'port': 51234},
                            'max_datagram': 1472, 'idle_timeout': 60}), d), True)
v6 = bytes.fromhex('20010db8000000000000000000000001')
d = raw_resp(msg=b'ok', ext=tlv(4, bytes([6]) + v6 + struct.pack('>H', 40000)))
radd('ok_client_addr_ipv6', 'direccion observada IPv6', d,
     rok(rf(msg='ok', tlvs={'client_addr': {'ip': '2001:db8::1', 'port': 40000}}), d), True)
d = raw_resp(status=1, code=0x0101, msg=b'unsupported version', ext=tlv(1, b'\x01'))
radd('unsupported_version_reply', 'status 1 con max_version', d, rok(rf(status=1, code=0x0101, msg='unsupported version', tlvs={'max_version': 1}), d), True)
d = raw_resp(status=2, code=0x0201, msg=b'not authorized')
radd('status2_uniform', 'respuesta uniforme', d, rok(rf(status=2, code=0x0201, msg='not authorized'), d), True)
d = raw_resp(status=3, code=0x0301, msg=b'ip not allowed')
radd('status3_ip', 'IP no permitida', d, rok(rf(status=3, code=0x0301, msg='ip not allowed'), d), True)
d = raw_resp(status=5, code=0x0503, msg=b'rate limited', ext=tlv(2, struct.pack('>H', 30)))
radd('status5_retry_after', 'cuota con retry_after', d, rok(rf(status=5, code=0x0503, msg='rate limited', tlvs={'retry_after': 30}), d), True)
d = raw_resp(status=4, code=0x0401, msg=b'destination unavailable')
radd('status4', 'destino caido', d, rok(rf(status=4, code=0x0401, msg='destination unavailable'), d), True)
d = raw_resp(status=6, code=0x0601, msg=b'draining')
radd('status6', 'gateway drenando', d, rok(rf(status=6, code=0x0601, msg='draining'), d), True)
d = raw_resp(status=9, code=0x0999, msg=b'future status')
radd('unknown_status_decodes', 'un status desconocido se decodifica; el cliente lo trata como error no reintentable', d,
     rok(rf(status=9, code=0x0999, msg='future status'), d), True)
d = raw_resp(msg=b'x' * 120)
radd('limit_msg_120', 'mensaje de 120', d, rok(rf(msg='x' * 120), d), True)
d = raw_resp(msg=b'ok', ext=tlv(0x90, b'zz') + tlv(0x07, b'zz') + tlv(0x80, b'\x00\x00'))
radd('unknown_ext_ignored', 'TLV de respuesta desconocidos (cualquier tipo) se ignoran', d, rok(rf(msg='ok'), d), False)
d = raw_resp(msg=b'ok') + b'SSH-2.0-x\r\n'
radd('ok_with_following_data', 'datos del destino tras la respuesta', d, {'ok': True, 'consumed': len(raw_resp(msg=b'ok')), 'fields': rf(msg='ok')}, False)
radd('bad_magic', 'magic invalido', raw_resp(magic=b'CAPX'), rerr('bad_magic'))
radd('version_0', 'version 0', raw_resp(version=0), rerr('bad_version'))
radd('msg_121', 'mensaje de 121', raw_resp(msg=b'x' * 121), rerr('msg_too_long'))
radd('msg_control_char', 'caracter de control en el mensaje', raw_resp(msg=b'a\x01b'), rerr('bad_msg'))
radd('ext_257', 'extensiones de 257 B', raw_resp(ext=b'\x80\xff' + b'\x00' * 255), rerr('ext_too_long'))
radd('ext_bad_len_known', 'retry_after con longitud 3', raw_resp(ext=tlv(2, b'\x00\x00\x00')), rerr('bad_ext'))
radd('ext_dup_known', 'session_id repetido', raw_resp(ext=tlv(3, b'\x00' * 8) * 2), rerr('bad_ext'))
radd('ext_addr_family_mismatch', 'familia 6 con 4 bytes', raw_resp(ext=tlv(4, bytes([6, 1, 2, 3, 4, 0, 80]))), rerr('bad_ext'))
radd('ext_tlv_overrun', 'TLV excede ext_len', raw_resp(ext=b'\x05\x09\x00'), rerr('bad_ext'))
okr = raw_resp(msg=b'ok', ext=tlv(5, struct.pack('>H', 1472)))
for cut in (0, 8, 9, 10, len(okr) - 1):
    radd('truncated_%d_stream_open' % cut, 'prefijo %d B, flujo abierto' % cut, okr[:cut], {'incomplete': True}, eof=False)
    radd('truncated_%d_eof' % cut, 'prefijo %d B, fin de flujo' % cut, okr[:cut], rerr('truncated'))

# ---- URI ----
uris = []


def uadd(uri, expect, name):
    uris.append({'name': name, 'uri': uri, 'default_zone': ZONE, 'expect': expect})


def uok(project, service, transport='tcp', family='any', host=None, port=443, sni=None):
    host = host or (transport + '.' + ZONE)
    return {'ok': True, 'fields': {'project': project, 'service': service, 'transport': transport, 'family': family,
                                   'connect_host': host, 'connect_port': port, 'sni': sni or host}}


def uerr(n):
    return {'ok': False, 'error': n}


uadd('capsule://mi-proyecto/db', uok('mi-proyecto', 'db'), 'basic')
uadd('CAPSULE://mi-proyecto/db', uok('mi-proyecto', 'db'), 'scheme_case_insensitive')
uadd('capsule://a/b', uok('a', 'b'), 'one_char')
uadd('capsule://mi-proyecto/minecraft?transport=udp', uok('mi-proyecto', 'minecraft', 'udp'), 'udp')
uadd('capsule://p/s?family=6', uok('p', 's', family='6'), 'family6')
uadd('capsule://p/s?zone=apps.example.test', uok('p', 's', host='tcp.apps.example.test'), 'zone_override')
uadd('capsule://p/s?zone=apps.example.test&transport=udp', uok('p', 's', 'udp', host='udp.apps.example.test'), 'zone_udp')
uadd('capsule://p/s?gateway=gw.example.test:8443', uok('p', 's', host='gw.example.test', port=8443), 'gateway_dns_port')
uadd('capsule://p/s?gateway=gw.example.test', uok('p', 's', host='gw.example.test'), 'gateway_dns')
uadd('capsule://p/s?gateway=%5B2001:db8::1%5D:8443&sni=tcp.apps.example.test',
     uok('p', 's', host='2001:db8::1', port=8443, sni='tcp.apps.example.test'), 'gateway_ipv6_encoded')
uadd('capsule://p/s?gateway=[2001:db8::1]&sni=tcp.apps.example.test&family=6',
     uok('p', 's', family='6', host='2001:db8::1', sni='tcp.apps.example.test'), 'gateway_ipv6_raw')
uadd('capsule://p/s?gateway=[2001:0DB8:0:0:0:0:0:1]&sni=a.example.test',
     uok('p', 's', host='2001:db8::1', sni='a.example.test'), 'gateway_ipv6_canonicalized')
uadd('capsule://p/s?gateway=192.0.2.7:9000&sni=a.example.test', uok('p', 's', host='192.0.2.7', port=9000, sni='a.example.test'), 'gateway_ipv4_literal')
uadd('capsule://p/s?gateway=gw.example.test&sni=other.example.test', uok('p', 's', host='gw.example.test', sni='other.example.test'), 'gateway_with_sni')
uadd('capsule://p/s?x-trace=1', uok('p', 's'), 'x_param_ignored')
uadd('capsule://p/s?zone=%61pps.example.test', uok('p', 's', host='tcp.apps.example.test'), 'percent_in_value')
uadd('capsule:p/s', uerr('bad_scheme'), 'no_slashes')
uadd('http://p/s', uerr('bad_scheme'), 'other_scheme')
uadd('capsule://p', uerr('bad_path'), 'no_service')
uadd('capsule://p/', uerr('bad_service'), 'empty_service')
uadd('capsule://p/s/', uerr('bad_path'), 'trailing_slash')
uadd('capsule://p/s/extra', uerr('bad_path'), 'extra_segment')
uadd('capsule:///s', uerr('bad_project'), 'empty_project')
uadd('capsule://Mi-Proyecto/db', uerr('bad_project'), 'uppercase_project')
uadd('capsule://p/DB', uerr('bad_service'), 'uppercase_service')
uadd('capsule://%70/s', uerr('bad_project'), 'percent_in_project')
uadd('capsule://-p/s', uerr('bad_project'), 'leading_hyphen')
uadd('capsule://p_q/s', uerr('bad_project'), 'underscore')
uadd('capsule://' + 'a' * 64 + '/s', uerr('bad_project'), 'project_64')
uadd('capsule://u:pw@p/s', uerr('userinfo'), 'userinfo_with_password')
uadd('capsule://tok@p/s', uerr('userinfo'), 'userinfo')
uadd('capsule://p:443/s', uerr('port'), 'port_in_authority')
uadd('capsule://[::1]/s', uerr('port'), 'ipv6_literal_as_project')
uadd('capsule://p/s#frag', uerr('fragment'), 'fragment')
uadd('capsule://p/s?', uerr('bad_param'), 'empty_query')
uadd('capsule://p/s?transport', uerr('bad_param'), 'param_without_value')
uadd('capsule://p/s?transport=', uerr('bad_param'), 'param_empty_value')
uadd('capsule://p/s?transport=quic', uerr('bad_param'), 'transport_quic_not_a_uri_value')
uadd('capsule://p/s?transport=tcp&transport=udp', uerr('dup_param'), 'dup')
uadd('capsule://p/s?token=abc', uerr('unknown_param'), 'token_in_uri_rejected')
uadd('capsule://p/s?family=5', uerr('bad_param'), 'family_bad')
uadd('capsule://p/s?zone=apps.example.test&gateway=gw.example.test', uerr('bad_param'), 'zone_and_gateway')
uadd('capsule://p/s?zone=Apps.Example.Test', uerr('bad_param'), 'zone_uppercase')
uadd('capsule://p/s?zone=localhost', uerr('bad_param'), 'zone_single_label')
uadd('capsule://p/s?gateway=%5B2001:db8::1%5D', uerr('sni_required'), 'ipv6_needs_sni')
uadd('capsule://p/s?gateway=192.0.2.7', uerr('sni_required'), 'ipv4_needs_sni')
uadd('capsule://p/s?gateway=2001:db8::1&sni=a.example.test', uerr('bad_gateway'), 'ipv6_without_brackets')
uadd('capsule://p/s?gateway=[fe80::1%25eth0]&sni=a.example.test', uerr('bad_gateway'), 'ipv6_zone_id')
uadd('capsule://p/s?gateway=gw.example.test:0', uerr('bad_gateway'), 'port_0')
uadd('capsule://p/s?gateway=gw.example.test:65536', uerr('bad_gateway'), 'port_65536')
uadd('capsule://p/s?gateway=999.1.1.1&sni=a.example.test', uerr('bad_gateway'), 'bad_ipv4')
uadd('capsule://p/s?zone=%zz', uerr('bad_escape'), 'bad_escape')
uadd('capsule://p/s?zone=a%20b.example.test', uerr('bad_param'), 'encoded_space')

# ---- UDP framing ----
udp = []


def uf(name, hexs, expect):
    udp.append({'name': name, 'hex': hexs, 'expect': expect})


uf('one_datagram', '0003616263', {'datagrams': ['616263'], 'keepalives': 0, 'pending': 0})
uf('two_datagrams', '00020102' + '0001ff', {'datagrams': ['0102', 'ff'], 'keepalives': 0, 'pending': 0})
uf('keepalive_between', '0001aa' + '0000' + '0001bb', {'datagrams': ['aa', 'bb'], 'keepalives': 1, 'pending': 0})
uf('only_keepalives', '00000000', {'datagrams': [], 'keepalives': 2, 'pending': 0})
uf('partial_length', '0001aa00', {'datagrams': ['aa'], 'keepalives': 0, 'pending': 1})
uf('partial_body', '0001aa0005aabb', {'datagrams': ['aa'], 'keepalives': 0, 'pending': 4})
uf('max_2048', '0800' + '00' * 2048, {'datagrams': ['00' * 2048], 'keepalives': 0, 'pending': 0})
uf('too_large_2049', '0801' + '00' * 2049, {'error': 'frame_too_large'})
uf('too_large_ffff', 'ffff00', {'error': 'frame_too_large'})
uf('empty', '', {'datagrams': [], 'keepalives': 0, 'pending': 0})

# ---- IP ----
ips = []


def ipv(name, cidrs, ip, allowed):
    ips.append({'name': name, 'cidrs': cidrs, 'ip': ip, 'allowed': allowed})


ipv('v4_inside', ['203.0.113.0/24'], '203.0.113.77', True)
ipv('v4_outside', ['203.0.113.0/24'], '203.0.114.1', False)
ipv('v4_host_32', ['198.51.100.9/32'], '198.51.100.9', True)
ipv('v4_host_32_other', ['198.51.100.9/32'], '198.51.100.10', False)
ipv('v6_inside_48', ['2001:db8:abcd::/48'], '2001:db8:abcd:1::5', True)
ipv('v6_outside_48', ['2001:db8:abcd::/48'], '2001:db8:abce::1', False)
ipv('v6_host_128', ['2001:db8::1/128'], '2001:db8::1', True)
ipv('v6_canonical_form', ['2001:db8::1/128'], '2001:0db8:0000:0000:0000:0000:0000:0001', True)
ipv('v4_mapped_matches_v4_rule', ['203.0.113.0/24'], '::ffff:203.0.113.5', True)
ipv('v4_mapped_does_not_match_v6_rule', ['::ffff:0:0/96'], '::ffff:203.0.113.5', False)
ipv('v4_client_vs_v6_rule', ['2001:db8::/32'], '192.0.2.1', False)
ipv('v6_client_vs_v4_rule', ['0.0.0.0/0'], '2001:db8::1', False)
ipv('any_v6', ['::/0'], '2001:db8::1', True)
ipv('empty_list_denies', [], '203.0.113.5', False)
ipv('multiple_rules', ['10.0.0.0/8', '2001:db8::/32'], '2001:db8:1::1', True)

# ---- escritura ----
os.makedirs(os.path.join(OUT, 'hex'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'bin'), exist_ok=True)


def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, indent=1, ensure_ascii=True)
        f.write('\n')


dump('request.json', {'spec': 'PROTOCOL.md sec. 5', 'vectors': reqs})
dump('response.json', {'spec': 'PROTOCOL.md sec. 6', 'vectors': resps})
dump('uri.json', {'spec': 'PROTOCOL.md sec. 2', 'vectors': uris})
dump('udp_frames.json', {'spec': 'PROTOCOL.md sec. 10', 'vectors': udp})
dump('ip_allowlist.json', {'spec': 'PROTOCOL.md sec. 12', 'vectors': ips})
for kind, lst in (('req', reqs), ('resp', resps)):
    for v in lst:
        raw = bytes.fromhex(v['hex'])
        with open(os.path.join(OUT, 'hex', '%s_%s.hex' % (kind, v['name'])), 'w', newline='\n') as f:
            f.write(v['hex'] + '\n')
        with open(os.path.join(OUT, 'bin', '%s_%s.bin' % (kind, v['name'])), 'wb') as f:
            f.write(raw)
print('request', len(reqs), 'response', len(resps), 'uri', len(uris), 'udp', len(udp), 'ip', len(ips))
