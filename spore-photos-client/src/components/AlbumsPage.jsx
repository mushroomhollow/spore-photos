import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, ArrowLeft, Loader2, Image, Trash2, X, Check,
  Download, Share2,
} from 'lucide-react';
import {
  fetchAlbums, fetchAlbum, deleteAlbum, deletePhoto, updateAlbum, removePhotoFromAlbum,
  fetchCollections, deleteCollection,
} from '../api/client';
import { deleteLocalByServerName, isNative, downloadPhoto } from '../backup/nativeFiles';
import PhotoGrid from './PhotoGrid';
import Lightbox from './Lightbox';
import SelectionToolbar from './SelectionToolbar';
import AlbumCard from './AlbumCard';
import DeleteConfirmModal from './DeleteConfirmModal';
import AlbumEditModal from './AlbumEditModal';
import AlbumPickerModal from './AlbumPickerModal';
import ShareModal from './ShareModal';
import { useGridSize } from '../hooks/useGridSize';

export default function AlbumsPage({ refreshTrigger }) {
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [activeAlbumId, setActiveAlbumId] = useState(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [removingPhoto, setRemovingPhoto] = useState(null); // single photo id
  const [deletingAlbumPhotos, setDeletingAlbumPhotos] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  // Share modal
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // Selection state for album detail view
  const [selectedAlbumPhotoIds, setSelectedAlbumPhotoIds] = useState(new Set());
  // Move to album modal
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  // Infinite scroll for album photos
  const [albumPhotos, setAlbumPhotos] = useState([]);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const [albumLoadingMore, setAlbumLoadingMore] = useState(false);
  const albumSentinelRef = useRef(null);
  const albumScrollRef = useRef(null);
  const albumLoadingMoreRef = useRef(false);
  const lastClickedIdxRef = useRef(-1);
  const gridCols = useGridSize();
  // Collection state
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionView, setCollectionView] = useState('collections'); // 'collections' | 'collection' | 'album'
  const [activeCollection, setActiveCollection] = useState(null);

  const loadAlbums = async () => {
    setLoading(true);
    try {
      const data = await fetchAlbums();
      setAlbums(data.albums || []);
    } catch {} finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    setCollectionsLoading(true);
    try {
      const data = await fetchCollections();
      setCollections(data.collections || []);
    } catch {} finally {
      setCollectionsLoading(false);
    }
  };

  useEffect(() => {
    loadAlbums();
    loadCollections();
  }, [refreshTrigger]);

  const openAlbum = async (albumId) => {
    setActiveAlbumId(albumId);
    setAlbumLoading(true);
    setLightbox(null);
    setSelectedAlbumPhotoIds(new Set());
    setAlbumPhotos([]);
    setAlbumHasMore(false);
    try {
      const data = await fetchAlbum(albumId, { limit: 50, offset: 0 });
      setActiveAlbum(data.album);
      setAlbumPhotos(data.photos || []);
      setAlbumHasMore(data.hasMore ?? false);
    } catch {} finally {
      setAlbumLoading(false);
    }
  };

  const closeAlbum = () => {
    setActiveAlbum(null);
    setActiveAlbumId(null);
    setLightbox(null);
    setSelectedAlbumPhotoIds(new Set());
    setAlbumPhotos([]);
    setAlbumHasMore(false);
    loadAlbums();
  };

  // Infinite scroll for album photos — scroll-position tracking on the scroll container
  useEffect(() => {
    const container = albumScrollRef.current;
    if (!container || !albumHasMore || !activeAlbumId) return;

    const check = () => {
      if (albumLoadingMoreRef.current) return;
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      // Trigger when less than ~2 viewports of content left
      if (remaining < 2000) {
        albumLoadingMoreRef.current = true;
        setAlbumLoadingMore(true);

        fetchAlbum(activeAlbumId, { limit: 50, offset: albumPhotos.length })
          .then(data => {
            if (data) {
              setAlbumPhotos(prev => [...prev, ...(data.photos || [])]);
              setAlbumHasMore(data.hasMore ?? false);
            }
          })
          .catch(() => {})
          .finally(() => {
            albumLoadingMoreRef.current = false;
            setAlbumLoadingMore(false);
          });
      }
    };

    container.addEventListener('scroll', check, { passive: true });
    check(); // also check immediately — loads ahead on mount
    return () => container.removeEventListener('scroll', check);
  }, [albumHasMore, albumPhotos.length, activeAlbumId]);

  const handleDeleteAlbum = async (albumId) => {
    try {
      await deleteAlbum(albumId);
      setSuccessMsg('Album deleted');
      setConfirmDelete(null);
      setTimeout(() => setSuccessMsg(null), 2000);
      loadAlbums();
    } catch {}
  };

  const handleEditAlbum = async () => {
    setSuccessMsg('Album updated');
    setEditingAlbum(null);
    setTimeout(() => setSuccessMsg(null), 2000);
    loadAlbums();
  };

  const openCollection = (collection) => {
    setActiveCollection(collection);
    setCollectionView('collection');
  };

  const closeCollection = () => {
    setActiveCollection(null);
    setCollectionView('collections');
  };

  const handleDeleteCollection = async (e, collectionId) => {
    e.stopPropagation();
    if (!confirm('Delete this collection? Albums inside will not be deleted.')) return;
    try {
      await deleteCollection(collectionId);
      setSuccessMsg('Collection deleted');
      setTimeout(() => setSuccessMsg(null), 2000);
      loadCollections();
    } catch {}
  };

  // Albums filtered by collection (or none)
  const albumsInCollection = activeCollection
    ? albums.filter(a => a.collection_id === activeCollection.id)
    : [];
  const albumsWithoutCollection = albums.filter(a => !a.collection_id);

  const handleRemovePhoto = async (photoId) => {
    if (!activeAlbumId) return;
    setRemovingPhoto(photoId);
    try {
      await removePhotoFromAlbum(activeAlbumId, photoId);
      await checkAndHandleEmptyAlbum(activeAlbumId, 'Removed from album');
    } catch {} finally {
      setRemovingPhoto(null);
    }
  };

  const handleDeleteAlbumPhotos = async () => {
    if (selectedAlbumPhotoIds.size === 0) return;
    const localNote = isNative() ? ' This also deletes matching copies on this phone.' : '';
    if (!confirm(`Delete ${selectedAlbumPhotoIds.size} photo${selectedAlbumPhotoIds.size > 1 ? 's' : ''}? This removes them from the server permanently.${localNote}`)) return;
    setDeletingAlbumPhotos(true);
    for (const id of selectedAlbumPhotoIds) {
      try { await deletePhoto(id); } catch {}
      const filename = albumPhotos.find(p => p.id === id)?.original_filename;
      if (filename) { try { await deleteLocalByServerName(filename); } catch {} }
    }
    setDeletingAlbumPhotos(false);
    setSelectedAlbumPhotoIds(new Set());
    // Refresh the album view after deleting
    if (activeAlbumId) {
      const data = await fetchAlbum(activeAlbumId, { limit: 50, offset: 0 });
      if (data) {
        setAlbumPhotos(data.photos || []);
        setAlbumHasMore(data.hasMore ?? false);
        // If album has no photos left, go back to list
        if (!data.photos || data.photos.length === 0) {
          await deleteAlbum(activeAlbumId);
          setActiveAlbum(null);
          setActiveAlbumId(null);
          setAlbumPhotos([]);
          setSuccessMsg('Album deleted (was empty)');
          setTimeout(() => setSuccessMsg(null), 2000);
          loadAlbums();
        } else {
          setActiveAlbum(data.album);
        }
      }
    }
  };

  const toggleSelect = useCallback((idx, id) => {
    lastClickedIdxRef.current = idx;
    setSelectedAlbumPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleShiftClick = useCallback((idx, id) => {
    const anchor = lastClickedIdxRef.current;
    if (anchor < 0) {
      // No anchor yet — just select this one
      lastClickedIdxRef.current = idx;
      setSelectedAlbumPhotoIds(new Set([id]));
      return;
    }
    const from = Math.min(anchor, idx);
    const to = Math.max(anchor, idx);
    const rangeIds = albumPhotos.slice(from, to + 1).map(p => p.id);
    setSelectedAlbumPhotoIds(prev => {
      const next = new Set(prev);
      rangeIds.forEach(rid => next.add(rid));
      return next;
    });
  }, [albumPhotos]);

  const clearSelection = useCallback(() => {
    lastClickedIdxRef.current = -1;
    setSelectedAlbumPhotoIds(new Set());
  }, []);

  const checkAndHandleEmptyAlbum = async (albumId, successMsg) => {
    const data = await fetchAlbum(albumId, { limit: 1, offset: 0 });
    if (!data.photos || data.photos.length === 0) {
      await deleteAlbum(albumId);
      setActiveAlbum(null);
      setActiveAlbumId(null);
      setAlbumPhotos([]);
      setSuccessMsg('Album deleted (was empty)');
      setTimeout(() => setSuccessMsg(null), 2000);
      loadAlbums();
    } else {
      setActiveAlbum(data.album);
      setAlbumPhotos(data.photos || []);
      setAlbumHasMore(data.hasMore ?? false);
      setSuccessMsg(successMsg);
      setTimeout(() => setSuccessMsg(null), 2000);
    }
  };

  const selCount = selectedAlbumPhotoIds.size;

  // ── Album detail view ────────────────────────────────

  if (activeAlbumId) {
    if (albumLoading) {
      return (
        <div className="text-center py-16">
          <Loader2 size={28} className="animate-spin text-retro-teal mx-auto mb-3" />
          <p className="text-retro-teal text-sm">Loading album...</p>
        </div>
      );
    }

    if (!activeAlbum) {
      return (
        <div className="text-center py-16">
          <p className="text-retro-teal">Album not found.</p>
          <button onClick={closeAlbum} className="mt-4 text-retro-orange font-semibold text-sm hover:underline">
            Back to albums
          </button>
        </div>
      );
    }

    const photos = albumPhotos;

    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Fixed header area — header, actions, selection toolbar */}
        <div className="shrink-0 space-y-3 mb-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={closeAlbum}
                className="p-2 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/30 transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h2 className="text-xl font-bold text-retro-navy">{activeAlbum.name}</h2>
                <p className="text-sm text-retro-teal">
                  {activeAlbum.photo_count} photo{activeAlbum.photo_count !== 1 ? 's' : ''}
                  {activeAlbum.description && <span className="ml-2 text-retro-mint">— {activeAlbum.description}</span>}
                </p>
              </div>
            </div>

            {/* Album action buttons */}
            {photos.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/api/albums/${activeAlbumId}/download-zip`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-retro-teal text-retro-cream hover:bg-retro-teal/80 transition-colors text-sm font-semibold"
                  title="Download all photos as zip"
                >
                  <Download size={15} />
                  Download All
                </a>
                <button
                  onClick={() => setShareModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-navy/80 transition-colors text-sm font-semibold border border-retro-teal/30"
                  title="Share album"
                >
                  <Share2 size={15} />
                  Share
                </button>
              </div>
            )}
          </div>

          {/* Success notification */}
          {successMsg && (
            <div className="flex items-center gap-2 bg-retro-mint/40 text-retro-navy text-sm font-semibold px-4 py-2.5 rounded-xl border border-retro-mint">
              <Check size={16} className="text-retro-teal shrink-0" />
              {successMsg}
            </div>
          )}

          {/* Selection toolbar */}
          {selCount > 0 && (
            <SelectionToolbar
              selCount={selCount}
              onDelete={handleDeleteAlbumPhotos}
              onAlbum={() => setMoveModalOpen(true)}
              onClearSelection={clearSelection}
              deleting={deletingAlbumPhotos}
              onDownloadSingle={() => {
                const p = photos.find(ph => selectedAlbumPhotoIds.has(ph.id));
                if (!p) return;
                downloadPhoto(p).then(res => {
                  if (res && res.ok === false) { setSuccessMsg(res.error || 'Download failed'); setTimeout(() => setSuccessMsg(null), 2500); }
                  else if (res && res.kind === 'native') { setSuccessMsg('Saved to Photos on this device'); setTimeout(() => setSuccessMsg(null), 2500); }
                });
              }}
              multiDownloadParam={Array.from(selectedAlbumPhotoIds).join(',')}
            />
          )}
        </div>

        {/* Scrollable photo grid area */}
        {photos.length === 0 && selCount === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-retro-cream/40 rounded-2xl border-2 border-retro-mint">
            <div className="text-center">
              <Image size={48} className="text-retro-mint mx-auto mb-3" />
              <p className="text-retro-teal text-sm">This album is empty.</p>
            </div>
          </div>
        ) : (
          <div ref={albumScrollRef} className="flex-1 overflow-y-auto min-h-0">
            <PhotoGrid
              photos={photos}
              selectedIds={selectedAlbumPhotoIds}
              selCount={selCount}
              gridCols={gridCols}
              onToggleSelect={toggleSelect}
              onShiftClick={handleShiftClick}
              onOpenLightbox={(photo, idx) => setLightbox({ photo, idx })}
              extraOverlay={(photo, idx, isSelected) => (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemovePhoto(photo.id); }}
                  disabled={removingPhoto === photo.id}
                  className={`absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/80 hover:bg-retro-red hover:text-white transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 ${
                    isSelected ? 'hidden' : ''
                  }`}
                  title="Remove from album"
                >
                  {removingPhoto === photo.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                </button>
              )}
            />

          {/* Infinite scroll sentinel — inside scroll container */}
          <div ref={albumSentinelRef} className="h-4" />
          {albumLoadingMore && (
            <div className="text-center py-4">
              <Loader2 size={20} className="animate-spin text-retro-teal mx-auto" />
            </div>
          )}
          </div>
        )}

        {/* Lightbox */}
        <Lightbox
          lightbox={lightbox}
          photos={photos}
          onClose={() => setLightbox(null)}
          onDownload={async (photo) => {
            const res = await downloadPhoto(photo);
            if (res && res.ok === false) { setSuccessMsg(res.error || 'Download failed'); setTimeout(() => setSuccessMsg(null), 2500); }
            else if (res && res.kind === 'native') { setSuccessMsg('Saved to Photos on this device'); setTimeout(() => setSuccessMsg(null), 2500); }
          }}
          onPrev={() => setLightbox(prev => ({ photo: photos[(prev.idx - 1 + photos.length) % photos.length], idx: (prev.idx - 1 + photos.length) % photos.length }))}
          onNext={() => setLightbox(prev => ({ photo: photos[(prev.idx + 1) % photos.length], idx: (prev.idx + 1) % photos.length }))}
        />

        {/* Album picker modal */}
        {moveModalOpen && (
          <AlbumPickerModal
            photoIds={Array.from(selectedAlbumPhotoIds)}
            selectedPhotoNames={Array.from(selectedAlbumPhotoIds).map(id => {
              const p = albumPhotos.find(ph => ph.id === id);
              return p?.original_filename || 'Photo';
            })}
            sourceAlbumId={activeAlbumId}
            onClose={() => setMoveModalOpen(false)}
            onComplete={() => {
              // Refresh album photos after move — auto-deletes if empty
              (async () => {
                setSelectedAlbumPhotoIds(new Set());
                await checkAndHandleEmptyAlbum(activeAlbumId, `Moved ${selectedAlbumPhotoIds.size} photo${selectedAlbumPhotoIds.size > 1 ? 's' : ''}`);
              })();
            }}
          />
        )}

        {/* Share modal */}
        {shareModalOpen && (
          <ShareModal type="album" itemId={activeAlbumId} onClose={() => setShareModalOpen(false)} />
        )}

      </div>
    );
  }

  // ── Album list view / Collection view ──────────────────

  // Show collection view (albums filtered by collection)
  if (collectionView === 'collection' && activeCollection) {
    return (
      <div>
        {successMsg && (
          <div className="flex items-center gap-2 bg-retro-mint/40 text-retro-navy text-sm font-semibold px-4 py-2.5 rounded-xl mb-4 border border-retro-mint">
            <Check size={16} className="text-retro-teal shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Back button + collection name */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={closeCollection}
            className="p-2 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/30 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-retro-navy">{activeCollection.name}</h2>
          <span className="text-sm text-retro-teal">{activeCollection.album_count} album{activeCollection.album_count !== 1 ? 's' : ''}</span>
        </div>

        {albumsInCollection.length === 0 ? (
          <div className="text-center py-16 bg-retro-cream/40 rounded-2xl border-2 border-retro-mint">
            <FolderOpen size={48} className="text-retro-mint mx-auto mb-3" />
            <p className="text-retro-teal text-sm">This collection is empty.</p>
          </div>
        ) : (
          <div className={`${gridCols} gap-4`}>
            {albumsInCollection.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onOpen={() => openAlbum(album.id)}
                onEdit={() => setEditingAlbum(album)}
                onDelete={() => setConfirmDelete(album.id)}
              />
            ))}
          </div>
        )}

        {confirmDelete && <DeleteConfirmModal albumId={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => handleDeleteAlbum(confirmDelete)} />}
        {editingAlbum && <AlbumEditModal album={editingAlbum} collections={collections} onSave={handleEditAlbum} onClose={() => setEditingAlbum(null)} />}
      </div>
    );
  }

  // ── Default: collections + uncategorized albums ────────

  return (
    <div>
      {successMsg && (
        <div className="flex items-center gap-2 bg-retro-mint/40 text-retro-navy text-sm font-semibold px-4 py-2.5 rounded-xl mb-4 border border-retro-mint">
          <Check size={16} className="text-retro-teal shrink-0" />
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <Loader2 size={28} className="animate-spin text-retro-teal mx-auto mb-3" />
          <p className="text-retro-teal text-sm">Loading albums...</p>
        </div>
      ) : collections.length === 0 && albumsWithoutCollection.length === 0 ? (
        <div className="text-center py-16 bg-retro-cream/40 rounded-2xl border-2 border-retro-mint">
          <FolderOpen size={64} className="text-retro-mint mx-auto mb-4" />
          <h2 className="text-xl font-bold text-retro-navy mb-2">No albums yet</h2>
          <p className="text-retro-teal text-sm">
            Select photos in the gallery and use the <strong>Album</strong> button to create one.
          </p>
        </div>
      ) : (
        <>
          {/* Collections row */}
          {collections.length > 0 && (
            <div className="mb-6">
              <div className={`${gridCols} gap-4`}>
                {collections.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => openCollection(c)}
                    className="group relative rounded-2xl overflow-hidden border-2 border-retro-teal/30 bg-retro-navy/10 shadow-sm hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="aspect-[4/3] bg-retro-navy/5 flex items-center justify-center">
                      <FolderOpen size={48} className="text-retro-teal/60" />
                    </div>
                    <div className="p-3">
                      <h3 className="text-sm font-bold text-retro-navy truncate">{c.name}</h3>
                      <p className="text-xs text-retro-teal mt-0.5">{c.album_count} album{c.album_count !== 1 ? 's' : ''}</p>
                    </div>
                    {/* Delete collection button */}
                    <button
                      onClick={(e) => handleDeleteCollection(e, c.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/30 text-white/70 hover:bg-retro-red hover:text-white transition-all opacity-0 group-hover:opacity-100"
                      title="Delete collection"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Uncategorized albums */}
          {albumsWithoutCollection.length > 0 && (
            <div>
              {collections.length > 0 && (
                <h3 className="text-sm font-semibold text-retro-teal mb-3">Other albums</h3>
              )}
              <div className={`${gridCols} gap-4`}>
                {albumsWithoutCollection.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onOpen={() => openAlbum(album.id)}
                    onEdit={() => setEditingAlbum(album)}
                    onDelete={() => setConfirmDelete(album.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {confirmDelete && <DeleteConfirmModal albumId={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => handleDeleteAlbum(confirmDelete)} />}
      {editingAlbum && <AlbumEditModal album={editingAlbum} collections={collections} onSave={handleEditAlbum} onClose={() => setEditingAlbum(null)} />}
    </div>
  );
}
