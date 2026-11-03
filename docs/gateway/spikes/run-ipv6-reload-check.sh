cd ~/gw
for h in '[::1]' 127.0.0.1; do echo -n "openssl a.test via $h -> "; echo | openssl s_client -connect $h:8443 -servername a.test 2>/dev/null | grep subject=; done
echo -n "c.test (ruta anadida en caliente, ya cargada) -> "; echo | openssl s_client -connect 127.0.0.1:8443 -servername c.test 2>/dev/null | grep subject=
echo -n "Solo IPv4 (curl -4 no aplica a TLS crudo); IPv6 only: gateway escucha '*:8443' (doble pila): "; ss -ltn | grep 8443
grep -c '"result":"ok"' results/gw.log; grep -m3 no_route results/gw.log
