import { useState, useEffect } from 'react';
import { FolderOpen, Search, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { fetchUnsortedInfo, scanUnsorted, scanLibrary } from '../api/client';

// Shown on the Upload page, below the main upload button.
//   Import Unsorted Photos — ingest <photosRoot>/Unsorted into this user's library
//   Scan Photo Library     — reconcile the photos table with the files on disk
export default function LibraryTools({ onComplete }) {
  const [info, setInfo] = useState(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(null);       // 'import' | 'scan' | null
  const [result, setResult] = useState(null);   // { kind, data }
  const [error, setError] = useState(null);

  const loadInfo = async () => {
    try {
      const i = await fetchUnsortedInfo();
      setInfo(i);
      setPending(i?.pending_count ?? 0);
    } catch {
      // Unsorted info is advisory only — the buttons still work without it.
    }
  };

  useEffect(() => { loadInfo(); }, []);

  const run = async (kind) => {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const data = kind === 'import' ? await scanUnsorted() : await scanLibrary();
      setResult({ kind, data });
      await loadInfo();
      if (onComplete) onComplete(data);
      window.dispatchEvent(new CustomEvent('photos-imported', { detail: data }));
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-retro-mint bg-retro-cream/30 p-6 space-y-4">
      <div>
        <h3 className="text-retro-navy font-bold text-lg mb-1">Library Tools</h3>
        <p className="text-sm text-retro-teal">
          Import files you copied onto the server by hand, or re-sync the database
          with what is actually stored on disk.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => run('import')}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'import'
            ? <RefreshCw size={16} className="animate-spin" />
            : <FolderOpen size={16} />}
          {busy === 'import' ? 'Importing...' : 'Import Unsorted Photos'}
          {busy === null && pending > 0 && (
            <span className="ml-1 bg-retro-white/25 text-[11px] font-bold px-1.5 py-0.5 rounded">
              {pending}
            </span>
          )}
        </button>

        <button
          onClick={() => run('scan')}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-retro-teal text-retro-navy font-semibold text-sm hover:bg-retro-teal/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'scan'
            ? <RefreshCw size={16} className="animate-spin" />
            : <Search size={16} />}
          {busy === 'scan' ? 'Scanning...' : 'Scan Photo Library'}
        </button>
      </div>

      {info && info.exists === false && busy === null && !result && (
        <p className="text-xs text-retro-teal">
          No Unsorted folder yet at{' '}
          <code className="font-mono break-all">{info.unsorted_dir}</code>
        </p>
      )}

      {result && <ResultBlock kind={result.kind} data={result.data} />}

      {error && (
        <div className="rounded-xl border-2 border-retro-red/40 bg-retro-red/10 p-3 text-sm text-retro-red flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
}

function FileList({ title, items, tone = 'teal' }) {
  if (!items || items.length === 0) return null;
  const color = tone === 'red' ? 'text-retro-red' : 'text-retro-teal';
  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold ${color}`}>{title}</p>
      <ul className="text-xs text-retro-navy/75 font-mono space-y-0.5 max-h-40 overflow-y-auto">
        {items.map((line, i) => <li key={i} className="break-all">{line}</li>)}
      </ul>
    </div>
  );
}

function ResultBlock({ kind, data }) {
  if (!data) return null;

  if (kind === 'import') {
    return (
      <div className="rounded-xl border-2 border-retro-mint/50 bg-retro-white/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Check size={16} className="text-retro-teal" />
          <span className="text-sm font-semibold text-retro-navy">Import complete</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-retro-navy">
          <span>Imported: <strong>{data.ingested}</strong></span>
          <span>Skipped: <strong>{data.skipped}</strong></span>
          {data.failed > 0 && <span className="text-retro-red">Failed: <strong>{data.failed}</strong></span>}
        </div>
        {data.message && <p className="text-xs text-retro-teal">{data.message}</p>}
        <FileList
          title="Failed files (left in Unsorted)"
          tone="red"
          items={(data.errors || []).map(e => `${e.file} — ${e.error}`)}
        />
        <FileList
          title="Skipped"
          items={(data.skipped_details || []).map(s => `${s.file} — ${s.reason}`)}
        />
        {data.subdirectories_ignored?.length > 0 && (
          <p className="text-xs text-retro-teal">
            Subfolders not scanned: {data.subdirectories_ignored.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-retro-mint/50 bg-retro-white/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Check size={16} className="text-retro-teal" />
        <span className="text-sm font-semibold text-retro-navy">Library scan complete</span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-retro-navy">
        <span>On disk: <strong>{data.disk_files}</strong></span>
        <span>In database: <strong>{data.db_rows}</strong></span>
        <span>Added: <strong>{data.added}</strong></span>
        <span>Removed: <strong>{data.removed}</strong></span>
        <span>Unchanged: <strong>{data.unchanged}</strong></span>
      </div>

      <FileList title="Added records" items={data.added_samples} />
      <FileList title="Removed records" tone="red" items={data.removed_samples} />
      <FileList title="No matching user" tone="red" items={data.unmatched} />
      <FileList title="Unrecognized filenames" items={data.unrecognized} />
      <FileList
        title="Errors"
        tone="red"
        items={(data.errors || []).map(e => `${e.file} — ${e.error}`)}
      />
    </div>
  );
}
