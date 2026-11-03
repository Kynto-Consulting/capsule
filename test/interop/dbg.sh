W=/tmp/capsule-interop; . $W/run/tokens.env
curl -s -H "Authorization: Bearer $CAP_OK" http://localhost:18080/api/v1/orgs/00000000-0000-0000-0000-0000000000b1/projects/00000000-0000-0000-0000-0000000000c1 | head -c 300; echo
curl -s -H "Authorization: Bearer $CAP_OK" http://localhost:18080/api/v1/orgs/00000000-0000-0000-0000-0000000000b1/projects | head -c 300; echo
curl -s -H "Authorization: Bearer $CAP_OK" http://localhost:18080/api/v1/orgs/00000000-0000-0000-0000-0000000000b1/projects/00000000-0000-0000-0000-0000000000c1/ports | head -c 300; echo
