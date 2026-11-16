import { Smartphone, Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useLocalPhotos } from '../hooks/useLocalPhotos';

// Shown on the Upload tab, Android only.
// The old "Backup from phone" button is now a checkbox: when it is on, every
// app open uploads new camera-roll files automatically.
export default function AutoBackupSetting() {
  const { supported, enabled, items, scanning, lastError, setEnabled } = useLocalPhotos();

  if (!supported) return null;

  const uploading = items.filter(i => i.state === 'uploading');
  const queued = items.filter(i => i.state === 'queued').length;
  const pending = items.filter(i => i.state === 'pending').length;
  const errored = items.filter(i => i.state === 'error').length;
  const current = uploading[0];

  return (
    <div className="mt-6 p-4 border-2 border-dashed border-retro-teal/30 rounded-xl bg-retro-teal/5">
      <div className="flex items-center gap-3 mb-3">
        <Smartphone className="w-5 h-5 text-retro-teal" />
        <h3 className="text-sm font-semibold text-retro-navy">Phone Backup</h3>
      </div>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-retro-teal cursor-pointer shrink-0"
        />
        <span>
          <span className="block text-sm font-semibold text-retro-navy">Auto-backup phone photos</span>
          <span className="block text-xs text-retro-navy/60">
            Every time the app opens, new photos in your camera roll upload automatically.
            They appear in the Photos tab as they upload.
          </span>
        </span>
      </label>

      <StatusLine
        scanning={scanning}
        lastError={lastError}
        current={current}
        uploading={uploading.length}
        queued={queued}
        pending={pending}
        errored={errored}
      />
    </div>
  );
}

function StatusLine({ scanning, lastError, current, uploading, queued, pending, errored }) {
  if (lastError) {
    return (
      <div className="mt-3 flex items-start gap-2 text-xs text-retro-red">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>{lastError}</span>
      </div>
    );
  }

  if (scanning) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-retro-navy/70">
        <Loader2 size={14} className="animate-spin text-retro-teal shrink-0" />
        <span>Scanning your phone…</span>
      </div>
    );
  }

  if (uploading > 0) {
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-retro-navy/70">
          <Loader2 size={14} className="animate-spin text-retro-teal shrink-0" />
          <span className="truncate">
            Uploading {current?.name || '…'}
            {queued > 0 ? ` · ${queued} more queued` : ''}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-retro-mint/40 overflow-hidden">
          <div className="h-full bg-retro-teal transition-all" style={{ width: `${current?.progress || 0}%` }} />
        </div>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div className="mt-3 flex items-start gap-2 text-xs text-retro-navy/70">
        <Clock size={14} className="text-retro-teal mt-0.5 shrink-0" />
        <span>
          {pending} photo{pending !== 1 ? 's' : ''} on your phone {pending !== 1 ? 'are' : 'is'} not backed up yet —
          turn on auto-backup, or tap a tile in the Photos tab.
        </span>
      </div>
    );
  }

  if (errored > 0) {
    return (
      <div className="mt-3 flex items-start gap-2 text-xs text-retro-red">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          {errored} photo{errored !== 1 ? 's' : ''} failed to upload — tap the tile in the Photos tab to retry.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-retro-navy/70">
      <CheckCircle size={14} className="text-green-700 shrink-0" />
      <span>Your phone's photos are all backed up.</span>
    </div>
  );
}
