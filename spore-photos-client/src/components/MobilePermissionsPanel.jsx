import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw, ExternalLink } from 'lucide-react';
import {
  getPermissionState,
  openAppPermissions,
  openAllFilesAccessSettings,
  isNative,
} from '../backup/nativeFiles';

/**
 * Permission status for the native shell, shown inside Settings → Download App.
 * Lists the two permissions the app needs and links straight to the relevant
 * Android Settings screen when one is missing. Renders nothing on the web.
 */
export default function MobilePermissionsPanel() {
  const [state, setState] = useState(null);

  const refresh = useCallback(async () => {
    setState(await getPermissionState());
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    refresh();
    // Re-check when the user returns from the Settings screen they were sent to.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  if (!isNative() || !state) return null;

  const mediaOk = state.media === 'granted';
  const allOk = state.allFilesAccess;
  const allGranted = mediaOk && allOk;

  return (
    <div className="rounded-xl border-2 border-retro-mint bg-retro-cream/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="font-bold text-retro-navy">App permissions</h5>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-retro-teal hover:text-retro-navy hover:bg-retro-mint/30 transition-colors"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {allGranted ? (
        <div className="flex items-center gap-2 text-sm text-retro-teal">
          <ShieldCheck size={16} />
          <span className="font-semibold">All permissions granted</span>
        </div>
      ) : (
        <p className="text-xs text-retro-navy/70">
          Some permissions are missing. Grant them so the app can back up and
          manage your phone's photos.
        </p>
      )}

      <div className="space-y-2">
        <PermissionRow
          ok={mediaOk}
          label="Photos & media"
          hint="Scan and back up the camera roll"
          onOpen={openAppPermissions}
        />
        <PermissionRow
          ok={allOk}
          label="All files access"
          hint="Delete a photo's local copy when it's deleted from the server"
          onOpen={openAllFilesAccessSettings}
        />
      </div>
    </div>
  );
}

function PermissionRow({ ok, label, hint, onOpen }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-retro-white/70 px-3 py-2.5">
      <div className="min-w-0">
        <div className={`flex items-center gap-2 text-sm font-semibold ${ok ? 'text-retro-teal' : 'text-retro-red'}`}>
          {ok ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
          <span className="truncate">{label}</span>
        </div>
        <p className="text-xs text-retro-navy/60 truncate">{hint}</p>
      </div>
      {ok ? (
        <span className="text-xs font-semibold text-retro-teal shrink-0">Granted</span>
      ) : (
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-retro-teal text-retro-white text-xs font-semibold hover:bg-retro-teal/80 transition-colors shrink-0"
        >
          <ExternalLink size={13} />
          Open settings
        </button>
      )}
    </div>
  );
}