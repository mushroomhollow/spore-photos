import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { healthCheck } from '../api/client';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/**
 * Warns when the web bundle and the API are on different releases — after a
 * partial upgrade the UI can be talking to an older server (or the server is
 * older than the bundle), which produces confusing, hard-to-diagnose failures.
 */
export default function VersionBanner() {
  const [serverVersion, setServerVersion] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    healthCheck()
      .then((data) => {
        if (active && data?.version) setServerVersion(data.version);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (dismissed || !serverVersion) return null;
  if (serverVersion === APP_VERSION) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,40rem)]">
      <div className="flex items-start gap-3 rounded-xl border-2 border-retro-orange/50 bg-retro-cream px-4 py-3 shadow-lg">
        <AlertTriangle size={18} className="text-retro-orange shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-sm text-retro-navy">
          <span className="font-semibold">Version mismatch.</span>{' '}
          Server is running <span className="font-mono">v{serverVersion}</span>, this
          web app is <span className="font-mono">v{APP_VERSION}</span>. Update whichever
          is behind.
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg text-retro-navy/50 hover:text-retro-navy hover:bg-retro-mint/30 transition-colors shrink-0"
          title="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}