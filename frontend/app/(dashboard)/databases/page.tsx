'use client'

import { useState } from 'react'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import { usePageTitle } from '@/lib/use-page-title'
import type { Database, ListResponse, Project, Organization } from '@/lib/types'

function listOrgDatabases(token: string, orgId: string) {
  return api.get<ListResponse<Database>>(`/api/v1/orgs/${orgId}/databases`, token)
}

function dbStatusBadge(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'available') return 'success'
  if (status === 'provisioning') return 'warning'
  if (status === 'failed') return 'error'
  return 'default'
}

function engineColor(engine: string): string {
  switch (engine) {
    case 'postgres':      return 'bg-blue-500'
    case 'mysql':         return 'bg-orange-400'
    case 'mariadb':       return 'bg-amber-500'
    case 'redis':         return 'bg-red-500'
    case 'mongodb':       return 'bg-green-500'
    case 'cassandra':     return 'bg-sky-400'
    case 'clickhouse':    return 'bg-yellow-400'
    case 'elasticsearch': return 'bg-teal-400'
    case 'cockroachdb':   return 'bg-purple-500'
    default:              return 'bg-[--text-muted]'
  }
}

interface FlatDatabase extends Database {
  projectName: string
  orgId: string
}

export default function DatabasesPage() {
  usePageTitle('Databases · Capsule')
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [selectedDb, setSelectedDb] = useState<FlatDatabase | null>(null)

  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })
  const orgs = orgsRes?.data ?? []

  const projectQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['projects', org.id],
      queryFn: () => listProjects(token, org.id),
      enabled: orgs.length > 0,
    })),
  })

  const allProjects: (Project & { orgId: string })[] = projectQueries.flatMap((q, i) =>
    (q.data?.data ?? []).map((p) => ({ ...p, orgId: orgs[i]?.id ?? '' }))
  )
  const projectsLoading = projectQueries.some((q) => q.isLoading)

  // Fetch databases at the org level (includes all + standalone)
  const orgDbQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['databases-org', org.id],
      queryFn: () => listOrgDatabases(token, org.id),
      enabled: orgs.length > 0,
    })),
  })

  const allDatabases: FlatDatabase[] = orgDbQueries
    .flatMap((q, i) => {
      const org = orgs[i]
      if (!org) return []
      return (q.data?.data ?? []).map((d) => {
        const proj = allProjects.find((p) => p.id === d.project_id)
        return {
          ...d,
          projectName: proj?.name ?? '—',
          orgId: org.id,
        }
      })
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const dbsLoading = orgDbQueries.some((q) => q.isLoading)
  const isLoading = orgsLoading || projectsLoading || dbsLoading

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Databases</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">
            {isLoading ? '…' : `${allDatabases.length} database${allDatabases.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowModal(true)}>Add database</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <PageSpinner />
        </div>
      ) : allDatabases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center bg-[--bg-raised] rounded-[--radius-lg] border border-dashed border-[rgba(255,255,255,0.08)]">
          <div className="w-12 h-12 rounded-[--radius-lg] bg-[--bg-surface] border border-[--border] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[--text-primary]">No databases yet</p>
            <p className="text-xs text-[--text-muted] mt-1 max-w-xs">Provision a PostgreSQL, MySQL, or Redis database.</p>
          </div>
          <Button size="sm" onClick={() => setShowModal(true)}>Create Database</Button>
        </div>
      ) : (
        <div className="rounded-[--radius-lg] border border-[--border] overflow-hidden">
          <div
            className="grid text-[11px] font-medium text-[--text-muted] uppercase tracking-wide px-4 py-2.5"
            style={{
              gridTemplateColumns: '1fr 100px 110px 120px 90px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <span>Name</span>
            <span>Engine</span>
            <span>Status</span>
            <span>Project</span>
            <span className="text-right">Created</span>
          </div>
          {allDatabases.map((d) => (
            <div
              key={d.id}
              onClick={() => setSelectedDb(d)}
              className="grid items-center px-4 py-3 text-sm cursor-pointer hover:bg-[rgba(255,255,255,0.03)] transition-colors"
              style={{
                gridTemplateColumns: '1fr 100px 110px 120px 90px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
            >
              <span className="text-[--text-primary] font-medium font-mono truncate pr-4">{d.name}</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${engineColor(d.engine)}`} />
                <span className="text-xs text-[--text-secondary] capitalize">{d.engine}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {d.status === 'provisioning' && (
                  <span className="w-3 h-3 rounded-full border border-yellow-400 border-t-transparent animate-spin flex-shrink-0" />
                )}
                <Badge variant={dbStatusBadge(d.status)}>
                  {d.status === 'provisioning' ? 'Provisioning…' : d.status}
                </Badge>
              </span>
              <span className="text-xs text-[--text-muted] truncate">{d.projectName}</span>
              <span className="text-xs text-[--text-muted] text-right">{formatRelative(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddDatabaseModal
          orgs={orgs}
          projects={allProjects}
          token={token}
          onClose={() => setShowModal(false)}
          onCreated={(orgId) => {
            qc.invalidateQueries({ queryKey: ['databases-org', orgId] })
            setShowModal(false)
          }}
        />
      )}

      {selectedDb && (
        <DatabasePanel
          db={selectedDb}
          token={token}
          onClose={() => setSelectedDb(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ['databases-org', selectedDb.orgId] })
            setSelectedDb(null)
          }}
        />
      )}
    </div>
  )
}

const ENGINE_OPTIONS = [
  { value: 'postgres',      label: 'PostgreSQL' },
  { value: 'mysql',         label: 'MySQL' },
  { value: 'mariadb',       label: 'MariaDB' },
  { value: 'redis',         label: 'Redis' },
  { value: 'mongodb',       label: 'MongoDB' },
  { value: 'cassandra',     label: 'Cassandra' },
  { value: 'clickhouse',    label: 'ClickHouse' },
  { value: 'elasticsearch', label: 'Elasticsearch' },
  { value: 'cockroachdb',   label: 'CockroachDB' },
]

function AddDatabaseModal({
  orgs,
  projects,
  token,
  onClose,
  onCreated,
}: {
  orgs: Organization[]
  projects: (Project & { orgId: string })[]
  token: string
  onClose: () => void
  onCreated: (orgId: string) => void
}) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '')
  const [projectId, setProjectId] = useState('none')
  const [engine, setEngine] = useState('postgres')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const orgProjects = projects.filter((p) => p.orgId === orgId)

  const projectOptions = [
    { value: 'none', label: 'No project (standalone)' },
    ...orgProjects.map((p) => ({ value: p.id, label: p.name })),
  ]

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (projectId === 'none') {
        return api.post(`/api/v1/orgs/${orgId}/databases`, { name, engine, version: 'latest' }, token)
      }
      return api.post(
        `/api/v1/orgs/${orgId}/projects/${projectId}/databases`,
        { name, engine, version: 'latest' },
        token
      )
    },
    onSuccess: () => onCreated(orgId),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[--bg-surface] border border-[--border] rounded-[--radius-xl] p-6 w-full max-w-sm flex flex-col gap-4 shadow-[--shadow]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[--text-primary]">Add database</h2>
          <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-secondary] transition-colors text-lg leading-none">&times;</button>
        </div>

        <div className="flex flex-col gap-3">
          {orgs.length > 1 && (
            <Select
              label="Organization"
              value={orgId}
              onChange={(v) => { setOrgId(v); setProjectId('none') }}
              options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            />
          )}

          <Select
            label="Project"
            value={projectId}
            onChange={(v) => setProjectId(v)}
            options={projectOptions}
          />

          <Select
            label="Engine"
            value={engine}
            onChange={(v) => setEngine(v)}
            options={ENGINE_OPTIONS}
          />

          <Input
            label="Name"
            placeholder="my-database"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-[--danger]">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutate()} loading={isPending} disabled={!name || !orgId}>
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Engine client metadata ───────────────────────────────────────────────────

interface EngineClient {
  label: string
  port: number
  install: string
  snippets: { lang: string; code: (host: string, port: number, name: string) => string }[]
}

const ENGINE_CLIENTS: Record<string, EngineClient> = {
  postgres: {
    label: 'PostgreSQL',
    port: 5432,
    install: 'npm i pg   # or: pip install psycopg2   # or: go get github.com/jackc/pgx/v5',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `const { Pool } = require('pg')
const pool = new Pool({ host: '${h}', port: ${p}, database: '${n}', user: 'capsuleadmin', password: 'YOUR_PASSWORD', ssl: false })
const { rows } = await pool.query('SELECT NOW()')` },
      { lang: 'Python', code: (h, p, n) => `import psycopg2
conn = psycopg2.connect(host="${h}", port=${p}, dbname="${n}", user="capsuleadmin", password="YOUR_PASSWORD")
cur = conn.cursor(); cur.execute("SELECT NOW()"); print(cur.fetchone())` },
      { lang: 'Go', code: (h, p, n) => `import "github.com/jackc/pgx/v5"
conn, _ := pgx.Connect(ctx, "postgres://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}")
defer conn.Close(ctx)` },
    ],
  },
  mysql: {
    label: 'MySQL',
    port: 3306,
    install: 'npm i mysql2   # or: pip install mysql-connector-python   # or: go get github.com/go-sql-driver/mysql',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `const mysql = require('mysql2/promise')
const conn = await mysql.createConnection({ host: '${h}', port: ${p}, database: '${n}', user: 'capsuleadmin', password: 'YOUR_PASSWORD' })
const [rows] = await conn.query('SELECT NOW()')` },
      { lang: 'Python', code: (h, p, n) => `import mysql.connector
conn = mysql.connector.connect(host="${h}", port=${p}, database="${n}", user="capsuleadmin", password="YOUR_PASSWORD")
cursor = conn.cursor(); cursor.execute("SELECT NOW()"); print(cursor.fetchone())` },
      { lang: 'Go', code: (h, p, n) => `import _ "github.com/go-sql-driver/mysql"
db, _ := sql.Open("mysql", "capsuleadmin:YOUR_PASSWORD@tcp(${h}:${p})/${n}")
defer db.Close()` },
    ],
  },
  mariadb: {
    label: 'MariaDB',
    port: 3306,
    install: 'npm i mariadb   # or: pip install mariadb   # or: go get github.com/go-sql-driver/mysql',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `const mariadb = require('mariadb')
const pool = mariadb.createPool({ host: '${h}', port: ${p}, database: '${n}', user: 'capsuleadmin', password: 'YOUR_PASSWORD' })
const conn = await pool.getConnection()` },
      { lang: 'Python', code: (h, p, n) => `import mariadb
conn = mariadb.connect(host="${h}", port=${p}, database="${n}", user="capsuleadmin", password="YOUR_PASSWORD")
cur = conn.cursor(); cur.execute("SELECT VERSION()"); print(cur.fetchone())` },
      { lang: 'Go', code: (h, p, n) => `// MariaDB uses the MySQL driver
import _ "github.com/go-sql-driver/mysql"
db, _ := sql.Open("mysql", "capsuleadmin:YOUR_PASSWORD@tcp(${h}:${p})/${n}")` },
    ],
  },
  redis: {
    label: 'Redis',
    port: 6379,
    install: 'npm i ioredis   # or: pip install redis   # or: go get github.com/redis/go-redis/v9',
    snippets: [
      { lang: 'Node.js', code: (h, p) => `const Redis = require('ioredis')
const redis = new Redis({ host: '${h}', port: ${p}, password: 'YOUR_PASSWORD' })
await redis.set('key', 'value'); const val = await redis.get('key')` },
      { lang: 'Python', code: (h, p) => `import redis
r = redis.Redis(host="${h}", port=${p}, password="YOUR_PASSWORD", decode_responses=True)
r.set("key", "value"); print(r.get("key"))` },
      { lang: 'Go', code: (h, p) => `import "github.com/redis/go-redis/v9"
rdb := redis.NewClient(&redis.Options{ Addr: "${h}:${p}", Password: "YOUR_PASSWORD" })
err := rdb.Set(ctx, "key", "value", 0).Err()` },
    ],
  },
  mongodb: {
    label: 'MongoDB',
    port: 27017,
    install: 'npm i mongodb   # or: pip install pymongo   # or: go get go.mongodb.org/mongo-driver/mongo',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `const { MongoClient } = require('mongodb')
const client = new MongoClient(\`mongodb://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}\`)
await client.connect(); const db = client.db('${n}')` },
      { lang: 'Python', code: (h, p, n) => `from pymongo import MongoClient
client = MongoClient(host="${h}", port=${p}, username="capsuleadmin", password="YOUR_PASSWORD")
db = client["${n}"]` },
      { lang: 'Go', code: (h, p, n) => `import "go.mongodb.org/mongo-driver/mongo"
client, _ := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}"))
collection := client.Database("${n}").Collection("items")` },
    ],
  },
  cassandra: {
    label: 'Cassandra',
    port: 9042,
    install: 'npm i cassandra-driver   # or: pip install cassandra-driver   # or: go get github.com/gocql/gocql',
    snippets: [
      { lang: 'Node.js', code: (h, p) => `const cassandra = require('cassandra-driver')
const client = new cassandra.Client({ contactPoints: ['${h}'], localDataCenter: 'datacenter1', protocolOptions: { port: ${p} } })
await client.connect()` },
      { lang: 'Python', code: (h, p) => `from cassandra.cluster import Cluster
cluster = Cluster(['${h}'], port=${p})
session = cluster.connect()
session.execute("SELECT now() FROM system.local")` },
      { lang: 'Go', code: (h, p) => `import "github.com/gocql/gocql"
cluster := gocql.NewCluster("${h}"); cluster.Port = ${p}
session, _ := cluster.CreateSession(); defer session.Close()` },
    ],
  },
  clickhouse: {
    label: 'ClickHouse',
    port: 8123,
    install: 'npm i @clickhouse/client   # or: pip install clickhouse-connect   # or: go get github.com/ClickHouse/clickhouse-go/v2',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `const { createClient } = require('@clickhouse/client')
const client = createClient({ host: 'http://${h}:${p}', database: '${n}', username: 'capsuleadmin', password: 'YOUR_PASSWORD' })
const result = await client.query({ query: 'SELECT now()', format: 'JSONEachRow' })` },
      { lang: 'Python', code: (h, p, n) => `import clickhouse_connect
client = clickhouse_connect.get_client(host="${h}", port=${p}, database="${n}", username="capsuleadmin", password="YOUR_PASSWORD")
result = client.query("SELECT now()")` },
      { lang: 'Go', code: (h, p, n) => `import "github.com/ClickHouse/clickhouse-go/v2"
conn, _ := clickhouse.Open(&clickhouse.Options{ Addr: []string{"${h}:${p}"}, Auth: clickhouse.Auth{ Database: "${n}", Username: "capsuleadmin", Password: "YOUR_PASSWORD" } })` },
    ],
  },
  elasticsearch: {
    label: 'Elasticsearch',
    port: 9200,
    install: 'npm i @elastic/elasticsearch   # or: pip install elasticsearch   # or: go get github.com/elastic/go-elasticsearch/v8',
    snippets: [
      { lang: 'Node.js', code: (h, p) => `const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: 'http://${h}:${p}', auth: { username: 'capsuleadmin', password: 'YOUR_PASSWORD' } })
const info = await client.info()` },
      { lang: 'Python', code: (h, p) => `from elasticsearch import Elasticsearch
es = Elasticsearch("http://${h}:${p}", basic_auth=("capsuleadmin", "YOUR_PASSWORD"))
print(es.info())` },
      { lang: 'Go', code: (h, p) => `import elasticsearch "github.com/elastic/go-elasticsearch/v8"
es, _ := elasticsearch.NewClient(elasticsearch.Config{ Addresses: []string{"http://${h}:${p}"}, Username: "capsuleadmin", Password: "YOUR_PASSWORD" })
res, _ := es.Info()` },
    ],
  },
  cockroachdb: {
    label: 'CockroachDB',
    port: 26257,
    install: 'npm i pg   # or: pip install psycopg2   # or: go get github.com/jackc/pgx/v5',
    snippets: [
      { lang: 'Node.js', code: (h, p, n) => `// CockroachDB is PostgreSQL-compatible
const { Pool } = require('pg')
const pool = new Pool({ connectionString: 'postgresql://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}?sslmode=disable' })` },
      { lang: 'Python', code: (h, p, n) => `# CockroachDB is PostgreSQL-compatible
import psycopg2
conn = psycopg2.connect("postgresql://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}?sslmode=disable")` },
      { lang: 'Go', code: (h, p, n) => `// CockroachDB is PostgreSQL-compatible
import "github.com/jackc/pgx/v5"
conn, _ := pgx.Connect(ctx, "postgresql://capsuleadmin:YOUR_PASSWORD@${h}:${p}/${n}?sslmode=disable")` },
    ],
  },
}

// ─── Database detail panel ────────────────────────────────────────────────────

function DatabasePanel({ db, token, onClose, onDeleted }: {
  db: FlatDatabase
  token: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [activeLang, setActiveLang] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const client = ENGINE_CLIENTS[db.engine]
  const host = db.host || ''
  const port = db.port || client?.port || 0

  async function handleDelete() {
    if (!confirm(`Delete database "${db.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.delete(`/api/v1/orgs/${db.orgId}/databases/${db.id}`, token)
      onDeleted()
    } catch {
      setDeleting(false)
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1800)
    })
  }

  // Use backend-provided URL when available (includes real password); fall back to masked URL
  const connUrl: string = (db as FlatDatabase & { connection_url?: string }).connection_url
    || (host && port ? buildClientUrl(db.engine, host, port, db.name) : '')

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto flex flex-col border-l border-[--border]"
        style={{ background: '#141414' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[--border] flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${engineColor(db.engine)}`} />
            <div>
              <h2 className="text-sm font-semibold text-[--text-primary] font-mono">{db.name}</h2>
              <p className="text-[11px] text-[--text-muted] capitalize">{client?.label ?? db.engine} · {db.status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" loading={deleting} onClick={handleDelete}
              className="text-[--danger] border-[--danger]/30 hover:bg-[--danger]/10">
              Delete
            </Button>
            <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-secondary] transition-colors text-xl leading-none ml-1">&times;</button>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6">
          {/* Connection URL */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[--text-muted] mb-1.5">Connection URL</p>
            {connUrl ? (
              <div className="flex items-center gap-2 bg-[--bg-raised] border border-[--border] rounded-[--radius-sm] px-3 py-2">
                <code className="text-xs text-[--accent-light] font-mono flex-1 truncate">{connUrl}</code>
                <button
                  onClick={() => copy(connUrl, 'url')}
                  className="text-[10px] text-[--text-muted] hover:text-[--text-secondary] transition-colors flex-shrink-0 px-1.5 py-0.5 border border-[--border] rounded"
                >
                  {copied === 'url' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-[--bg-raised] border border-[--border] rounded-[--radius-sm] px-3 py-2">
                <span className="text-xs text-[--text-muted] font-mono">
                  {db.status === 'provisioning' ? 'Provisioning…' : 'Unavailable'}
                </span>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Host', value: host || (db.status === 'provisioning' ? '…' : '—') },
              { label: 'Port', value: port ? String(port) : (db.status === 'provisioning' ? '…' : '—') },
              { label: 'Version', value: db.version || '—' },
              { label: 'Engine', value: client?.label ?? db.engine },
              { label: 'Status', value: db.status },
              { label: 'Project', value: db.projectName },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[--bg-raised] border border-[--border] rounded-[--radius-sm] px-3 py-2">
                <p className="text-[10px] text-[--text-muted] uppercase tracking-wider">{label}</p>
                <p className="text-xs text-[--text-primary] font-mono mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Install */}
          {client && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[--text-muted] mb-1.5">Install client</p>
              <div className="flex items-center gap-2 bg-[--bg-raised] border border-[--border] rounded-[--radius-sm] px-3 py-2">
                <code className="text-xs text-[--text-secondary] font-mono flex-1">{client.install}</code>
                <button
                  onClick={() => copy(client.install, 'install')}
                  className="text-[10px] text-[--text-muted] hover:text-[--text-secondary] transition-colors flex-shrink-0 px-1.5 py-0.5 border border-[--border] rounded"
                >
                  {copied === 'install' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Code snippets */}
          {client && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[--text-muted] mb-2">Connect</p>
              <div className="flex gap-1 mb-2">
                {client.snippets.map((s, i) => (
                  <button
                    key={s.lang}
                    onClick={() => setActiveLang(i)}
                    className={`text-[11px] px-2.5 py-1 rounded-[--radius-sm] border transition-colors ${
                      activeLang === i
                        ? 'border-[--border-strong] bg-[--bg-raised] text-[--text-primary]'
                        : 'border-[--border] bg-transparent text-[--text-muted] hover:text-[--text-secondary]'
                    }`}
                  >
                    {s.lang}
                  </button>
                ))}
              </div>
              <div className="relative">
                <pre className="bg-[--bg-raised] border border-[--border] rounded-[--radius-sm] px-4 py-3 text-xs text-[--text-secondary] font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  {client.snippets[activeLang].code(host || 'HOST', port || client.port, db.name)}
                </pre>
                <button
                  onClick={() => copy(client.snippets[activeLang].code(host || 'HOST', port || client.port, db.name), 'snippet')}
                  className="absolute top-2 right-2 text-[10px] text-[--text-muted] hover:text-[--text-secondary] transition-colors px-1.5 py-0.5 border border-[--border] rounded bg-[--bg-raised]"
                >
                  {copied === 'snippet' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function buildClientUrl(engine: string, host: string, port: number, name: string): string {
  switch (engine) {
    case 'postgres':      return `postgresql://capsuleadmin:***@${host}:${port}/${name}`
    case 'mysql':
    case 'mariadb':       return `mysql://capsuleadmin:***@${host}:${port}/${name}`
    case 'redis':         return `redis://:***@${host}:${port}`
    case 'mongodb':       return `mongodb://capsuleadmin:***@${host}:${port}/${name}`
    case 'cassandra':     return `cassandra://${host}:${port}`
    case 'clickhouse':    return `http://capsuleadmin:***@${host}:${port}/${name}`
    case 'elasticsearch': return `http://capsuleadmin:***@${host}:${port}`
    case 'cockroachdb':   return `postgresql://capsuleadmin:***@${host}:${port}/${name}?sslmode=disable`
    default:              return `${engine}://${host}:${port}/${name}`
  }
}
