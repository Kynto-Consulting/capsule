// Pruebas de reglas/injection.yml. Formato semgrep --test: "ruleid" = debe marcar la linea siguiente, "ok" = no debe.
import { exec, execSync } from "child_process";

declare const prisma: any;
declare const Prisma: any;
declare function assertSafeUrl(u: string): string;
declare function shellEscape(s: string): string;

export async function sql(req: any, id: string) {
  // ruleid: tumi-prisma-raw-unsafe
  await prisma.$queryRawUnsafe("SELECT * FROM users WHERE id = " + id);
  // ruleid: tumi-prisma-raw-unsafe
  await prisma.$executeRawUnsafe(`DELETE FROM t WHERE id = ${id}`);
  // ok: tumi-prisma-raw-unsafe
  await prisma.$queryRawUnsafe("SELECT 1");
  // ruleid: tumi-prisma-raw-template-call
  await prisma.$queryRaw(`SELECT * FROM users WHERE id = ${id}`);
  // ok: tumi-prisma-raw-template-call
  await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;
}

export function dyn(x: string) {
  // ruleid: tumi-eval-dynamic
  eval(x);
  // ruleid: tumi-eval-dynamic
  const f = new Function("a", x);
  // ok: tumi-eval-dynamic
  eval("1 + 1");
}

export function cmd(req: any) {
  // ruleid: tumi-child-process-exec-tainted
  exec("convert " + req.query.file);
  // ruleid: tumi-child-process-exec-tainted
  execSync(req.body.cmd);
  // ok: tumi-child-process-exec-tainted
  exec("convert " + shellEscape(req.query.file));
  // ok: tumi-child-process-exec-tainted
  exec("ls -la");
}

export async function ssrf(req: any) {
  // ruleid: tumi-ssrf-fetch-tainted
  await fetch(req.query.url);
  // ruleid: tumi-ssrf-fetch-tainted
  await fetch(req.body.target, { method: "GET" });
  // ok: tumi-ssrf-fetch-tainted
  await fetch(assertSafeUrl(req.query.url));
  // ok: tumi-ssrf-fetch-tainted
  await fetch("https://api.example.com/health");
}
