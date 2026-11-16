const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const pool = require('../db/pool');
const config = require('../config');
const { findSession } = require('../middleware/whitelistCheck');

// ── Helpers ─────────────────────────────────────────────────

async function getAuthUser(req) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) return null;
  const session = await findSession(deviceToken);
  if (!session) return null;
  return session;
}

// Relative, same-origin (see routes/photos.js buildUrls for why).
function buildPhotoUrls(photoId) {
  return {
    thumb: `/api/photos/${photoId}/file/thumb`,
    preview: `/api/photos/${photoId}/file/prev`,
    original: `/api/photos/${photoId}/file/orig`,
  };
}

function makeCoverUrl(photoId) {
  if (!photoId) return null;
  return `/api/photos/${photoId}/file/thumb`;
}

// ── GET /api/albums ───────────────────────────────────────────
// List all albums for the authenticated user, with photo count and cover

router.get('/', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      `SELECT
          a.id, a.name, a.description, a.cover_photo_id, a.is_shared,
          a.collection_id, a.created_at, a.updated_at,
          COUNT(ap.photo_id)::int AS photo_count
       FROM albums a
       LEFT JOIN album_photos ap ON ap.album_id = a.id
       WHERE a.owner_id = $1
       GROUP BY a.id
       ORDER BY a.updated_at DESC, a.created_at DESC`,
      [auth.user_id]
    );

    // Build cover URLs for albums that have a cover_photo_id
    const albums = await Promise.all(result.rows.map(async (album) => {
      let coverUrl = null;
      if (album.cover_photo_id) {
        coverUrl = buildPhotoUrls(album.cover_photo_id, req).thumb;
      } else if (album.photo_count > 0) {
        // No explicit cover — grab the most recent photo in this album
        const coverResult = await pool.query(
          `SELECT photo_id FROM album_photos
           WHERE album_id = $1
           ORDER BY added_at DESC LIMIT 1`,
          [album.id]
        );
        if (coverResult.rows.length > 0) {
          coverUrl = buildPhotoUrls(coverResult.rows[0].photo_id, req).thumb;
        }
      }
      return { ...album, cover_url: coverUrl };
    }));

    res.json({ albums });
  } catch (error) {
    console.error('[Albums] List error:', error);
    res.status(500).json({ error: 'Failed to list albums' });
  }
});

// ── POST /api/albums ───────────────────────────────────────────
// Create a new album

router.post('/', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Album name is required' });
    }

    const result = await pool.query(
      `INSERT INTO albums (name, description, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, cover_photo_id, is_shared, created_at, updated_at`,
      [name.trim(), description || null, auth.user_id]
    );

    const album = result.rows[0];
    console.log(`[Albums] Created: "${album.name}" by user ${auth.user_id}`);

    res.status(201).json({ success: true, album: { ...album, photo_count: 0, cover_url: null } });
  } catch (error) {
    console.error('[Albums] Create error:', error);
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// ── GET /api/album-collections ──────────────────────────────────
// List user's collections ordered by creation date

router.get('/collections', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      `SELECT ac.id, ac.name, ac.created_at, ac.updated_at,
              COUNT(a.id)::int AS album_count
       FROM album_collections ac
       LEFT JOIN albums a ON a.collection_id = ac.id
       WHERE ac.owner_id = $1
       GROUP BY ac.id
       ORDER BY ac.created_at DESC`,
      [auth.user_id]
    );

    res.json({ collections: result.rows });
  } catch (error) {
    console.error('[Collections] List error:', error);
    res.status(500).json({ error: 'Failed to list collections' });
  }
});

// ── POST /api/album-collections ─────────────────────────────────
// Create a new album collection

router.post('/collections', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const result = await pool.query(
      `INSERT INTO album_collections (name, owner_id)
       VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`,
      [name.trim(), auth.user_id]
    );

    const collection = result.rows[0];
    console.log(`[Collections] Created: "${collection.name}"`);

    res.status(201).json({ success: true, collection: { ...collection, album_count: 0 } });
  } catch (error) {
    console.error('[Collections] Create error:', error);
    res.status(500).json({ error: 'Failed to create collection' });
  }
});

// ── DELETE /api/album-collections/:id ───────────────────────────
// Delete a collection (albums' collection_id set to null via ON DELETE SET NULL)

router.delete('/collections/:id', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      'SELECT id, owner_id, name FROM album_collections WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    if (result.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM album_collections WHERE id = $1', [req.params.id]);
    console.log(`[Collections] Deleted: "${result.rows[0].name}"`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Collections] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// ── POST /api/albums/batch-info ──────────────────────────────────
// Returns album membership info for a set of photo IDs
// Body: { photo_ids: [...] }
// Returns: [{ album with .photos_in_album: [matched photo ids] }]

router.post('/batch-info', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { photo_ids } = req.body;
    if (!photo_ids || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids array is required' });
    }

    // Get all user's albums with cover + count
    const albumsResult = await pool.query(
      `SELECT
          a.id, a.name, a.description, a.cover_photo_id, a.is_shared,
          a.collection_id, a.created_at, a.updated_at,
          COUNT(ap.photo_id)::int AS photo_count
       FROM albums a
       LEFT JOIN album_photos ap ON ap.album_id = a.id
       WHERE a.owner_id = $1
       GROUP BY a.id
       ORDER BY a.updated_at DESC, a.created_at DESC`,
      [auth.user_id]
    );

    // For each album, check which of the requested photo_ids are inside
    const albumPhotosResult = await pool.query(
      `SELECT album_id, photo_id FROM album_photos
       WHERE album_id = ANY($1::uuid[]) AND photo_id = ANY($2::uuid[])`,
      [albumsResult.rows.map(a => a.id), photo_ids]
    );

    // Build a map: album_id → Set of photo_ids
    const membership = {};
    for (const row of albumPhotosResult.rows) {
      if (!membership[row.album_id]) membership[row.album_id] = new Set();
      membership[row.album_id].add(row.photo_id);
    }

    // Build cover URLs and attach membership info
    const albums = await Promise.all(albumsResult.rows.map(async (album) => {
      let coverUrl = null;
      if (album.cover_photo_id) {
        coverUrl = makeCoverUrl(album.cover_photo_id, req);
      } else if (album.photo_count > 0) {
        const coverResult = await pool.query(
          `SELECT photo_id FROM album_photos
           WHERE album_id = $1
           ORDER BY added_at DESC LIMIT 1`,
          [album.id]
        );
        if (coverResult.rows.length > 0) {
          coverUrl = makeCoverUrl(coverResult.rows[0].photo_id, req);
        }
      }
      const photosInAlbum = membership[album.id] ? Array.from(membership[album.id]) : [];
      return { ...album, cover_url: coverUrl, photos_in_album: photosInAlbum };
    }));

    res.json({ albums });
  } catch (error) {
    console.error('[Albums] Batch info error:', error);
    res.status(500).json({ error: 'Failed to get album info' });
  }
});

// ── PUT /api/albums/:id/photos ─────────────────────────────────
// Add photos to an album

router.put('/:id/photos', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { photo_ids } = req.body;
    if (!photo_ids || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids array is required' });
    }

    // Verify album ownership
    const albumResult = await pool.query(
      'SELECT id, name, owner_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized to modify this album' });
    }

    // Verify all photos belong to this user
    const photosResult = await pool.query(
      'SELECT id FROM photos WHERE id = ANY($1::uuid[]) AND user_id = $2',
      [photo_ids, auth.user_id]
    );
    if (photosResult.rows.length === 0) {
      return res.status(404).json({ error: 'No valid photos found' });
    }

    const validIds = photosResult.rows.map(r => r.id);

    // Insert into junction table, skipping duplicates (ON CONFLICT DO NOTHING)
    const values = validIds.map(id => `('${req.params.id}'::uuid, '${id}'::uuid)`).join(',');
    await pool.query(
      `INSERT INTO album_photos (album_id, photo_id)
       SELECT * FROM (VALUES ${values}) AS v(a, p)
       WHERE NOT EXISTS (
         SELECT 1 FROM album_photos ap WHERE ap.album_id = v.a AND ap.photo_id = v.p
       )`
    );

    // Update album's updated_at timestamp
    await pool.query(
      'UPDATE albums SET updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    // Get updated count
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS photo_count FROM album_photos WHERE album_id = $1',
      [req.params.id]
    );

    console.log(`[Albums] Added ${validIds.length} photos to "${albumResult.rows[0].name}"`);

    res.json({
      success: true,
      added: validIds.length,
      photo_count: countResult.rows[0].photo_count,
    });
  } catch (error) {
    console.error('[Albums] Add photos error:', error);
    res.status(500).json({ error: 'Failed to add photos to album' });
  }
});

// ── PUT /api/albums/:id ───────────────────────────────────────
// Update album metadata (name, description, etc.)

router.put('/:id', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { name, collection_id, cover_photo_id } = req.body;

    // Build dynamic SET clause — only update fields that were sent
    const sets = [];
    const params = [];
    let paramIdx = 1;

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Album name is required' });
      }
      sets.push(`name = $${paramIdx++}`);
      params.push(name.trim());
    }

    if (req.body.hasOwnProperty('collection_id')) {
      sets.push(`collection_id = $${paramIdx++}`);
      params.push(collection_id || null);
    }

    if (req.body.hasOwnProperty('cover_photo_id')) {
      sets.push(`cover_photo_id = $${paramIdx++}`);
      params.push(cover_photo_id || null);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Get old collection_id before updating (for auto-delete check)
    const oldResult = await pool.query(
      'SELECT collection_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    const oldCollectionId = oldResult.rows[0]?.collection_id;

    // Verify ownership
    const albumResult = await pool.query(
      'SELECT id, owner_id, name FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE albums SET ${sets.join(', ')}
       WHERE id = $${paramIdx}
       RETURNING id, name, description, cover_photo_id, is_shared, collection_id, created_at, updated_at`,
      params
    );

    const album = result.rows[0];

    // Auto-delete old collection if it's now empty and different from the new one
    const newCollectionId = album.collection_id;
    if (oldCollectionId && oldCollectionId !== newCollectionId) {
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM albums WHERE collection_id = $1',
        [oldCollectionId]
      );
      if (countResult.rows[0].cnt === 0) {
        await pool.query('DELETE FROM album_collections WHERE id = $1', [oldCollectionId]);
        console.log(`[Collections] Auto-deleted empty collection ${oldCollectionId}`);
      }
    }

    console.log(`[Albums] Updated: "${albumResult.rows[0].name}" → "${album.name}"`);

    res.json({ success: true, album });
  } catch (error) {
    console.error('[Albums] Update error:', error);
    res.status(500).json({ error: 'Failed to update album' });
  }
});

// ── DELETE /api/albums/:id/photos ──────────────────────────────
// Batch remove photos from an album

router.delete('/:id/photos', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { photo_ids } = req.body;
    if (!photo_ids || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids array is required' });
    }

    // Verify album ownership
    const albumResult = await pool.query(
      'SELECT id, owner_id, name FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await pool.query(
      'DELETE FROM album_photos WHERE album_id = $1 AND photo_id = ANY($2::uuid[])',
      [req.params.id, photo_ids]
    );

    // Update timestamp
    await pool.query(
      'UPDATE albums SET updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    console.log(`[Albums] Removed ${result.rowCount} photos from "${albumResult.rows[0].name}"`);

    res.json({ success: true, removed: result.rowCount });
  } catch (error) {
    console.error('[Albums] Batch remove photos error:', error);
    res.status(500).json({ error: 'Failed to remove photos from album' });
  }
});

// ── DELETE /api/albums/:id/photos/:photoId ─────────────────────
// Remove a photo from an album

router.delete('/:id/photos/:photoId', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Verify album ownership
    const albumResult = await pool.query(
      'SELECT id, owner_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query(
      'DELETE FROM album_photos WHERE album_id = $1 AND photo_id = $2',
      [req.params.id, req.params.photoId]
    );

    // Update timestamp
    await pool.query(
      'UPDATE albums SET updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Remove photo error:', error);
    res.status(500).json({ error: 'Failed to remove photo from album' });
  }
});

// ── GET /api/albums/shared-with-me ───────────────────────────
// List albums shared with the current user, grouped by owner
// NOTE: Must be before /:id/* routes to avoid Express matching 'shared-with-me' as :id

router.get('/shared-with-me', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      `SELECT aus.id AS share_id, aus.album_id, aus.owner_id, aus.created_at AS shared_at,
              a.name, a.description, a.cover_photo_id, a.created_at, a.updated_at,
              u.username AS owner_username, u.display_name AS owner_display_name,
              COUNT(ap.photo_id)::int AS photo_count,
              COALESCE(a.cover_photo_id, fp.first_photo_id) AS effective_cover_id
       FROM album_user_share aus
       JOIN albums a ON a.id = aus.album_id
       JOIN users u ON u.id = aus.owner_id
       LEFT JOIN album_photos ap ON ap.album_id = a.id
       LEFT JOIN LATERAL (
         SELECT ap2.photo_id AS first_photo_id
         FROM album_photos ap2
         WHERE ap2.album_id = a.id
         ORDER BY ap2.added_at
         LIMIT 1
       ) fp ON true
       WHERE aus.shared_with_user_id = $1
       GROUP BY aus.id, aus.album_id, aus.owner_id, aus.created_at,
                a.name, a.description, a.cover_photo_id, a.created_at, a.updated_at,
                u.username, u.display_name, fp.first_photo_id
       ORDER BY aus.created_at DESC`,
      [auth.user_id]
    );

    // Build cover URLs and group by owner
    const grouped = {};
    for (const row of result.rows) {
      let coverUrl = null;
      if (row.effective_cover_id) {
        coverUrl = makeCoverUrl(row.effective_cover_id, req);
      }
      const album = {
        share_id: row.share_id,
        id: row.album_id,
        name: row.name,
        description: row.description,
        cover_url: coverUrl,
        photo_count: row.photo_count,
        shared_at: row.shared_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const ownerKey = row.owner_id;
      if (!grouped[ownerKey]) {
        grouped[ownerKey] = {
          owner: {
            id: row.owner_id,
            username: row.owner_username,
            display_name: row.owner_display_name,
          },
          albums: [],
        };
      }
      grouped[ownerKey].albums.push(album);
    }

    const groups = Object.values(grouped);
    res.json({ groups });
  } catch (error) {
    console.error('[Albums] Shared-with-me error:', error);
    res.status(500).json({ error: 'Failed to load shared albums' });
  }
});

// ── DELETE /api/albums/shared-with-me/:shareId ──────────────
// Current user removes a shared album from their list

router.delete('/shared-with-me/:shareId', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Only the recipient can remove it from their view
    const result = await pool.query(
      'DELETE FROM album_user_share WHERE id = $1 AND shared_with_user_id = $2 RETURNING id',
      [req.params.shareId, auth.user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Share not found or not authorized' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Remove shared album error:', error);
    res.status(500).json({ error: 'Failed to remove shared album' });
  }
});

// ── GET /api/albums/:id ────────────────────────────────────────
// Get a single album with its photos (paginated)
// Accessible by album owner OR users the album has been shared with

router.get('/:id', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Check direct ownership OR album_user_share access
    const albumResult = await pool.query(
      `SELECT a.id, a.name, a.description, a.cover_photo_id, a.is_shared, a.created_at, a.updated_at,
              a.owner_id
       FROM albums a
       WHERE a.id = $1 AND (
         a.owner_id = $2
         OR EXISTS (
           SELECT 1 FROM album_user_share aus
           WHERE aus.album_id = a.id AND aus.shared_with_user_id = $2
         )
       )`,
      [req.params.id, auth.user_id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const album = albumResult.rows[0];

    // Paginated album photos
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM album_photos WHERE album_id = $1',
      [req.params.id]
    );
    const total = countResult.rows[0].total;

    const photosResult = await pool.query(
      `SELECT p.id, p.original_filename, p.date_taken, p.mime_type,
              p.file_size, p.width, p.height, p.created_at, ap.added_at
       FROM photos p
       JOIN album_photos ap ON ap.photo_id = p.id
       WHERE ap.album_id = $1
       ORDER BY p.date_taken DESC, p.created_at DESC, p.id DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );

    const photos = photosResult.rows.map(p => ({
      ...p,
      urls: buildPhotoUrls(p.id, req),
    }));

    res.json({
      album: {
        ...album,
        photo_count: total,
        cover_url: album.cover_photo_id
          ? buildPhotoUrls(album.cover_photo_id, req).thumb
          : (offset === 0 && photos.length > 0 ? photos[0].urls.thumb : null),
      },
      photos,
      hasMore: offset + photos.length < total,
    });
  } catch (error) {
    console.error('[Albums] Get error:', error);
    res.status(500).json({ error: 'Failed to get album' });
  }
});

// ── GET /api/albums/:id/download-zip ────────────────────────────
// Download all photos in an album as a single zip

router.get('/:id/download-zip', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const albumResult = await pool.query(
      `SELECT a.id, a.name
       FROM albums a
       WHERE a.id = $1 AND (
         a.owner_id = $2
         OR EXISTS (
           SELECT 1 FROM album_user_share aus
           WHERE aus.album_id = a.id AND aus.shared_with_user_id = $2
         )
       )`,
      [req.params.id, auth.user_id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const album = albumResult.rows[0];

    const photosResult = await pool.query(
      'SELECT id, relative_path, original_filename FROM photos WHERE id IN (SELECT photo_id FROM album_photos WHERE album_id = $1)',
      [req.params.id]
    );

    if (photosResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album has no photos' });
    }

    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });

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
    console.error('[Albums] Download zip error:', error);
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

// ── POST /api/albums/:id/share-album ─────────────────────────────
// Generate a single share token for the entire album

router.post('/:id/share-album', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const albumResult = await pool.query(
      'SELECT id, owner_id, name FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const album = albumResult.rows[0];

    // Check if album already has an active share token
    const existing = await pool.query(
      'SELECT token FROM album_share_tokens WHERE album_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())',
      [req.params.id]
    );
    if (existing.rows.length > 0) {
      const token = existing.rows[0].token;
      return res.json({ success: true, url: `/share/album/${token}`, token, album_name: album.name });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO album_share_tokens (album_id, token, created_by) VALUES ($1, $2, $3)',
      [req.params.id, token, auth.user_id]
    );

    console.log(`[Albums] Shared album "${album.name}"`);

    res.json({ success: true, url: `/share/album/${token}`, token, album_name: album.name });
  } catch (error) {
    console.error('[Albums] Share album error:', error);
    res.status(500).json({ error: 'Failed to share album' });
  }
});

// ── DELETE /api/albums/:id/share-album ───────────────────────────
// Revoke the album share token

router.delete('/:id/share-album', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const albumResult = await pool.query(
      'SELECT id, owner_id, name FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query(
      "UPDATE album_share_tokens SET is_active = false WHERE album_id = $1 AND created_by = $2",
      [req.params.id, auth.user_id]
    );

    console.log(`[Albums] Share revoked for "${albumResult.rows[0].name}"`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Revoke share error:', error);
    res.status(500).json({ error: 'Failed to revoke album share' });
  }
});

// ── POST /api/albums/:id/share-user ──────────────────────────
// Share album with an internal user (adds to album_user_share)

router.post('/:id/share-user', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // Verify album ownership
    const album = await pool.query(
      'SELECT id, owner_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (album.rows.length === 0) return res.status(404).json({ error: 'Album not found' });
    if (album.rows[0].owner_id !== auth.user_id) return res.status(403).json({ error: 'Not authorized' });

    // Verify target user exists
    const user = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = true', [user_id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await pool.query(
      `INSERT INTO album_user_share (album_id, owner_id, shared_with_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (album_id, shared_with_user_id) DO NOTHING`,
      [req.params.id, auth.user_id, user_id]
    );

    console.log(`[Albums] Shared album with user ${user_id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Share-user error:', error);
    res.status(500).json({ error: 'Failed to share album with user' });
  }
});

// ── DELETE /api/albums/:id/share-user/:userId ────────────────
// Revoke user access to an album

router.delete('/:id/share-user/:userId', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Verify album ownership
    const album = await pool.query(
      'SELECT id, owner_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (album.rows.length === 0) return res.status(404).json({ error: 'Album not found' });
    if (album.rows[0].owner_id !== auth.user_id) return res.status(403).json({ error: 'Not authorized' });

    await pool.query(
      'DELETE FROM album_user_share WHERE album_id = $1 AND shared_with_user_id = $2',
      [req.params.id, req.params.userId]
    );

    console.log(`[Albums] Revoked user ${req.params.userId} access to album ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Revoke user share error:', error);
    res.status(500).json({ error: 'Failed to revoke user access' });
  }
});

// ── GET /api/albums/:id/shared-users ─────────────────────────
// List all users this album is shared with

router.get('/:id/shared-users', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Must be the album owner to see shared users
    const album = await pool.query(
      'SELECT id, owner_id FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (album.rows.length === 0) return res.status(404).json({ error: 'Album not found' });
    if (album.rows[0].owner_id !== auth.user_id) return res.status(403).json({ error: 'Not authorized' });

    const result = await pool.query(
      `SELECT aus.id AS share_id, aus.shared_with_user_id AS user_id,
              u.username, u.display_name, aus.created_at AS granted_at
       FROM album_user_share aus
       JOIN users u ON u.id = aus.shared_with_user_id
       WHERE aus.album_id = $1
       ORDER BY aus.created_at DESC`,
      [req.params.id]
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('[Albums] List shared users error:', error);
    res.status(500).json({ error: 'Failed to list shared users' });
  }
});

// ── DELETE /api/albums/:id ─────────────────────────────────────
// Delete an album (photos remain, junction rows cascade)

router.delete('/:id', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const albumResult = await pool.query(
      'SELECT id, owner_id, name FROM albums WHERE id = $1',
      [req.params.id]
    );
    if (albumResult.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }
    if (albumResult.rows[0].owner_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM albums WHERE id = $1', [req.params.id]);
    console.log(`[Albums] Deleted: "${albumResult.rows[0].name}"`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Albums] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete album' });
  }
});

module.exports = router;
