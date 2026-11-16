import { useState, useEffect } from 'react';
import { HardDrive, Save, Check, FolderOpen } from 'lucide-react';
import { fetchAppSettings, updatePhotosRoot } from '../api/client';

// Admin-only. Sets the server's photos root path (app_settings.photos_root).
//
// This is intentionally environment-agnostic: the app ships with no baked-in
// storage location. Whoever deploys it points this at their own storage.
// Changing it re-points the server; it does not move files.
export default function StoragePanel() {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const applyState = (s) => {
    setState(s);
    setValue(s?.photos_root || '');
  };

  useEffect(() => {
    (async () => {
      try {
        applyState(await fetchAppSettings());
      } catch (e) {
        setError(e?.response?.data?.error || e.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setError(null);
    setNotice(null);
    const next = value.trim();
    if (!next) {
      setError('Enter a photos root path.');
      return;
    }
    setSaving(true);
    try {
      applyState(await updatePhotosRoot(next));
      setNotice('Saved. The server is now reading and writing photos from this path.');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-retro-teal text-sm">Loading storage settings...</div>;
  }

  const dirty = value.trim() !== (state?.photos_root || '');
  const configured = Boolean(state?.photos_root);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-retro-navy flex items-center gap-2 mb-1">
          <HardDrive size={20} className="text-retro-teal" />
          Photos Root Path
        </h3>
        <p className="text-sm text-retro-teal">
          The folder this server reads photos from and writes uploads into. Point it at
          wherever this server keeps its photo library. Changing it does not move any files.
        </p>
      </div>

      {/* Current value */}
      <div className="rounded-xl border-2 border-retro-mint/40 bg-retro-cream/30 p-4 space-y-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-retro-teal">
          Photos root
        </span>

        {configured ? (
          <code className="block text-sm text-retro-navy break-all font-mono">
            {state.photos_root}
          </code>
        ) : (
          <p className="text-sm text-retro-orange">
            Not configured yet. Enter the path to this server's photo library below.
          </p>
        )}

        {configured && state?.unsorted_dir && (
          <div className="text-xs text-retro-teal/90 flex items-start gap-1.5">
            <FolderOpen size={13} className="mt-0.5 shrink-0" />
            <span>
              Unsorted folder:{' '}
              <code className="font-mono break-all">{state.unsorted_dir}</code>
            </span>
          </div>
        )}
      </div>

      {/* Input */}
      <div>
        <label htmlFor="photos-root" className="block text-sm font-semibold text-retro-navy mb-2">
          Set photos root path
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="photos-root"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            placeholder="/path/to/your/photo/library"
            className="flex-1 px-4 py-2.5 rounded-xl border-2 border-retro-mint/50 bg-retro-white text-retro-navy text-sm font-mono focus:outline-none focus:border-retro-teal"
          />
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-retro-teal mt-2">
          Must be an absolute path. The directory is created if it does not exist.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border-2 border-retro-red/40 bg-retro-red/10 p-3 text-sm text-retro-red">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border-2 border-retro-teal/40 bg-retro-mint/20 p-3 text-sm text-retro-navy flex items-center gap-2">
          <Check size={16} className="text-retro-teal" />
          {notice}
        </div>
      )}
    </div>
  );
}
