import { useState, useEffect } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { fetchCollections, createCollection, updateAlbum } from '../api/client';

export default function AlbumEditModal({ album, collections: initialCollections, onClose, onSave }) {
  const [name, setName] = useState(album.name);
  const [collectionId, setCollectionId] = useState(album.collection_id || '');
  const [collections, setCollections] = useState(initialCollections || []);
  const [saving, setSaving] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [creatingColl, setCreatingColl] = useState(false);

  // Refresh collections list from server
  useEffect(() => {
    if (!initialCollections) {
      (async () => {
        try {
          const data = await fetchCollections();
          setCollections(data.collections || []);
        } catch {}
      })();
    }
  }, [initialCollections]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateAlbum(album.id, {
        name: name.trim(),
        collection_id: collectionId || null,
      });
      onSave?.();
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const handleCreateCollection = async () => {
    const cname = newCollName.trim();
    if (!cname) return;
    setCreatingColl(true);
    try {
      const data = await createCollection(cname);
      setCollections(prev => [data.collection, ...prev]);
      setCollectionId(data.collection.id);
      setNewCollName('');
    } catch {} finally {
      setCreatingColl(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-retro-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border-2 border-retro-mint" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-retro-navy">Edit Album</h3>
          <button onClick={onClose} className="text-retro-teal hover:text-retro-navy p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Album name */}
          <label className="block text-sm font-semibold text-retro-teal mb-1.5">Album name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-retro-cream/50 border border-retro-mint text-retro-navy text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-retro-teal/40 mb-4"
            placeholder="Enter album name"
            autoFocus
          />

          {/* Collection picker */}
          <label className="block text-sm font-semibold text-retro-teal mb-1.5">Album collection</label>
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-retro-cream/50 border border-retro-mint text-retro-navy text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-retro-teal/40 appearance-none cursor-pointer mb-3"
          >
            <option value="">No collection</option>
            {collections.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.album_count})</option>
            ))}
          </select>

          {/* Create new collection */}
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={newCollName}
              onChange={(e) => setNewCollName(e.target.value)}
              placeholder="New collection name..."
              maxLength={200}
              disabled={creatingColl}
              className="flex-1 px-3 py-1.5 text-sm rounded-xl border-2 border-retro-mint bg-retro-cream/30 text-retro-navy placeholder:text-retro-teal/40 focus:outline-none focus:border-retro-teal transition-colors disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCollName.trim()) handleCreateCollection();
              }}
            />
            <button
              type="button"
              onClick={handleCreateCollection}
              disabled={!newCollName.trim() || creatingColl}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-retro-teal text-retro-cream hover:bg-retro-navy transition-colors disabled:opacity-40 shrink-0"
            >
              {creatingColl ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create
            </button>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 justify-end border-t border-retro-mint/50 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-retro-cream text-retro-navy text-sm font-semibold hover:bg-retro-mint/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-xl bg-retro-teal text-retro-white text-sm font-semibold hover:bg-retro-teal/80 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
