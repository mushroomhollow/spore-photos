const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const pool = require('../db/pool');
const config = require('../config');

// ── Helpers ────────────────────────────────────────────────

// Relative, same-origin. The share HTML is served from the same host that
// proxies /api/share/, so relative paths resolve correctly on every domain.
function buildPhotoUrls(photoId) {
  return {
    thumb: `/api/share/photo/${photoId}/file/thumb`,
    prev: `/api/share/photo/${photoId}/file/prev`,
    original: `/api/share/photo/${photoId}/file/orig`,
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try { return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return dateStr; }
}

// ── GET /api/share/:token — Public JSON: single photo ──────

router.get('/api/share/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.original_filename, p.date_taken, p.mime_type,
              p.file_size, p.width, p.height, p.description, p.created_at,
              st.token, st.created_by, st.created_at AS shared_at
       FROM share_tokens st
       JOIN photos p ON p.id = st.photo_id
       WHERE st.token = $1 AND st.is_active = true
         AND (st.expires_at IS NULL OR st.expires_at > NOW())`,
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Share link not found or expired' });
    }
    const photo = result.rows[0];
    res.json({ success: true, photo: { ...photo, urls: buildPhotoUrls(photo.id, req) } });
  } catch (error) {
    console.error('[PublicShare] Get photo error:', error);
    res.status(500).json({ error: 'Failed to get share info' });
  }
});

// ── GET /api/share/photo/:id/file/:type — Serve shared photo file ──

router.get('/api/share/photo/:id/file/:type', async (req, res) => {
  try {
    const { id, type } = req.params;
    if (!['thumb', 'prev', 'orig'].includes(type)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Verify photo is shared via share_tokens or album_share_tokens
    const accessCheck = await pool.query(
      `SELECT 1 FROM share_tokens WHERE photo_id = $1 AND is_active = true
       UNION
       SELECT 1 FROM album_share_tokens ast
       JOIN album_photos ap ON ap.album_id = ast.album_id
       WHERE ap.photo_id = $1 AND ast.is_active = true`,
      [id]
    );
    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found or not shared' });
    }

    const photo = await pool.query(
      'SELECT relative_path, mime_type FROM photos WHERE id = $1', [id]
    );
    if (photo.rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const { relative_path, mime_type } = photo.rows[0];
    const photoDir = path.dirname(relative_path);
    const basename = path.basename(relative_path, path.extname(relative_path));

    let filePath;
    if (type === 'orig') {
      filePath = path.join(config.picturesRoot, relative_path);
    } else {
      const suffix = type === 'thumb' ? '_thumb' : '_prev';
      const baseClean = basename.replace('_orig', '');
      filePath = path.join(config.picturesRoot, photoDir, `${baseClean}${suffix}.jpg`);
    }

    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4',
      '.mov': 'video/quicktime', '.heic': 'image/heic', '.heif': 'image/heif',
      '.avif': 'image/avif',
    };
    res.type(mimeMap[ext] || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (error) {
    console.error('[PublicShare] Serve photo file error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// ── GET /api/share/album/:token — Public JSON: album + photos ──

router.get('/api/share/album/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, a.description, a.created_at,
              ast.token, ast.created_by
       FROM album_share_tokens ast
       JOIN albums a ON a.id = ast.album_id
       WHERE ast.token = $1 AND ast.is_active = true
         AND (ast.expires_at IS NULL OR ast.expires_at > NOW())`,
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album share link not found or expired' });
    }

    const album = result.rows[0];
    const albumId = album.id;

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM album_photos WHERE album_id = $1', [albumId]
    );
    const total = countResult.rows[0].total;

    const photosResult = await pool.query(
      `SELECT p.id, p.original_filename, p.date_taken, p.mime_type,
              p.file_size, p.width, p.height, p.created_at
       FROM photos p
       JOIN album_photos ap ON ap.photo_id = p.id
       WHERE ap.album_id = $1
       ORDER BY p.date_taken DESC, p.created_at DESC, p.id DESC`,
      [albumId]
    );

    const photos = photosResult.rows.map(p => ({ ...p, urls: buildPhotoUrls(p.id, req) }));

    const ownerResult = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1', [album.created_by]
    );

    res.json({
      success: true,
      album: {
        ...album,
        photo_count: total,
        owner: ownerResult.rows[0] || { username: 'unknown', display_name: 'Unknown' },
      },
      photos,
    });
  } catch (error) {
    console.error('[PublicShare] Get album error:', error);
    res.status(500).json({ error: 'Failed to get album share info' });
  }
});

// ── GET /api/share/album/:token/download-zip — Download all photos as zip ──

router.get('/api/share/album/:token/download-zip', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name
       FROM album_share_tokens ast
       JOIN albums a ON a.id = ast.album_id
       WHERE ast.token = $1 AND ast.is_active = true
         AND (ast.expires_at IS NULL OR ast.expires_at > NOW())`,
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album share link not found or expired' });
    }

    const album = result.rows[0];
    const photosResult = await pool.query(
      'SELECT id, relative_path, original_filename FROM photos WHERE id IN (SELECT photo_id FROM album_photos WHERE album_id = $1)',
      [album.id]
    );
    if (photosResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album has no photos' });
    }

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });
    const safeName = album.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="album-${safeName}-${photosResult.rows.length}photos.zip"`);

    archive.pipe(res);
    for (const photo of photosResult.rows) {
      const filePath = path.join(config.picturesRoot, photo.relative_path);
      if (await fs.pathExists(filePath)) {
        archive.file(filePath, { name: photo.original_filename });
      }
    }
    await archive.finalize();
  } catch (error) {
    console.error('[PublicShare] Download zip error:', error);
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

// ── GET /share/:token — Public HTML: single photo ──────────

router.get('/share/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.original_filename, p.date_taken, p.mime_type,
              p.file_size, p.width, p.height, p.description
       FROM share_tokens st
       JOIN photos p ON p.id = st.photo_id
       WHERE st.token = $1 AND st.is_active = true
         AND (st.expires_at IS NULL OR st.expires_at > NOW())`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).send(notFoundPage());

    const photo = result.rows[0];
    const isVideo = photo.mime_type && photo.mime_type.startsWith('video/');

    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Shared Photo — Spore-Photos</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fbfedf;min-height:100vh;display:flex;flex-direction:column}
header{background:#066176;color:#ead4ab;padding:12px 20px;display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600}
header a{color:#93d2bd;text-decoration:none}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
.photo-card{background:#ead4ab;border:2px solid #93d2bd;border-radius:16px;overflow:hidden;max-width:90vw;max-height:85vh;box-shadow:0 8px 32px rgba(0,0,0,0.12)}
.photo-card img,.photo-card video{display:block;max-width:100%;max-height:75vh;object-fit:contain}
.photo-info{padding:16px 20px}
.photo-info h2{color:#066176;font-size:16px;font-weight:700;margin-bottom:4px;word-break:break-all}
.photo-info p{color:#099396;font-size:13px}
.footer{text-align:center;padding:16px;color:#099396;font-size:12px}
.video-badge{position:absolute;top:12px;right:12px;background:#f3702a;color:#fbfedf;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;text-transform:uppercase}
.photo-wrapper{position:relative;display:inline-block}
</style></head>
<body>
<header><span style="color:#93d2bd;font-weight:600;font-size:13px">Spore-Photos</span><span style="color:#099396;margin-left:auto">Shared Photo</span></header>
<main><div class="photo-card"><div class="photo-wrapper">
${isVideo ? `<video controls autoplay muted><source src="/api/share/photo/${photo.id}/file/orig" type="${escapeHtml(photo.mime_type)}"></video>` : `<img src="/api/share/photo/${photo.id}/file/orig" alt="${escapeHtml(photo.original_filename)}" loading="lazy">`}
</div><div class="photo-info"><h2>${escapeHtml(photo.original_filename)}</h2><p>${photo.width&&photo.height?`${photo.width}\u00d7${photo.height} \u00b7 `:''}${formatDate(photo.date_taken)}</p></div></div></main>
<div class="footer">Powered by Spore-Photos</div>
</body></html>`);
  } catch (error) {
    console.error('[PublicShareHTML] Photo error:', error);
    res.status(500).send(errorPage());
  }
});

// ── GET /share/album/:token — Public HTML: album view ──────

router.get('/share/album/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.name, a.description
       FROM album_share_tokens ast
       JOIN albums a ON a.id = ast.album_id
       WHERE ast.token = $1 AND ast.is_active = true
         AND (ast.expires_at IS NULL OR ast.expires_at > NOW())`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).send(notFoundPage());

    const album = result.rows[0];
    const photosResult = await pool.query(
      `SELECT p.id, p.original_filename, p.date_taken, p.mime_type, p.file_size, p.width, p.height
       FROM photos p JOIN album_photos ap ON ap.photo_id = p.id
       WHERE ap.album_id = $1
       ORDER BY p.date_taken DESC, p.created_at DESC, p.id DESC`,
      [album.id]
    );
    const photos = photosResult.rows;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(album.name)} — Shared Album</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fbfedf;min-height:100vh}
header{background:#066176;color:#ead4ab;padding:12px 20px;display:flex;align-items:center;gap:10px}
header h1{font-size:17px;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header a{color:#93d2bd;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap}
.subtitle{color:#099396;font-size:13px;margin-top:2px;padding:0 20px 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:12px 20px}
.photo-card{aspect-ratio:1;background:#ead4ab;border:2px solid #93d2bd;border-radius:12px;overflow:hidden;cursor:pointer;position:relative;transition:transform .15s,box-shadow .15s}
.photo-card:hover{transform:scale(1.02);box-shadow:0 4px 16px rgba(0,0,0,.15)}
.photo-card img{width:100%;height:100%;object-fit:cover;display:block}
.select-circle{position:absolute;top:6px;left:6px;width:24px;height:24px;border-radius:50%;border:2.5px solid rgba(255,255,255,.8);background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:all .15s;z-index:3;cursor:pointer}
.select-circle.selected{background:#f3702a;border-color:#f3702a}
.select-circle.selected::after{content:'\\2713';color:#fff;font-size:14px;font-weight:700;line-height:1}
.select-circle:not(.selected):hover{background:rgba(0,0,0,.55)}
.vid-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2}
.vid-play svg{width:44px;height:44px;background:rgba(0,0,0,.35);border-radius:50%;padding:12px;backdrop-filter:blur(4px);color:#fff}
.vid-badge{position:absolute;top:6px;right:6px;background:#f3702a;color:#fbfedf;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase;z-index:2;pointer-events:none}
.lightbox-overlay{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;padding:20px}
.lightbox-overlay.open{display:flex}
.lightbox-overlay img,.lightbox-overlay video{max-width:100%;max-height:90vh;border-radius:12px;object-fit:contain}
.lightbox-close{position:absolute;top:16px;right:20px;background:rgba(0,0,0,.5);color:#fff;border:none;font-size:28px;width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:101;line-height:1}
.lightbox-close:hover{background:rgba(0,0,0,.8)}
.empty{text-align:center;padding:60px 20px;color:#099396}
.empty svg{margin-bottom:12px}
.footer{text-align:center;padding:20px;color:#099396;font-size:12px}
/* Permanent Download All — always visible */
.top-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 20px}
.top-bar .btn-download-all{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;text-decoration:none;background:#099396;color:#fbfedf;transition:all .15s;white-space:nowrap}
.top-bar .btn-download-all:hover{background:#066176}
/* Selection toolbar — matches SPA SelectionToolbar exactly */
.sel-bar{display:none;align-items:center;justify-content:space-between;margin:0 20px;padding:8px 12px;background:#066176;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1)}
.sel-bar.visible{display:flex}
.sel-bar .sel-count{color:#ead4ab;font-size:13px;font-weight:600}
.sel-bar .sel-actions{display:flex;align-items:center;gap:6px}
.sel-bar button,.sel-bar a{padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .15s;white-space:nowrap}
.sel-bar button:disabled{opacity:.5;cursor:default}
.sel-bar .btn-download-sel{background:#099396;color:#fbfedf}
.sel-bar .btn-download-sel:hover{background:#066176}
.sel-bar .btn-close{padding:4px;border-radius:6px;background:transparent;color:rgba(251,254,223,.4)}
.sel-bar .btn-close:hover{color:#ead4ab;background:rgba(9,147,150,.15)}
@media(max-width:600px){.grid{grid-template-columns:repeat(2,1fr);gap:8px;padding:10px}}
</style></head>
<body>
<header><span style="color:#93d2bd;font-weight:600;font-size:13px">Spore-Photos</span><h1>${escapeHtml(album.name)}</h1></header>
${album.description?`<div class="subtitle" style="margin-top:10px">${escapeHtml(album.description)}</div>`:''}
<div class="subtitle">${photos.length} photo${photos.length!==1?'s':''}</div>

<!-- Permanent Download All — always visible -->
<div class="top-bar">
  <a class="btn-download-all" href="/api/share/album/${encodeURIComponent(req.params.token)}/download-zip">Download All</a>
</div>

<!-- Selection toolbar — matches SPA SelectionToolbar (navy bg, rounded, shadow) -->
<div id="selBar" class="sel-bar">
  <span id="selCount" class="sel-count">0 selected</span>
  <div class="sel-actions">
    <button id="downloadSelectedBtn" class="btn-download-sel" onclick="downloadSelected()" disabled>Download Selected</button>
    <button class="btn-close" onclick="clearSelection()" title="Clear selection">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</div>

${photos.length===0?`
<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#93d2bd" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><p>This album is empty.</p></div>`
:`<div class="grid" id="photoGrid">
${photos.map((p, idx)=>{
  const isV = p.mime_type && p.mime_type.startsWith('video/');
  const thumbUrl = `/api/share/photo/${p.id}/file/thumb`;
  return `<div class="photo-card" data-id="${p.id}" data-idx="${idx}" onclick="handlePhotoClick(event, ${idx}, '${p.id}')">
    <div class="select-circle" id="sel-${p.id}" onclick="event.stopPropagation();handleCircleClick(event, ${idx}, '${p.id}')"></div>
    ${isV ? `<div class="vid-badge">VIDEO</div><div class="vid-play"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg></div>` : ''}
    <img src="${thumbUrl}" alt="${escapeHtml(p.original_filename)}" loading="lazy"
      style="opacity:0;transition:opacity 0.25s ease-in-out"
      onload="this.style.opacity='1'"
      onerror="this.style.opacity='1';this.style.background='#ead4ab'">
  </div>`;
}).join('\n        ')}
</div>`}

<div id="lightbox" class="lightbox-overlay" onclick="closeLightbox(event)">
  <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
  <div id="lightboxContent"></div>
</div>

<div class="footer">Powered by Spore-Photos</div>

<script>
const selected=new Set();
const allPhotos=${JSON.stringify(photos.map(p=>({id:p.id,mimeType:p.mime_type})))};
const token=${JSON.stringify(req.params.token)};
let lastClickedIdx=-1;

function handlePhotoClick(e,idx,id){
  if(e.shiftKey){handleShiftClick(idx,id);return;}
  if(selected.size>0){toggleSelect(idx,id);return;}
  openLightbox(id,!!(allPhotos[idx]&&allPhotos[idx].mimeType&&allPhotos[idx].mimeType.startsWith('video/')));
}

function handleCircleClick(e,idx,id){
  e.stopPropagation();
  if(e.shiftKey){handleShiftClick(idx,id);return;}
  toggleSelect(idx,id);
}

function toggleSelect(idx,id){
  lastClickedIdx=idx;
  const el=document.getElementById('sel-'+id);
  if(selected.has(id)){selected.delete(id);el.classList.remove('selected')}
  else{selected.add(id);el.classList.add('selected')}
  updateToolbar();
}

function handleShiftClick(idx,id){
  if(lastClickedIdx<0){toggleSelect(idx,id);return;}
  const from=Math.min(lastClickedIdx,idx);
  const to=Math.max(lastClickedIdx,idx);
  for(let i=from;i<=to;i++){
    const pid=allPhotos[i].id;
    if(!selected.has(pid)){
      selected.add(pid);
      const el=document.getElementById('sel-'+pid);
      if(el)el.classList.add('selected');
    }
  }
  updateToolbar();
}

function clearSelection(){
  selected.clear();
  lastClickedIdx=-1;
  document.querySelectorAll('.select-circle.selected').forEach(el=>el.classList.remove('selected'));
  updateToolbar();
}

function updateToolbar(){
  const tb=document.getElementById('selBar');
  const count=selected.size;
  document.getElementById('selCount').textContent=count+' selected';
  document.getElementById('downloadSelectedBtn').disabled=count===0;
  if(count>0){tb.classList.add('visible')}else{tb.classList.remove('visible')}
}

function downloadSelected(){
  if(selected.size===0)return;
  const ids=Array.from(selected).join(',');
  window.location.href='/api/share/album/'+token+'/download-zip?ids='+ids;
}

function openLightbox(photoId,isVideo){
  const lb=document.getElementById('lightbox');
  const content=document.getElementById('lightboxContent');
  content.innerHTML='';
  if(isVideo){
    content.innerHTML='<video controls autoplay style="max-width:100%;max-height:90vh;border-radius:12px"><source src="/api/share/photo/'+photoId+'/file/orig"></video>';
  }else{
    content.innerHTML='<img src="/api/share/photo/'+photoId+'/file/orig" style="max-width:100%;max-height:90vh;border-radius:12px">';
  }
  lb.classList.add('open');
}

function closeLightbox(e){
  if(e&&e.target!==e.currentTarget)return;
  const lb=document.getElementById('lightbox');
  lb.classList.remove('open');
  const video=lb.querySelector('video');
  if(video){video.pause();video.src='';}
  document.getElementById('lightboxContent').innerHTML='';
}

document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeLightbox();
});
</script>
</body></html>`);
  } catch (error) {
    console.error('[PublicShareHTML] Album error:', error);
    res.status(500).send(errorPage());
  }
});

// ── Helper pages ────────────────────────────────────────────

function notFoundPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found — Spore-Photos</title>
<style>body{font-family:sans-serif;background:#fbfedf;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;color:#066176}
h1{font-size:24px;margin-bottom:8px}p{color:#099396}</style></head>
<body><h1>Link not found or expired</h1><p>This share link may have been revoked or expired.</p></body></html>`;
}

function errorPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error — Spore-Photos</title>
<style>body{font-family:sans-serif;background:#fbfedf;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;color:#066176}
h1{font-size:24px;margin-bottom:8px}p{color:#099396}</style></head>
<body><h1>Something went wrong</h1><p>Please try again later.</p></body></html>`;
}

module.exports = router;
