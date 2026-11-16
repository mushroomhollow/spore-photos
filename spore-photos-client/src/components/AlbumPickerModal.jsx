import { useState, useEffect } from 'react';
import { FolderOpen, Plus, X, Loader2, Check, Image as ImageIcon } from 'lucide-react';
import { createAlbum, addPhotosToAlbum, removePhotosFromAlbum, updateAlbum, fetchAlbumsWithPhotoInfo } from '../api/client';

export default function AlbumPickerModal({ photoIds, selectedPhotoNames, onClose, onComplete, sourceAlbumId }) {
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionAlbumId, setActionAlbumId] = useState(null); // currently being toggled
  const [creating, setCreating] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [successMsg, setSuccessMsg] = useState(null);
  const [error, setError] = useState(null);
  const [settingCover, setSettingCover] = useState(null); // album id being set as cover

  const count = photoIds.length;
  const isMove = !!sourceAlbumId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchAlbumsWithPhotoInfo(photoIds);
        if (!cancelled) setAlbums(data.albums || []);
      } catch {
        if (!cancelled) setError('Failed to load albums');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [photoIds]);

  const photoIdSet = new Set(photoIds);

  const getMembershipStatus = (album) => {
    const inAlbum = (album.photos_in_album || []).filter(id => photoIdSet.has(id)).length;
    if (inAlbum === 0) return 'none';
    if (inAlbum === count) return 'all';
    return 'some';
  };

  // Albums with photos in them first (all, then some, then none)
  const sortedAlbums = [...albums].sort((a, b) => {
    const order = { all: 0, some: 1, none: 2 };
    return order[getMembershipStatus(a)] - order[getMembershipStatus(b)];
  });

  const toggleAlbum = async (album) => {
    const status = getMembershipStatus(album);
    setActionAlbumId(album.id);
    setError(null);
    setSuccessMsg(null);
    try {
      if (status === 'none' || status === 'some') {
        // Add photos not already in this album
        const toAdd = photoIds.filter(id => !(album.photos_in_album || []).includes(id));
        await addPhotosToAlbum(album.id, toAdd);
      } else {
        // Remove all selected photos from this album
        await removePhotosFromAlbum(album.id, photoIds);
      }
      // Refresh membership for this album
      const data = await fetchAlbumsWithPhotoInfo(photoIds);
      setAlbums(data.albums || []);
      setSuccessMsg(status === 'none' || status === 'some'
        ? `Added to "${album.name}"`
        : `Removed from "${album.name}"`);
      onComplete?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'Operation failed');
    } finally {
      setActionAlbumId(null);
    }
  };

  const handleSetCover = async (album) => {
    setSettingCover(album.id);
    setError(null);
    setSuccessMsg(null);
    try {
      await updateAlbum(album.id, { cover_photo_id: photoIds[0] });
      // Update local album state to show the new cover
      setAlbums(prev => prev.map(a => a.id === album.id
        ? { ...a, cover_url: `/api/photos/${photoIds[0]}/file/thumb` }
        : a
      ));
      setSuccessMsg(`Set ${photoIds.length === 1 ? 'photo' : 'first photo'} as cover of "${album.name}"`);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to set cover');
    } finally {
      setSettingCover(null);
    }
  };

  const handleCreateAndAdd = async () => {
    const name = newAlbumName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await createAlbum(name);
      await addPhotosToAlbum(result.album.id, photoIds);
      // Refresh album list
      const data = await fetchAlbumsWithPhotoInfo(photoIds);
      setAlbums(data.albums || []);
      setNewAlbumName('');
      setSuccessMsg(`Created "${name}" and added ${count} photo${count !== 1 ? 's' : ''}`);
      onComplete?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to create album');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-retro-white rounded-2xl p-5 w-full max-w-sm shadow-2xl border-2 border-retro-mint" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-retro-navy flex items-center gap-2">
            <FolderOpen size={18} className="text-retro-teal" />
            Manage Albums
          </h3>
          <button onClick={onClose} className="text-retro-teal hover:text-retro-navy p-1">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-retro-teal mb-3">
          {count} photo{count !== 1 ? 's' : ''} selected
          {selectedPhotoNames && selectedPhotoNames.length > 0 && (
            <span className="block truncate text-retro-mint">
              {Array.from(selectedPhotoNames).slice(0, 2).join(', ')}
              {selectedPhotoNames.length > 2 ? ` +${selectedPhotoNames.length - 2} more` : ''}
            </span>
          )}
        </p>

        {/* Success */}
        {successMsg && (
          <div className="flex items-center gap-2 bg-retro-mint/30 text-retro-navy text-sm font-semibold px-4 py-3 rounded-xl mb-3">
            <Check size={18} className="text-retro-teal shrink-0" />
            {successMsg}
          </div>
        )}

        {/* Error */}
        {error && !successMsg && (
          <div className="bg-retro-red/10 text-retro-red text-sm px-4 py-2 rounded-xl mb-3">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-6">
            <Loader2 size={20} className="animate-spin text-retro-teal mx-auto mb-2" />
            <p className="text-xs text-retro-teal">Loading albums...</p>
          </div>
        )}

        {/* Album list */}
        {!loading && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto mb-3">
            {albums.length === 0 && (
              <p className="text-xs text-retro-teal text-center py-4">
                No albums yet. Create one below.
              </p>
            )}
            {sortedAlbums.map((album) => {
              const status = getMembershipStatus(album);
              const isActive = actionAlbumId === album.id;
              const checked = status === 'all' || status === 'some';
              const indeterminate = status === 'some';
              const inCount = (album.photos_in_album || []).filter(id => photoIdSet.has(id)).length;
              return (
                <div
                  key={album.id}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    checked
                      ? 'bg-retro-mint/20 border-retro-teal/40'
                      : 'bg-retro-cream/50 border-retro-mint/50'
                  }`}
                >
                  {/* Checkbox indicator — click to toggle */}
                  <button
                    onClick={() => toggleAlbum(album)}
                    disabled={isActive}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      checked
                        ? 'bg-retro-teal border-retro-teal'
                        : 'bg-white border-retro-mint'
                    }`}
                  >
                    {isActive ? (
                      <Loader2 size={12} className="animate-spin text-white" />
                    ) : checked ? (
                      <Check size={12} className="text-white" />
                    ) : (
                      <Plus size={12} className="text-retro-teal/40" />
                    )}
                  </button>

                  {/* Cover thumbnail */}
                  <div className="w-9 h-9 rounded-lg bg-retro-mint/30 flex items-center justify-center overflow-hidden shrink-0">
                    {album.cover_url ? (
                      <img src={album.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={16} className="text-retro-teal" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-retro-navy truncate">{album.name}</p>
                    <p className="text-[11px] text-retro-teal">
                      {album.photo_count} photo{album.photo_count !== 1 ? 's' : ''}
                      {inCount > 0 && (
                        <span className="ml-1.5 text-retro-orange font-semibold">
                          {indeterminate ? `${inCount}/${count}` : '✓'}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Set as cover button — only for albums containing selected photos */}
                  {inCount > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetCover(album); }}
                      disabled={settingCover === album.id}
                      className="shrink-0 px-2 py-1 text-[10px] font-semibold rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-teal transition-colors disabled:opacity-50"
                      title="Set selected photo as album cover"
                    >
                      {settingCover === album.id ? <Loader2 size={10} className="animate-spin" /> : 'Cover'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Create new album */}
        {!loading && (
          <div className="border-t border-retro-mint/50 pt-3">
            <p className="text-xs font-semibold text-retro-teal mb-2 flex items-center gap-1.5">
              <Plus size={12} />
              Create new album
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="Album name..."
                maxLength={200}
                disabled={creating}
                className="flex-1 px-3 py-2 text-sm rounded-xl border-2 border-retro-mint bg-retro-cream/30 text-retro-navy placeholder:text-retro-teal/40 focus:outline-none focus:border-retro-teal transition-colors disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newAlbumName.trim()) handleCreateAndAdd();
                }}
              />
              <button
                onClick={handleCreateAndAdd}
                disabled={!newAlbumName.trim() || creating}
                className="px-3 py-2 text-sm font-semibold rounded-xl bg-retro-teal text-retro-cream hover:bg-retro-navy transition-colors disabled:opacity-40 shrink-0"
              >
                {creating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
