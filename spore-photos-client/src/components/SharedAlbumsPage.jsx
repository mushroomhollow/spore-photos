import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, Users, ArrowLeft, Image,
} from 'lucide-react';
import {
  fetchSharedAlbums, removeSharedAlbum, fetchAlbum,
} from '../api/client';
import PhotoGrid from './PhotoGrid';
import SelectionToolbar from './SelectionToolbar';
import AlbumCard from './AlbumCard';
import Lightbox from './Lightbox';
import { useGridSize } from '../hooks/useGridSize';
import { downloadPhoto } from '../backup/nativeFiles';

export default function SharedAlbumsPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeAlbum, setActiveAlbum] = useState(null); // album object with metadata
  const [activeAlbumId, setActiveAlbumId] = useState(null);
  const [activeAlbumPhotos, setActiveAlbumPhotos] = useState([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const lastClickedIdxRef = useRef(-1);
  const gridCols = useGridSize();
  const [notice, setNotice] = useState(null);

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  }, []);

  const handleDownloadPhoto = useCallback(async (photo) => {
    if (!photo) return;
    const res = await downloadPhoto(photo);
    if (res && res.ok === false) showNotice(res.error || 'Download failed');
    else if (res && res.kind === 'native') showNotice('Saved to Photos on this device');
  }, [showNotice]);

  const handleDownloadSingle = useCallback(() => {
    const photo = activeAlbumPhotos.find(p => selectedIds.has(p.id));
    if (photo) handleDownloadPhoto(photo);
  }, [activeAlbumPhotos, selectedIds, handleDownloadPhoto]);

  const loadSharedAlbums = async () => {
    setLoading(true);
    try {
      const data = await fetchSharedAlbums();
      setGroups(data.groups || []);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSharedAlbums();
  }, []);

  const openAlbum = async (albumId) => {
    setAlbumLoading(true);
    setActiveAlbumId(albumId);
    setActiveAlbum(null);
    setActiveAlbumPhotos([]);
    setSelectedIds(new Set());
    lastClickedIdxRef.current = -1;
    try {
      const data = await fetchAlbum(albumId, { limit: 50, offset: 0 });
      setActiveAlbum(data.album || { id: albumId, name: 'Album' });
      setActiveAlbumPhotos(data.photos || []);
    } catch {} finally {
      setAlbumLoading(false);
    }
  };

  const closeAlbum = () => {
    setActiveAlbum(null);
    setActiveAlbumId(null);
    setActiveAlbumPhotos([]);
    setSelectedIds(new Set());
    lastClickedIdxRef.current = -1;
    setLightbox(null);
    loadSharedAlbums();
  };

  const handleRemove = async (shareId) => {
    setRemoving(shareId);
    try {
      await removeSharedAlbum(shareId);
      loadSharedAlbums();
    } catch {} finally {
      setRemoving(null);
    }
  };

  const toggleSelect = useCallback((idx, id) => {
    lastClickedIdxRef.current = idx;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleShiftClick = useCallback((idx, id) => {
    const anchor = lastClickedIdxRef.current;
    if (anchor < 0) {
      lastClickedIdxRef.current = idx;
      setSelectedIds(new Set([id]));
      return;
    }
    const from = Math.min(anchor, idx);
    const to = Math.max(anchor, idx);
    const rangeIds = activeAlbumPhotos.slice(from, to + 1).map(p => p.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      rangeIds.forEach(rid => next.add(rid));
      return next;
    });
  }, [activeAlbumPhotos]);

  const clearSelection = useCallback(() => {
    lastClickedIdxRef.current = -1;
    setSelectedIds(new Set());
  }, []);

  const selCount = selectedIds.size;

  // ── Album detail view (read-only) ─────────────────────────
  if (activeAlbum) {
    if (albumLoading) {
      return (
        <div className="text-center py-16">
          <Loader2 size={28} className="animate-spin text-retro-teal mx-auto mb-3" />
          <p className="text-retro-teal text-sm">Loading album...</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 mb-4">
          <button
            onClick={closeAlbum}
            className="p-2 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/30 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-retro-navy truncate">
              {activeAlbum?.name || 'Shared Album'}
            </h2>
            {activeAlbum?.photo_count !== undefined && (
              <p className="text-xs text-retro-teal">
                {activeAlbum.photo_count} photo{activeAlbum.photo_count !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Selection toolbar */}
        {selCount > 0 && (
          <div className="shrink-0 mb-3">
            <SelectionToolbar
              selCount={selCount}
              onClearSelection={clearSelection}
              onDownloadSingle={selCount === 1 ? handleDownloadSingle : undefined}
              multiDownloadParam={
                selCount > 1 ? Array.from(selectedIds).join(',') : null
              }
            />
          </div>
        )}

        {notice && (
          <div className="px-3 py-2 rounded-lg bg-retro-teal text-retro-white text-sm font-semibold shadow-md mb-3">
            {notice}
          </div>
        )}

        {/* Photos grid */}
        {activeAlbumPhotos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-retro-cream/40 rounded-2xl border-2 border-retro-mint">
            <div className="text-center">
              <Image size={48} className="text-retro-mint mx-auto mb-3" />
              <p className="text-retro-teal text-sm">This album is empty.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <PhotoGrid
              photos={activeAlbumPhotos}
              selectedIds={selectedIds}
              selCount={selCount}
              gridCols={gridCols}
              onToggleSelect={toggleSelect}
              onShiftClick={handleShiftClick}
              onOpenLightbox={(photo, idx) => {
                if (selCount > 0) return;
                setLightbox({ photo, idx });
              }}
            />
          </div>
        )}

        {/* Lightbox */}
        <Lightbox
          lightbox={lightbox}
          photos={activeAlbumPhotos}
          onClose={() => setLightbox(null)}
          onDownload={handleDownloadPhoto}
          onPrev={() => setLightbox(prev => ({
            photo: activeAlbumPhotos[(prev.idx - 1 + activeAlbumPhotos.length) % activeAlbumPhotos.length],
            idx: (prev.idx - 1 + activeAlbumPhotos.length) % activeAlbumPhotos.length,
          }))}
          onNext={() => setLightbox(prev => ({
            photo: activeAlbumPhotos[(prev.idx + 1) % activeAlbumPhotos.length],
            idx: (prev.idx + 1) % activeAlbumPhotos.length,
          }))}
        />
      </div>
    );
  }

  // ── Shared albums list ────────────────────────────────────
  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 size={28} className="animate-spin text-retro-teal mx-auto mb-3" />
        <p className="text-retro-teal text-sm">Loading shared albums...</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Users size={48} className="text-retro-mint mb-3" />
        <h2 className="text-lg font-bold text-retro-navy mb-1">No Shared Albums</h2>
        <p className="text-sm text-retro-teal text-center max-w-sm">
          When someone shares an album with you, it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-6">

      {groups.map((group) => (
        <div key={group.owner.id} className="space-y-3">
          {/* Owner header bar */}
          <div className="bg-retro-navy text-retro-cream px-4 py-2.5 rounded-xl flex items-center gap-2">
            <Users size={16} className="text-retro-mint shrink-0" />
            <span className="font-semibold text-sm">
              {group.owner.display_name || group.owner.username}
            </span>
            <span className="text-retro-mint/60 text-xs ml-auto">
              {group.albums.length} album{group.albums.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Album cards — using AlbumCard component */}
          <div className={`${gridCols} gap-4`}>
            {group.albums.map((album) => (
              <AlbumCard
                key={album.share_id}
                album={album}
                onOpen={() => openAlbum(album.id)}
                onRemove={() => handleRemove(album.share_id)}
                removeLoading={removing === album.share_id}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
