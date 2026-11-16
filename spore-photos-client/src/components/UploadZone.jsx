import { useState, useRef, useCallback } from 'react';
import { Upload, X, Check, Image, Loader2 } from 'lucide-react';
import { uploadPhoto, MAX_UPLOAD_MB } from '../api/client';

export default function UploadZone({ onUploadComplete }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    setError(null);
    const valid = [];
    const tooBig = [];
    for (const f of files) {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) continue;
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
        tooBig.push(`${f.name} (${Math.round(f.size / (1024 * 1024))} MB)`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) {
      setError(tooBig.length
        ? `Too large to upload — the limit is ${MAX_UPLOAD_MB} MB per file: ${tooBig.join(', ')}`
        : 'No valid files found (JPEG, PNG, WebP, GIF, video)');
      return;
    }

    // Show local previews immediately
    const local = valid.map(f => ({ id: URL.createObjectURL(f), name: f.name, done: false }));
    setPreviews(prev => [...prev, ...local]);

    setUploading(true);
    setProgress(0);

    for (let i = 0; i < valid.length; i++) {
      try {
        const result = await uploadPhoto(valid[i], (e) => {
          const pct = Math.round((e.loaded / e.total) * 100);
          const base = (i / valid.length) * 100;
          setProgress(Math.round(base + (pct / valid.length)));
        });
        setPreviews(prev => prev.map((p, idx) => {
          const globalIdx = previews.length - valid.length + i;
          if (idx === globalIdx) return { ...p, done: true, photo: result.photo };
          return p;
        }));
        if (onUploadComplete) onUploadComplete(result.photo);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || `Failed to upload ${valid[i].name}`;
        const debug = e.debugInfo ? ` [${e.debugInfo}]` : '';
        setError(`${msg}${debug}`);
      }
    }
    setUploading(false);
    setProgress(100);
  }, [previews.length, onUploadComplete]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const clearPreviews = () => {
    previews.forEach(p => URL.revokeObjectURL(p.id));
    setPreviews([]);
  };

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
          dragOver
            ? 'border-retro-teal bg-retro-teal/10'
            : 'border-retro-mint bg-retro-cream/30 hover:border-retro-teal hover:bg-retro-teal/5'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { if (e.target.files.length) handleFiles(Array.from(e.target.files)); }}
        />
        <Upload size={48} className="mx-auto mb-3 text-retro-teal" />
        <p className="text-retro-navy font-semibold text-lg mb-1">
          {uploading ? 'Uploading...' : 'Drop photos here'}
        </p>
        <p className="text-retro-teal text-sm">or click to browse · JPEG, PNG, WebP, GIF, video · max {MAX_UPLOAD_MB} MB each</p>

        {uploading && (
          <div className="mt-4 max-w-xs mx-auto">
            <div className="h-2 bg-retro-mint/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-retro-teal rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-retro-teal mt-1">{progress}%</p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-retro-red/10 border border-retro-red/30 rounded-xl p-3 text-retro-red text-sm flex items-center gap-2">
          <X size={16} />
          {error}
        </div>
      )}

      {/* Uploaded previews */}
      {previews.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-retro-navy">Uploaded files</h3>
            {!uploading && (
              <button onClick={clearPreviews} className="text-xs text-retro-teal hover:text-retro-red transition-colors">
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {previews.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-retro-mint bg-retro-cream/50 group">
                <img src={p.id} alt={p.name} className="w-full h-full object-cover" />
                {p.done && (
                  <div className="absolute top-1 right-1 bg-retro-mint rounded-full p-0.5">
                    <Check size={12} className="text-retro-navy" />
                  </div>
                )}
                {!p.done && uploading && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <Loader2 size={20} className="text-retro-cream animate-spin" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
