import { useState, useEffect } from 'react';
import {
  Camera, LogOut, Image, Users, Settings, Upload, FolderOpen,
  HardDrive, Share2,
} from 'lucide-react';
import { logout, fetchStats } from '../api/client';
import * as localStore from '../backup/localStore';
import AutoBackupSetting from './AutoBackupSetting';
import SettingsModal from './SettingsModal';
import UploadZone from './UploadZone';
import LibraryTools from './LibraryTools';
import PhotoGallery from './PhotoGallery';
import AlbumsPage from './AlbumsPage';
import SharedAlbumsPage from './SharedAlbumsPage';

const navItems = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'photos', label: 'Photos', icon: Image },
  { id: 'albums', label: 'Albums', icon: FolderOpen },
  { id: 'shared-albums', label: 'Shared Albums', icon: Share2 },
];

export default function Dashboard({ user, onLogout }) {
  const [activePage, setActivePage] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchStats();
        setStats(data);
      } catch {}
    })();
  }, [galleryRefresh]);

  // Phone-photo backup: run when the app opens, and again on foreground resume.
  // Off-Android these are no-ops.
  useEffect(() => {
    localStore.init();
    if (localStore.isEnabled()) localStore.runAutoBackup();
    else localStore.refresh();

    const onVisible = () => {
      if (document.visibilityState === 'visible' && localStore.isEnabled()) {
        localStore.runAutoBackup();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      // ignore
    }
    onLogout();
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
      default:
        const pc = stats?.photo_count ?? 0;
        const ac = stats?.album_count ?? 0;
        const sb = stats?.storage_bytes ?? 0;
        const maxB = stats?.storage_max_bytes ?? 100 * 1024 * 1024 * 1024;
        const pct = maxB > 0 ? ((sb / maxB) * 100).toFixed(1) : 0;
        const storageStr = sb === 0 ? '0 B' : sb < 1024 ? `${sb} B` : sb < 1024 * 1024 ? `${(sb / 1024).toFixed(0)} KB` : sb < 1024 * 1024 * 1024 ? `${(sb / (1024 * 1024)).toFixed(1)} MB` : `${(sb / (1024 * 1024 * 1024)).toFixed(1)} GB`;

        return (
          <div className="h-full overflow-y-auto">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-retro-cream rounded-2xl p-6 border-2 border-retro-mint shadow-md">
                <div className="flex items-center gap-3 mb-2">
                  <Image size={24} className="text-retro-teal" />
                  <h3 className="text-retro-navy font-bold text-lg">Photos</h3>
                </div>
                <p className="text-3xl font-bold text-retro-navy">{pc}</p>
                <p className="text-retro-teal text-sm">photos uploaded</p>
              </div>

              <div className="bg-retro-cream rounded-2xl p-6 border-2 border-retro-mint shadow-md">
                <div className="flex items-center gap-3 mb-2">
                  <FolderOpen size={24} className="text-retro-teal" />
                  <h3 className="text-retro-navy font-bold text-lg">Albums</h3>
                </div>
                <p className="text-3xl font-bold text-retro-navy">{ac}</p>
                <p className="text-retro-teal text-sm">albums created</p>
              </div>

              <div className="bg-retro-cream rounded-2xl p-6 border-2 border-retro-mint shadow-md">
                <div className="flex items-center gap-3 mb-2">
                  <HardDrive size={24} className="text-retro-teal" />
                  <h3 className="text-retro-navy font-bold text-lg">Storage</h3>
                </div>
                <p className="text-3xl font-bold text-retro-navy">{storageStr}</p>
                <p className="text-retro-teal text-sm">
                  of 100 GB used
                  {pct > 0 && <span className="ml-1">({pct}%)</span>}
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-retro-mint/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-retro-teal transition-all"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Welcome placeholder */}
            <div className="bg-retro-cream rounded-2xl p-12 border-2 border-retro-mint shadow-md text-center">
              <Camera size={64} className="text-retro-teal mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-retro-navy mb-2">
                Welcome to Spore-Photos
              </h2>
              <p className="text-retro-teal max-w-md mx-auto">
                Your private photo vault is ready. Upload photos, create albums,
                and organize your memories.
              </p>
            </div>
          </div>
        );

      case 'upload':
        return (
          <div className="h-full overflow-y-auto">
            <h2 className="text-xl font-bold text-retro-navy mb-4">Upload Photos</h2>
            <UploadZone onUploadComplete={() => setGalleryRefresh(n => n + 1)} />
            <LibraryTools onComplete={() => setGalleryRefresh(n => n + 1)} />
            <AutoBackupSetting />
          </div>
        );

      case 'photos':
        return (
          <div className="h-full flex flex-col min-h-0">
            <h2 className="text-xl font-bold text-retro-navy mb-4 shrink-0">Photos</h2>
            <div className="flex-1 min-h-0">
              <PhotoGallery refreshTrigger={galleryRefresh} />
            </div>
          </div>
        );

      case 'albums':
        return (
          <div className="h-full flex flex-col min-h-0">
            <h2 className="text-xl font-bold text-retro-navy mb-4 shrink-0">Albums</h2>
            <div className="flex-1 min-h-0">
              <AlbumsPage refreshTrigger={galleryRefresh} />
            </div>
          </div>
        );

      case 'shared-albums':
        return (
          <div className="h-full flex flex-col min-h-0">
            <h2 className="text-xl font-bold text-retro-navy mb-4 shrink-0">Shared Albums</h2>
            <div className="flex-1 min-h-0">
              <SharedAlbumsPage />
            </div>
          </div>
        );
    }
  };

  const pageLabels = {
    dashboard: 'Dashboard',
    upload: 'Upload',
    photos: 'Photos',
    albums: 'Albums',
    'shared-albums': 'Shared Albums',
  };

  return (
    <div className="h-dvh bg-retro-white flex flex-col md:flex-row">
      {/* ── Desktop Sidebar ── */}
      <nav className="hidden md:flex md:w-60 md:shrink-0 bg-retro-navy flex-col shadow-lg">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-retro-teal/30">
          <Camera size={24} className="text-retro-cream" />
          <span className="text-retro-cream text-lg font-bold tracking-tight">
            Spore-Photos
          </span>
          {import.meta.env.VITE_SHOW_DEV_BADGE === 'true' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-retro-orange text-retro-white ml-auto">
              DEV
            </span>
          )}
        </div>

        {/* Nav Links */}
        <div className="flex-1 space-y-1 px-3 py-4">
          <button
            onClick={() => setActivePage('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left ${
              activePage === 'dashboard'
                ? 'bg-retro-teal/30 text-retro-cream'
                : 'text-retro-mint/70 hover:text-retro-cream hover:bg-retro-teal/20'
            }`}
          >
            <Camera size={18} />
            Dashboard
          </button>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left ${
                  isActive
                    ? 'bg-retro-teal/30 text-retro-cream'
                    : 'text-retro-mint/70 hover:text-retro-cream hover:bg-retro-teal/20'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Bottom spacer */}
        <div className="px-3 py-4 border-t border-retro-teal/30" />
      </nav>

      {/* ── Main column: top-bar + content + mobile-tab ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top bar — always visible */}
        <header className="shrink-0 bg-retro-cream/40 px-4 md:px-6 py-2.5 md:py-3 border-b border-retro-mint/30 flex items-center justify-between">
          <h1 className="text-base md:text-lg font-bold text-retro-navy capitalize">
            {activePage === 'dashboard' ? 'Dashboard' : pageLabels[activePage] || activePage}
          </h1>
          <div className="flex items-center gap-1.5 md:gap-3">
            <span className="hidden sm:inline text-retro-teal text-sm">
              <strong className="text-retro-navy">{user.display_name || user.username}</strong>
            </span>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 md:p-2 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/20 transition-colors"
              title="Settings"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-lg bg-retro-teal/20 text-retro-navy hover:bg-retro-teal/40 transition-colors text-xs md:text-sm font-semibold"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Scrollable content — fills remaining space between top bar and tab bar */}
        <main className="flex-1 overflow-hidden p-4 md:p-6">
          {renderPage()}
        </main>

        {/* ── Mobile Bottom Tab Bar (natural flow, not fixed) ── */}
        <nav className="md:hidden shrink-0 bg-retro-navy border-t border-retro-teal/30"
             style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-center justify-around px-2 h-14">
            <button
              onClick={() => setActivePage('dashboard')}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 rounded-lg transition-colors min-w-0 h-full ${
                activePage === 'dashboard'
                  ? 'text-retro-cream'
                  : 'text-retro-mint/60 hover:text-retro-cream'
              }`}
            >
              <Camera size={20} />
              <span className="text-[10px] font-semibold leading-tight">Home</span>
            </button>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  className={`flex flex-col items-center justify-center gap-0.5 px-2 rounded-lg transition-colors min-w-0 h-full ${
                    isActive
                      ? 'text-retro-cream'
                      : 'text-retro-mint/60 hover:text-retro-cream'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal user={user} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
