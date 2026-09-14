#!/usr/bin/env node
/* Genera el póster que falta de los videos ya subidos.
 *
 * Desde ahora el póster se crea solo al subir un video (ver
 * generarPosterVideo en server.js), pero los que ya estaban quedaron con
 * video_thumb_url en null y su miniatura en la galería se ve como un recuadro
 * gris. Este script los completa.
 *
 * Uso:
 *   node scripts/video-posters.js          genera los que faltan
 *   node scripts/video-posters.js --dry    sólo dice qué haría
 *   node scripts/video-posters.js --force  regenera también los que ya tienen
 *
 * Es idempotente: correrlo dos veces no cambia nada.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..', 'uploads', 'videos');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

function poster(rutaVideo) {
  return new Promise(resolve => {
    const salida = rutaVideo.replace(/\.[^.]+$/, '') + '.jpg';
    const args = ['-loglevel', 'error', '-ss', '0.5', '-i', rutaVideo,
                  '-vf', 'thumbnail,scale=640:-2', '-frames:v', '1',
                  '-q:v', '4', '-y', salida];
    let listo = false;
    const fin = ok => { if (listo) return; listo = true; resolve(ok ? salida : null); };
    try {
      const p = spawn('ffmpeg', args, { stdio: 'ignore' });
      const reloj = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} fin(false); }, 20000);
      p.on('error', () => { clearTimeout(reloj); fin(false); });
      p.on('close', c => {
        clearTimeout(reloj);
        fin(c === 0 && fs.existsSync(salida) && fs.statSync(salida).size > 0);
      });
    } catch (e) { fin(false); }
  });
}

(async () => {
  if (!fs.existsSync(DIR)) { console.log('No hay carpeta de videos: ' + DIR); return; }
  const videos = fs.readdirSync(DIR).filter(f => /\.(mp4|webm|mov)$/i.test(f));
  if (!videos.length) { console.log('No hay videos subidos.'); return; }

  console.log(`${videos.length} video(s) en ${DIR}\n`);
  let hechos = 0, saltados = 0, fallados = 0;

  for (const v of videos) {
    const ruta = path.join(DIR, v);
    const jpg  = ruta.replace(/\.[^.]+$/, '') + '.jpg';
    if (fs.existsSync(jpg) && !FORCE) {
      console.log(`  =  ${v}  (ya tiene póster)`);
      saltados++;
      continue;
    }
    if (DRY) { console.log(`  +  ${v}  → ${path.basename(jpg)}`); hechos++; continue; }
    const r = await poster(ruta);
    if (r) {
      const kb = Math.round(fs.statSync(r).size / 1024);
      console.log(`  ✓  ${v}  → ${path.basename(r)} (${kb} KB)`);
      hechos++;
    } else {
      console.log(`  ✗  ${v}  — ffmpeg no pudo sacar un cuadro`);
      fallados++;
    }
  }

  console.log(`\n${hechos} generado(s) · ${saltados} ya tenían · ${fallados} con error${DRY ? '  (simulacro)' : ''}`);
  if (DRY) return;

  /* Generar el .jpg no alcanza: la ficha lee video_thumb_url del override, así
     que hay que apuntarlo. Se hace acá mismo para que no queden pósters en el
     disco que después nadie usa. */
  let db;
  try { db = require('../db/queries'); }
  catch (e) { console.log('\n(no se pudo abrir la base: ' + e.message + ')'); return; }

  let vinculados = 0;
  try {
    const overrides = await db.getAllProductOverrides();
    for (const [id, ov] of Object.entries(overrides || {})) {
      if (ov.video_fuente !== 'upload' || !ov.video_url) continue;
      const esperado = ov.video_url.replace(/\.[^.]+$/, '') + '.jpg';
      const enDisco  = path.join(__dirname, '..', esperado.replace(/^\//, ''));
      if (!fs.existsSync(enDisco)) continue;
      if (ov.video_thumb_url === esperado && !FORCE) continue;
      await db.setProductOverride(id, { video_thumb_url: esperado });
      console.log(`  → ${id}  video_thumb_url = ${esperado}`);
      vinculados++;
    }
  } catch (e) {
    console.log('\nError al vincular: ' + e.message);
  }
  console.log(`${vinculados} producto(s) vinculados a su póster.`);
  if (vinculados) console.log('Reiniciá el server para que la tienda lo tome.');
  process.exit(0);
})();
