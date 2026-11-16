import { useRef, useEffect, useMemo } from 'react';
import { CheckCircle, Play, Calendar, CloudUpload, Clock, AlertCircle, Loader2, Smartphone } from 'lucide-react';

function monthLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

function monthKey(dateStr) {
  if (!dateStr) return 'unknown';
  return dateStr.slice(0, 7); // "2025-07"
}

export default function PhotoGrid({
  photos,
  localItems = [],
  selectedIds,
  selCount,
  gridCols,
  onToggleSelect,
  onShiftClick,
  onOpenLightbox,
  onUploadLocal,
  extraOverlay,
  groupByDate,
}) {
  // Server photos and the phone's own un-uploaded files share one grid, but the
  // un-uploaded ones float to the VERY TOP so it is obvious at a glance what
  // still needs backing up. Each group is newest-first (local files by mtime).
  const merged = useMemo(() => {
    const servers = photos.map((p, i) => ({ kind: 'server', photo: p, serverIdx: i, date: p.date_taken || '' }));
    const locals = localItems.map(l => ({ kind: 'local', item: l, date: l.date_taken || '' }));
    const all = [...servers, ...locals];
    all.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
      return String(b.date).localeCompare(String(a.date));
    });
    return all;
  }, [photos, localItems]);

  const renderEntry = (entry) => (
    entry.kind === 'server' ? (
      <PhotoTile
        key={entry.photo.id}
        photo={entry.photo}
        idx={entry.serverIdx}
        {...{ selectedIds, selCount, gridCols, onToggleSelect, onShiftClick, onOpenLightbox, extraOverlay }}
      />
    ) : (
      <LocalTile key={entry.item.key} item={entry.item} onUpload={onUploadLocal} />
    )
  );

  if (!groupByDate) {
    return (
      <div className={`${gridCols} gap-3`}>
        {merged.map(renderEntry)}
      </div>
    );
  }

  // Group by YYYY-MM
  const sections = [];
  let currentKey = null;
  let currentGroup = [];
  for (let i = 0; i < merged.length; i++) {
    const key = monthKey(merged[i].date);
    if (key !== currentKey) {
      if (currentGroup.length > 0) {
        sections.push({ key: currentKey, label: monthLabel(merged[i - 1].date), entries: currentGroup });
      }
      currentKey = key;
      currentGroup = [merged[i]];
    } else {
      currentGroup.push(merged[i]);
    }
  }
  if (currentGroup.length > 0) {
    sections.push({ key: currentKey, label: monthLabel(merged[merged.length - 1].date), entries: currentGroup });
  }

  return (
    <div className="space-y-6">
      {sections.map(section => (
        <div key={section.key}>
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={14} className="text-retro-teal shrink-0" />
            <h3 className="text-sm font-bold text-retro-navy">{section.label}</h3>
            <span className="text-xs text-retro-mint">{section.entries.length} photo{section.entries.length !== 1 ? 's' : ''}</span>
          </div>
          <div className={`${gridCols} gap-3`}>
            {section.entries.map(renderEntry)}
          </div>
        </div>
      ))}
    </div>
  );
}

const LONG_PRESS_MS = 500;

function PhotoTile({ photo, idx, selectedIds, selCount, onToggleSelect, onShiftClick, onOpenLightbox, extraOverlay }) {
  const isSelected = selectedIds.has(photo.id);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const startPos = useRef(null);

  // Clean up any pending timer on unmount
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e) => {
    // Ignore non-primary input (e.g. right-click)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    longPressFired.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      onToggleSelect(idx, photo.id);
      // Light haptic feedback on supported devices
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch {}
      }
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e) => {
    if (!startPos.current || !longPressTimer.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    // Cancel the long-press if the pointer travels far enough (user is scrolling)
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearLongPressTimer();
    }
  };

  const handlePointerEnd = () => {
    clearLongPressTimer();
    startPos.current = null;
  };

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all shadow-sm hover:shadow-md ${
        isSelected
          ? 'border-retro-orange ring-2 ring-retro-orange/40'
          : 'border-retro-mint bg-retro-cream/50 hover:border-retro-teal'
      }`}
    >
      <img
        src={photo.urls.thumb}
        alt={photo.original_filename}
        className="w-full h-full object-cover transition-transform group-hover:scale-105"
        loading="lazy"
        draggable={false}
        onLoad={(e) => { e.target.style.opacity = '1'; }}
        style={{ opacity: 0, transition: 'opacity 0.25s ease-in-out', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          // A long-press already handled this gesture — swallow the trailing click.
          if (longPressFired.current) {
            longPressFired.current = false;
            e.preventDefault();
            return;
          }
          if (e.shiftKey) { onShiftClick(idx, photo.id); return; }
          if (selCount > 0) { onToggleSelect(idx, photo.id); return; }
          onOpenLightbox(photo, idx);
        }}
      />

      <div
        onClick={(e) => { e.stopPropagation();
          if (e.shiftKey) onShiftClick(idx, photo.id);
          else onToggleSelect(idx, photo.id);
        }}
        className={`absolute top-2 left-2 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer ${
          isSelected
            ? 'bg-retro-orange border-retro-orange'
            : 'bg-black/30 border-white/80 group-hover:bg-white/40'
        }`}
      >
        {isSelected && <CheckCircle size={18} className="text-retro-white" />}
      </div>

      {selCount > 0 && isSelected && (
        <div className="absolute top-2 right-2 bg-retro-orange text-retro-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
          {Array.from(selectedIds).indexOf(photo.id) + 1}
        </div>
      )}

      {photo.mime_type?.startsWith('video/') && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Play size={22} className="text-white ml-0.5" />
          </div>
        </div>
      )}

      {photo.mime_type?.startsWith('video/') && (
        <div className="absolute top-2 right-2 bg-retro-orange text-retro-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          VIDEO
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="text-white text-xs truncate">{photo.original_filename}</p>
      </div>

      {extraOverlay?.(photo, idx, isSelected)}
    </div>
  );
}

/**
 * A file that lives on the phone but not yet on the server. No image decoding
 * happens here on purpose (HEIC and video cannot be previewed in the WebView) —
 * the tile shows state, and the real thumbnail appears once uploaded.
 */
function LocalTile({ item, onUpload }) {
  const isVideo = item.mime_type?.startsWith('video/');
  const isHeic = item.mime_type === 'image/heic' || item.mime_type === 'image/heif';
  const uploading = item.state === 'uploading';
  const queued = item.state === 'queued';
  const isError = item.state === 'error';
  const pct = item.progress || 0;
  const tooLarge = isError && /too large/i.test(item.error || '');

  return (
    <div className="group relative aspect-square rounded-xl overflow-hidden border-2 border-dashed border-retro-teal/40 bg-retro-cream/40 shadow-sm">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2">
        {uploading ? (
          <>
            <Loader2 size={22} className="animate-spin text-retro-teal" />
            <span className="text-[10px] font-bold text-retro-teal">{pct}%</span>
          </>
        ) : queued ? (
          <>
            <Clock size={22} className="text-retro-teal" />
            <span className="text-[10px] font-semibold text-retro-teal">Scheduled</span>
          </>
        ) : isError ? (
          <div className="flex flex-col items-center gap-1 w-full px-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpload?.(item.key); }}
              disabled={tooLarge}
              title={item.error || 'Retry upload'}
              className="flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-retro-red hover:bg-retro-red/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <AlertCircle size={22} />
              <span className="text-[10px] font-semibold">{tooLarge ? 'Too large' : 'Retry'}</span>
            </button>
            {item.error && (
              <span className="text-[9px] leading-tight text-retro-red/80 text-center break-words line-clamp-2">
                {item.error}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpload?.(item.key); }}
            title="Back up this photo"
            className="flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-retro-navy hover:bg-retro-mint/30 transition-colors"
          >
            <CloudUpload size={22} />
            <span className="text-[10px] font-semibold">Back up</span>
          </button>
        )}
      </div>

      {/* Designates this as a file still on the phone */}
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/30 rounded px-1.5 py-0.5">
        <Smartphone size={11} className="text-white" />
      </div>

      {(isVideo || isHeic) && (
        <div className="absolute top-2 right-2 bg-retro-orange text-retro-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          {isVideo ? 'VIDEO' : 'HEIC'}
        </div>
      )}

      {uploading && (
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-retro-mint/40">
          <div className="h-full bg-retro-teal transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-5 pb-2.5 pointer-events-none">
        <p className="text-white text-[10px] truncate">{item.name}</p>
      </div>
    </div>
  );
}
