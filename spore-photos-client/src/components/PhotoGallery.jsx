import { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Loader2, X } from 'lucide-react';
import { fetchPhotos, deletePhoto, fetchAlbums } from '../api/client';
import PhotoGrid from './PhotoGrid';
import Lightbox from './Lightbox';
import SelectionToolbar from './SelectionToolbar';
import AlbumPickerModal from './AlbumPickerModal';
import ShareModal from './ShareModal';
import { useGridSize } from '../hooks/useGridSize';
import { useLocalPhotos } from '../hooks/useLocalPhotos';
import { onUploaded as onLocalUploaded } from '../backup/localStore';
import { downloadPhoto, deleteLocalByServerName, isNative } from '../backup/nativeFiles';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FilterBar({ filters, setFilters, availableYears, albums, totalCount, groupByDate, setGroupByDate }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Media type toggle */}
        <div className="flex bg-retro-cream/50 rounded-lg border border-retro-mint overflow-hidden">
          {[
            { key: 'all', label: 'All' },
            { key: 'photo', label: 'Photos' },
            { key: 'video', label: 'Videos' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setFilters(f => ({ ...f, type: t.key }))}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                filters.type === t.key
                  ? 'bg-retro-navy text-retro-cream'
                  : 'text-retro-teal hover:text-retro-navy hover:bg-retro-mint/20'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Year dropdown */}
        <select
          value={filters.year || ''}
          onChange={e => setFilters(f => ({ ...f, year: e.target.value || null }))}
          className="bg-retro-cream/50 border border-retro-mint rounded-lg px-3 py-1.5 text-xs font-semibold text-retro-navy focus:outline-none focus:ring-2 focus:ring-retro-teal/40 appearance-none cursor-pointer"
        >
          <option value="">All years</option>
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {/* Album filter dropdown */}
        <select
          value={filters.album}
          onChange={e => setFilters(f => ({ ...f, album: e.target.value }))}
          className="bg-retro-cream/50 border border-retro-mint rounded-lg px-3 py-1.5 text-xs font-semibold text-retro-navy focus:outline-none focus:ring-2 focus:ring-retro-teal/40 appearance-none cursor-pointer min-w-[120px]"
        >
          <option value="all">All albums</option>
          <option value="none">Not in an album</option>
          {albums.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Group by date toggle */}
        <button
          onClick={() => setGroupByDate(g => !g)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            groupByDate
              ? 'bg-retro-navy text-retro-cream border-retro-teal/30'
              : 'bg-retro-cream/50 text-retro-teal border-retro-mint hover:border-retro-teal'
          }`}
          title="Group photos by month"
        >
          {groupByDate ? 'Grouped' : 'Flat'}
        </button>

        {/* Filtered count */}
        <span className="text-xs text-retro-teal ml-auto">
          {totalCount} photo{totalCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

export default function PhotoGallery({ refreshTrigger }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef(null);
  const scrollRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const lastClickedIdxRef = useRef(-1);
  const gridCols = useGridSize();
  const local = useLocalPhotos();
  const [lightbox, setLightbox] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [sharePhotoId, setSharePhotoId] = useState(null); // opens ShareModal for this photo
  // Filter state
  const [filters, setFilters] = useState({ type: 'all', year: null, album: 'all' });
  const [availableYears, setAvailableYears] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [groupByDate, setGroupByDate] = useState(false);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  // Core fetch function: returns { rows, hasMore, years, total } or null
  const fetchPage = useCallback(async (offset) => {
    try {
      const params = { limit: 50, offset };
      if (filters.type !== 'all') params.type = filters.type;
      if (filters.year) params.year = filters.year;
      if (filters.album !== 'all') params.album = filters.album;
      const data = await fetchPhotos(params);
      return { rows: data.photos || [], hasMore: data.hasMore ?? false, years: data.years, total: data.total };
    } catch {
      return null;
    }
  }, [filters]);

  // Initial load + full refresh
  const loadInitial = useCallback(async () => {
    setLoading(true);
    const result = await fetchPage(0);
    if (result) {
      setPhotos(result.rows);
      setHasMore(result.hasMore);
      if (result.years) setAvailableYears(result.years);
      setTotalCount(result.total ?? result.rows.length);
    }
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => {
    clearSelection();
    loadInitial();
  }, [refreshTrigger, loadInitial, filters]);

  // A phone file finished uploading — show its real thumbnail in the grid.
  // Bursts (auto-backup) coalesce into one refresh instead of one per file.
  const uploadRefreshRef = useRef(null);
  useEffect(() => {
    const unsubscribe = onLocalUploaded(() => {
      if (uploadRefreshRef.current) clearTimeout(uploadRefreshRef.current);
      uploadRefreshRef.current = setTimeout(() => { loadInitial(); }, 1200);
    });
    return () => {
      unsubscribe();
      if (uploadRefreshRef.current) clearTimeout(uploadRefreshRef.current);
    };
  }, [loadInitial]);

  // Fetch albums for the album filter dropdown
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAlbums();
        setAlbums(data.albums || []);
      } catch {}
    })();
  }, []);

  // Infinite scroll via scroll position on the scroll container
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !hasMore) return;

    const check = () => {
      if (loadingMoreRef.current) return;
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      // Trigger when less than 2 viewports (~1800px) of content left
      if (remaining < 2000) {
        loadingMoreRef.current = true;
        setLoadingMore(true);

        fetchPage(photos.length).then(result => {
          if (result) {
            setPhotos(prev => [...prev, ...result.rows]);
            setHasMore(result.hasMore);
          }
          loadingMoreRef.current = false;
          setLoadingMore(false);
        });
      }
    };

    container.addEventListener('scroll', check, { passive: true });
    check(); // also check immediately — loads ahead on mount
    return () => container.removeEventListener('scroll', check);
  }, [hasMore, photos.length, fetchPage]);

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
    const rangeIds = photos.slice(from, to + 1).map(p => p.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      rangeIds.forEach(rid => next.add(rid));
      return next;
    });
  }, [photos]);

  const clearSelection = useCallback(() => {
    lastClickedIdxRef.current = -1;
    setSelectedIds(new Set());
  }, []);

  const handleDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const localNote = isNative() ? ' This also deletes matching copies on this phone.' : '';
    if (!confirm(`Delete ${selectedIds.size} photo${selectedIds.size > 1 ? 's' : ''}?${localNote}`)) return;
    setDeleting(true);
    for (const id of selectedIds) {
      try { await deletePhoto(id); } catch {}
      // Delete the matching local DCIM copy (upload source / downloaded copy).
      const filename = photos.find(p => p.id === id)?.original_filename;
      if (filename) { try { await deleteLocalByServerName(filename); } catch {} }
    }
    setDeleting(false);
    clearSelection();
    // Refresh with current filters
    const params = { limit: 50 };
    if (filters.type !== 'all') params.type = filters.type;
    if (filters.year) params.year = filters.year;
    if (filters.album !== 'all') params.album = filters.album;
    const data = await fetchPhotos(params);
    setPhotos(data.photos || []);
  }, [selectedIds, clearSelection, filters, photos]);

  const handleShare = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // Share the first selected photo
    const firstId = Array.from(selectedIds)[0];
    setSharePhotoId(firstId);
  }, [selectedIds]);

  const handleDownloadPhoto = useCallback(async (photo) => {
    if (!photo) return;
    const res = await downloadPhoto(photo);
    if (res && res.ok === false) showNotice(res.error || 'Download failed');
    else if (res && res.kind === 'native') showNotice('Saved to Photos on this device');
  }, [showNotice]);

  const handleDownloadSingle = useCallback(() => {
    const photo = photos.find(p => selectedIds.has(p.id));
    if (photo) handleDownloadPhoto(photo);
  }, [photos, selectedIds, handleDownloadPhoto]);

  const openLightbox = (photo, idx) => {
    if (selectedIds.size > 0) return; // don't open lightbox while selecting
    setLightbox({ photo, idx });
  };
  const closeLightbox = () => setLightbox(null);

  const prevPhoto = () => {
    if (!lightbox) return;
    const idx = (lightbox.idx - 1 + photos.length) % photos.length;
    setLightbox({ photo: photos[idx], idx });
  };
  const nextPhoto = () => {
    if (!lightbox) return;
    const idx = (lightbox.idx + 1) % photos.length;
    setLightbox({ photo: photos[idx], idx });
  };

  const selCount = selectedIds.size;

  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 size={36} className="animate-spin text-retro-teal mx-auto mb-3" />
        <p className="text-retro-teal">Loading photos...</p>
      </div>
    );
  }

  // Local tiles alone (nothing uploaded yet) still deserve the grid.
  if (photos.length === 0 && local.items.length === 0) {
    const hasActiveFilters = filters.type !== 'all' || filters.year !== null || filters.album !== 'all';
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Filter bar — show even when empty so user can see/clear their filters */}
        {hasActiveFilters && (
          <div className="shrink-0 space-y-3 mb-3">
            <FilterBar
              filters={filters}
              setFilters={setFilters}
              availableYears={availableYears}
              albums={albums}
              totalCount={totalCount}
              groupByDate={groupByDate}
              setGroupByDate={setGroupByDate}
            />
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-16">
            <Image size={64} className="text-retro-mint mx-auto mb-4" />
            {hasActiveFilters ? (
              <>
                <h2 className="text-xl font-bold text-retro-navy mb-2">No matching photos</h2>
                <p className="text-retro-teal">Try adjusting your filters to see more results.</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-retro-navy mb-2">No photos yet</h2>
                <p className="text-retro-teal">Upload your first photo to get started.</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Fixed area — selection toolbar + count */}
      <div className="shrink-0 space-y-3 mb-3">
        {/* Selection toolbar */}
        {selCount > 0 && (
          <SelectionToolbar
            selCount={selCount}
            onDelete={handleDelete}
            onShare={handleShare}
            onAlbum={() => setAlbumPickerOpen(true)}
            onClearSelection={clearSelection}
            deleting={deleting}
            onDownloadSingle={handleDownloadSingle}
            multiDownloadParam={Array.from(selectedIds).join(',')}
          />
        )}

        {/* Transient download/delete feedback */}
        {notice && (
          <div className="px-3 py-2 rounded-lg bg-retro-teal text-retro-white text-sm font-semibold shadow-md">
            {notice}
          </div>
        )}

        {/* Photo count + filter bar — hidden when toolbar is showing */}
        {selCount === 0 && (
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            availableYears={availableYears}
            albums={albums}
            totalCount={totalCount}
            groupByDate={groupByDate}
            setGroupByDate={setGroupByDate}
          />
        )}
      </div>

      {/* Scrollable photo grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <PhotoGrid
          photos={photos}
          localItems={local.items}
          onUploadLocal={local.uploadOne}
          selectedIds={selectedIds}
          selCount={selCount}
          gridCols={gridCols}
          onToggleSelect={toggleSelect}
          onShiftClick={handleShiftClick}
          onOpenLightbox={(photo, idx) => {
            if (selectedIds.size > 0) return;
            setLightbox({ photo, idx });
          }}
          groupByDate={groupByDate}
        />

        {/* Infinite scroll sentinel — inside scroll container so it tracks with content */}
        <div ref={sentinelRef} className="h-4" />
        {loadingMore && (
          <>
            {/* Placeholder grid — fills space while loading so user doesn't see blank */ }
            <div className={`${gridCols} gap-3`}>
              {Array.from({ length: 50 }).map((_, i) => (
                <div key={`skel-${i}`} className="aspect-square rounded-xl overflow-hidden bg-retro-cream/30 border-2 border-retro-mint/30 animate-pulse" />
              ))}
            </div>
            <div className="text-center py-4">
              <Loader2 size={20} className="animate-spin text-retro-teal mx-auto" />
            </div>
          </>
        )}
      </div>

      {/* Lightbox */}
      <Lightbox
        lightbox={lightbox}
        photos={photos}
        onClose={closeLightbox}
        onPrev={prevPhoto}
        onNext={nextPhoto}
        onDownload={handleDownloadPhoto}
      />

      {/* Share modal */}
      {sharePhotoId && (
        <ShareModal
          type="photo"
          itemId={sharePhotoId}
          onClose={() => setSharePhotoId(null)}
        />
      )}

      {/* Album picker modal */}
      {albumPickerOpen && (
        <AlbumPickerModal
          photoIds={Array.from(selectedIds)}
          selectedPhotoNames={Array.from(selectedIds).map(id => {
            const p = photos.find(ph => ph.id === id);
            return p?.original_filename || 'Photo';
          })}
          onClose={() => setAlbumPickerOpen(false)}
          onComplete={() => {
            // Refresh photos list after adding to album — preserve filters
            (async () => {
              const p = { limit: 50 };
              if (filters.type !== 'all') p.type = filters.type;
              if (filters.year) p.year = filters.year;
              if (filters.album !== 'all') p.album = filters.album;
              const data = await fetchPhotos(p);
              setPhotos(data.photos || []);
            })();
          }}
        />
      )}
    </div>
  );
}
