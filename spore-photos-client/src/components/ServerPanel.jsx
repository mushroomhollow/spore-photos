import { useEffect, useState } from 'react';
import { Server, Save, RotateCcw, Info, Wifi } from 'lucide-react';
import { canConfigureServer, getServerUrl, setServerUrl, restartApp, testServerUrl } from '../backup/serverAddress';
import StoragePanel from './StoragePanel';
import UpdatePanel from './UpdatePanel';

function isNative() {
  return canConfigureServer();
}

/**
 * Normalize what a user typed into a base URL the app can load from.
 *  - "100.64.1.2:4051"        → http://100.64.1.2:4051  (Tailscale / LAN IP)
 *  - "mybox.tail1234.ts.net"  → https://mybox.tail1234.ts.net
 *  - "http://host:4051/"      → http://host:4051
 *  - ".../api"                → strips the trailing /api (we want the app root)
 */
export function normalizeServerUrl(raw) {
  let v = (raw || '').trim();
  if (!v) return '';

  if (!/^https?:\/\//i.test(v)) {
    const hostPart = v.split('/')[0];
    const hasExplicitPort = /:\d+$/.test(hostPart) || /^\[[^\]]+\]:\d+$/.test(hostPart);
    const looksPrivate = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(hostPart);
    const looksIpv4 = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(hostPart);
    v = (hasExplicitPort || looksPrivate || looksIpv4) ? `http://${v}` : `https://${v}`;
  }

  v = v.replace(/\/+$/, '');
  v = v.replace(/\/api$/i, '');
  return v;
}

export function isValidServerUrl(url) {
  if (!url) return true; // empty = hosted default
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ServerPanel({ user }) {
  const native = isNative();
  const [savedUrl, setSavedUrl] = useState('');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(native);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!native) return;
    (async () => {
      try {
        const current = await getServerUrl();
        setSavedUrl(current);
        setValue(current);
      } catch {
        // Older APK without the plugin method — fall back to the hosted default.
      } finally {
        setLoading(false);
      }
    })();
  }, [native]);

  const handleSave = async () => {
    setError(null);
    const next = normalizeServerUrl(value);
    if (!isValidServerUrl(next)) {
      setError('Enter a valid http:// or https:// server address.');
      return;
    }
    setSaving(true);
    try {
      await setServerUrl(next);
      // Read back before restarting: a write that did not reach disk must not
      // look like success, or the app comes back on the old address.
      const stored = await getServerUrl();
      if (stored !== next) {
        throw new Error(`Save did not persist (stored "${stored}").`);
      }
      await restartApp();
      // The app restarts here; nothing after this runs on the old bridge.
    } catch (e) {
      setError(e?.message || 'Could not save the server address.');
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSaving(true);
    try {
      await setServerUrl('');
      await restartApp();
    } catch (e) {
      setError(e?.message || 'Could not reset the server address.');
      setSaving(false);
    }
  };

  const handleTest = () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    // Paint the "Testing…" state before the synchronous native check.
    setTimeout(() => {
      const result = testServerUrl(normalizeServerUrl(value));
      setTestResult(result ?? 'Connection test is not available in this build.');
      setTesting(false);
    }, 0);
  };

  return (
    <div className="p-6 space-y-8">
      {native && (
        <div>
          <h3 className="text-lg font-bold text-retro-navy flex items-center gap-2 mb-1">
            <Server size={20} className="text-retro-teal" />
            Server Address
          </h3>
          <p className="text-sm text-retro-teal mb-4">
            Point this app at your own Spore-Photos server. It loads the whole app
            (photos, settings and API) from the address you enter, so cookies and
            image URLs keep working normally.
          </p>

          <div className="max-w-lg space-y-3">
            <label className="block text-xs font-semibold text-retro-navy/70" htmlFor="server-url">
              Server base URL
            </label>
            <input
              id="server-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://photos.example.com  or  http://100.64.1.2:4051"
              disabled={loading || saving}
              className="w-full px-3 py-2 rounded-lg border-2 border-retro-mint/60 bg-retro-white text-retro-navy text-sm font-mono focus:outline-none focus:border-retro-teal"
            />

            <div className="text-xs text-retro-navy/60">
              {savedUrl
                ? 'The app loads everything from this address.'
                : 'No server address saved yet.'}
            </div>

            {error && (
              <div className="text-xs text-retro-red bg-retro-red/10 border border-retro-red/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 disabled:opacity-50 transition-colors"
              >
                <Save size={16} />
                {saving ? 'Saving…' : 'Save & Restart'}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || saving || loading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-retro-mint/60 text-retro-navy font-semibold text-sm hover:bg-retro-mint/20 disabled:opacity-40 transition-colors"
              >
                <Wifi size={16} />
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                onClick={handleReset}
                disabled={saving || loading || !savedUrl}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-retro-mint/60 text-retro-navy font-semibold text-sm hover:bg-retro-mint/20 disabled:opacity-40 transition-colors"
              >
                <RotateCcw size={16} />
                Change server
              </button>
            </div>

            {testResult && (
              <div
                className={`text-xs rounded-lg px-3 py-2 border ${
                  testResult.startsWith('HTTP 2')
                    ? 'text-retro-navy bg-retro-mint/20 border-retro-mint/60'
                    : 'text-retro-red bg-retro-red/10 border-retro-red/30'
                }`}
              >
                Connection test: <span className="font-mono">{testResult}</span>
              </div>
            )}

            <div className="flex gap-2 text-xs text-retro-navy/60 bg-retro-mint/15 border border-retro-mint/40 rounded-lg px-3 py-2.5">
              <Info size={14} className="text-retro-teal shrink-0 mt-0.5" />
              <span>
                The app restarts after saving. For a local server, enter its
                reachable address — e.g. <span className="font-mono">http://100.x.y.z:4051</span> for
                a Tailscale IP. The address must serve the Spore-Photos app itself
                (not just <span className="font-mono">/api</span>).
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Version & update check. Shown to every signed-in user: it is
          informational, it contains no machinery, and hiding it would mean only
          admins ever learn an upgrade exists. The release source itself is an
          operator setting in the config file, not something this panel writes. */}
      <div className="border-t border-retro-mint/40 pt-6">
        <UpdatePanel />
      </div>

      {user?.role === 'admin' && (
        <div className="border-t border-retro-mint/40 pt-6">
          <StoragePanel />
        </div>
      )}
    </div>
  );
}