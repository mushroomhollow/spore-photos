import { Fragment, useState, useEffect } from 'react';
import {
  X, Lock, Users, Grid3X3, Download, Server, ChevronRight,
} from 'lucide-react';
import ChangePasswordForm from './ChangePasswordForm';
import PreferencesPanel from './PreferencesPanel';
import ServerPanel from './ServerPanel';
import UsersAndAccessPanel from './UsersAndAccessPanel';
import MobilePermissionsPanel from './MobilePermissionsPanel';
import { canConfigureServer } from '../backup/serverAddress';

// Versioned APK filename. Rewritten by spore-photos-mobile/scripts/release-apk.sh.
// A new name every release means a new URL, so Cloudflare can never serve a
// stale cached APK.
const APK_URL = '/apk/spore-photos-v1.9.apk';

/**
 * Android-style settings: a single list of items at the root, and each item
 * opens a sub-screen whose location is shown as a clickable breadcrumb trail
 * ("Settings › Preferences") across the top. Tapping any crumb jumps straight
 * back to that level. No left sidebar — content gets the full width.
 */
export default function SettingsModal({ user, onClose }) {
  // Stack of breadcrumb levels: [{ id, label }]. Empty = at the root list.
  const [path, setPath] = useState([]);

  const canSetAddress = canConfigureServer();
  const items = [
    { id: 'preferences', label: 'Preferences', icon: Grid3X3, description: 'Photo grid size and appearance' },
    // The server address only exists in the Android app; on the web this panel
    // is just photo storage, and only admins can change that.
    ...(canSetAddress || user?.role === 'admin'
      ? [{
          id: 'server',
          label: 'Server',
          icon: Server,
          description: canSetAddress ? 'Server address and photo storage' : 'Photo storage',
        }]
      : []),
    { id: 'change-password', label: 'Change Password', icon: Lock, description: 'Update your account password' },
    { id: 'download-app', label: 'Download App', icon: Download, description: 'Install the Android app' },
  ];
  if (user?.role === 'admin') {
    items.push(
      { id: 'users-access', label: 'Users & Access', icon: Users, description: 'Accounts, devices and invite codes' },
    );
  }

  const current = path.length ? path[path.length - 1] : null;
  const openItem = (item) => setPath((p) => [...p, { id: item.id, label: item.label }]);
  // Jump back to a breadcrumb level: -1 = root, otherwise the path index.
  const goTo = (level) => setPath(level < 0 ? [] : path.slice(0, level + 1));

  // Crumbs = root "Settings" + each path level. The last is the current screen.
  const crumbs = [{ key: 'root', label: 'Settings' }, ...path.map((p, i) => ({ key: p.id, label: p.label, level: i }))];

  const renderSection = (id) => {
    switch (id) {
      case 'preferences': return <PreferencesPanel />;
      case 'server': return <ServerPanel user={user} />;
      case 'change-password': return <ChangePasswordForm />;
      case 'users-access': return <UsersAndAccessPanel />;
      case 'download-app': return <DownloadAppSection />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-retro-white rounded-2xl shadow-2xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden border-2 border-retro-mint"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb bar — clickable trail + close */}
        <div className="flex items-center gap-1 px-4 sm:px-5 py-3 border-b border-retro-mint/30 shrink-0 overflow-x-auto">
          {crumbs.map((crumb, i) => {
            const isCurrent = i === crumbs.length - 1;
            return (
              <Fragment key={crumb.key}>
                {i > 0 && <ChevronRight size={15} className="text-retro-mint/60 shrink-0" />}
                {isCurrent ? (
                  <span className="text-sm font-bold text-retro-navy whitespace-nowrap">{crumb.label}</span>
                ) : (
                  <button
                    onClick={() => goTo(i === 0 ? -1 : crumb.level)}
                    className="text-sm font-semibold text-retro-teal hover:text-retro-navy hover:underline whitespace-nowrap transition-colors"
                  >
                    {crumb.label}
                  </button>
                )}
              </Fragment>
            );
          })}
          <button
            onClick={onClose}
            className="ml-auto p-2 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/20 transition-colors shrink-0"
            title="Close settings"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content — root list or the active sub-screen */}
        <div className="flex-1 overflow-y-auto">
          {current ? (
            renderSection(current.id)
          ) : (
            <div className="divide-y divide-retro-mint/20">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-retro-mint/20 transition-colors text-left"
                  >
                    <Icon size={20} className="text-retro-teal shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-retro-navy">{item.label}</span>
                      {item.description && (
                        <span className="block text-xs text-retro-teal truncate">{item.description}</span>
                      )}
                    </span>
                    <ChevronRight size={18} className="text-retro-mint/60 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DownloadAppSection() {
  // The APK is not in the repository (Android build output). A container image
  // built from source usually has none, so probe before offering a dead link.
  const [apkReady, setApkReady] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(APK_URL, { method: 'HEAD' })
      .then(r => { if (!cancelled) setApkReady(r.ok); })
      .catch(() => { if (!cancelled) setApkReady(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h4 className="text-lg font-bold text-retro-navy flex items-center gap-2">
        <Download size={20} className="text-retro-teal" />
        Download the Android App
      </h4>
      <p className="text-retro-navy/70 text-sm">
        Install the Spore-Photos APK on your Android phone for native DCIM backup
        and background sync.
      </p>

      {apkReady === false ? (
        <p className="text-retro-navy/60 text-sm bg-retro-cream/60 border border-retro-mint/40 rounded-xl px-4 py-3">
          No APK has been published on this server. Drop the built
          <code className="mx-1 font-mono text-xs">spore-photos-v*.apk</code>
          into <code className="mx-1 font-mono text-xs">spore-photos-client/public/apk/</code>
          and rebuild the web app to make it available here.
        </p>
      ) : (
        <a
          href={APK_URL}
          download
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-retro-teal text-white font-semibold text-sm hover:bg-retro-teal/80 transition-colors"
        >
          <Download size={18} />
          Download APK
        </a>
      )}

      <p className="text-retro-navy/50 text-xs">
        Before installing, enable "Install from unknown apps" in your Android
        Settings. You may need to use a file manager to open the downloaded APK.
      </p>

      {/* Native-only: permission status + deep links (renders nothing on web) */}
      <MobilePermissionsPanel />
    </div>
  );
}