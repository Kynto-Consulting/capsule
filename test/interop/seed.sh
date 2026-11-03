#!/usr/bin/env bash
# seed.sh : organisation, users, projects, database + published ports (the sources the gateway services mirror) and cap_ tokens.
# Needs tokens.env (made by run.sh). Plain SQL against the control DB: the same tables the real repositories read.
set -euo pipefail
W=${W:-/tmp/capsule-interop}
export PGPASSWORD=interop-pg-pass
. "$W/run/tokens.env"
h() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
psql -h 127.0.0.1 -p 55440 -U postgres -d capsule -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO users (id,email,password_hash,name) VALUES
 ('00000000-0000-0000-0000-0000000000a1','owner@interop.test','x','Owner'),
 ('00000000-0000-0000-0000-0000000000a2','other@interop.test','x','Other');
INSERT INTO organizations (id,name,slug,owner_id) VALUES
 ('00000000-0000-0000-0000-0000000000b1','Acme','acme','00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000000b2','Rival','rival','00000000-0000-0000-0000-0000000000a2');
INSERT INTO org_members (org_id,user_id,role) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','owner');
INSERT INTO projects (id,org_id,name,slug,repo_url,branch,runtime) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','Shop','shop','https://example.com/shop.git','main','node'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2','Rival','rival','https://example.com/rival.git','main','node');
INSERT INTO api_tokens (user_id,name,token_hash,prefix,project_id) VALUES
 ('00000000-0000-0000-0000-0000000000a1','interop owner','$(h "$CAP_OK")','cap_',NULL),
 ('00000000-0000-0000-0000-0000000000a2','interop outsider','$(h "$CAP_OTHER")','cap_',NULL),
 ('00000000-0000-0000-0000-0000000000a1','interop scoped elsewhere','$(h "$CAP_SCOPED")','cap_','00000000-0000-0000-0000-0000000000c2');
-- the PostgreSQL clusters of the project (real, TLS: 55441 and 55442) and one more whose rule list excludes this machine
INSERT INTO databases (id,project_id,org_id,name,engine,version,host,port,db_name,credentials_enc,status,container_id,volume_name) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','pg','postgres','18','127.0.0.1',55441,'app','\x00','ready','',''),
 ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','pg2','postgres','18','127.0.0.1',55442,'app','\x00','ready','',''),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','pgdeny','postgres','18','127.0.0.1',55441,'app','\x00','ready','','');
INSERT INTO database_access_rules (database_id,cidr)
 SELECT d.id, c FROM (VALUES ('00000000-0000-0000-0000-0000000000d1'::uuid),('00000000-0000-0000-0000-0000000000d3'::uuid)) d(id),
 (VALUES ('127.0.0.0/8'),('::1/128'),('172.16.0.0/12'),('10.0.0.0/8'),('192.168.0.0/16')) r(c);
INSERT INTO database_access_rules (database_id,cidr) VALUES ('00000000-0000-0000-0000-0000000000d2','203.0.113.0/24');
-- published ports served by the harness: ssh/ssh2 (SSH servers), echo, bench, flaky, hot (enabled during the hot-route test), idle00..idle09
INSERT INTO project_ports (id,project_id,name,container_port,protocol,host_port) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','ssh',22,'tcp',55422),
 ('00000000-0000-0000-0000-0000000000e5','00000000-0000-0000-0000-0000000000c1','ssh2',2222,'tcp',55423),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000c1','echo',7,'tcp',55407),
 ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000c1','bench',9,'tcp',55409),
 ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000c1','echodeny',70,'tcp',55408),
 ('00000000-0000-0000-0000-0000000000e6','00000000-0000-0000-0000-0000000000c1','flaky',11,'tcp',55410),
 ('00000000-0000-0000-0000-0000000000e7','00000000-0000-0000-0000-0000000000c1','hot',12,'tcp',55411),
 ('00000000-0000-0000-0000-0000000000e8','00000000-0000-0000-0000-0000000000c1','sshdeny',2224,'tcp',55424),
 ('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000c1','churn',13,'tcp',55412);
INSERT INTO project_ports (project_id,name,container_port,protocol,host_port)
 SELECT '00000000-0000-0000-0000-0000000000c1', 'idle'||lpad(i::text,2,'0'), 100+i, 'tcp', 55500+i FROM generate_series(0,9) i;
INSERT INTO project_port_rules (port_id,cidr)
 SELECT p.id, c FROM project_ports p, (VALUES ('127.0.0.0/8'),('::1/128'),('172.16.0.0/12'),('10.0.0.0/8'),('192.168.0.0/16')) r(c)
 WHERE p.project_id='00000000-0000-0000-0000-0000000000c1' AND p.name NOT IN ('echodeny','sshdeny');
INSERT INTO project_port_rules (port_id,cidr) VALUES ('00000000-0000-0000-0000-0000000000e4','203.0.113.0/24'),('00000000-0000-0000-0000-0000000000e8','203.0.113.0/24');
SQL
echo seeded
