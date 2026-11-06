// Función `migrar` de vega-prod: lista los archivos del servidor del estudio (dentro del túnel), pregunta a la app cuáles ya
// conoce, sube solo los faltantes en partes de 8 MiB y cierra cada archivo. La app no cambia: sigue el mismo protocolo
// (lista -> conocidos -> partes de 8 MiB -> cierre) con un token de corta vida y alcance `api:importacion`.
//
//   capsule fn deploy migrar --image registry/migrar:1 --vpn estudio --cron "0 2 * * *" --memory 512m --timeout 2h \
//       --scope api:importacion
import { defineFunction } from "@kyntocg/capsule-fn";

const ORIGEN = "http://10.48.0.20:8080"; // servidor de archivos del estudio, dentro de 10.48.0.0/24

export default defineFunction(async (ctx) => {
  const lista = JSON.parse(await (await ctx.vpn.http(`${ORIGEN}/archivos.json`)).text()) as { ruta: string; size: number }[];

  // conocidos: lo que la app ya tiene
  const conocidos = new Set<string>(
    await (await ctx.api.fetch("/importacion/conocidos", { method: "POST", body: JSON.stringify(lista.map((a) => a.ruta)), headers: { "content-type": "application/json" } })).json(),
  );

  let subidos = 0;
  for (const a of lista) {
    if (conocidos.has(a.ruta)) continue;
    const origen = await ctx.vpn.http(`${ORIGEN}/${encodeURI(a.ruta)}`);
    const base = `/importacion/archivos/${encodeURIComponent(a.ruta)}`;
    await ctx.api.upload({
      source: origen.body, // se corta en partes de 8 MiB sin cargar el archivo entero en memoria
      init: async () => ({ known: await (await ctx.api.fetch(`${base}/partes`)).json() }),
      putPart: async (i, bytes) => {
        const r = await ctx.api.fetch(`${base}/partes/${i}`, { method: "PUT", body: bytes });
        if (!r.ok) throw new Error(`parte ${i}: ${r.status}`);
      },
      close: async (info) => {
        const r = await ctx.api.fetch(`${base}/cierre`, { method: "POST", body: JSON.stringify(info), headers: { "content-type": "application/json" } });
        if (!r.ok) throw new Error(`cierre: ${r.status}`);
      },
    });
    subidos++;
    ctx.log.info(`subido ${a.ruta}`);
  }
  return { total: lista.length, subidos, omitidos: lista.length - subidos };
});
