import { useState, useEffect } from 'react';
import {
  X, Link as LinkIcon, Check, Loader2, Share2, UserPlus, UserX,
  Globe, Users,
} from 'lucide-react';
import {
  shareAlbum, revokeAlbumShare,
  sharePhoto, fetchAllUsers, shareAlbumWithUser,
  revokeAlbumUserShare, fetchAlbumSharedUsers,
} from '../api/client';

export default function ShareModal({ type, itemId, onClose }) {
  const [tab, setTab] = useState('public'); // 'public' | 'internal'

  // Public share base URL. Defaults to this app's own origin: the deployment
  // routes /share/ to the public-share service (nginx in prod, the Vite proxy
  // in dev), so no external share host is assumed. An explicit
  // VITE_PUBLIC_SHARE_URL can still point at a separately hosted share server.
  const shareBaseUrl = import.meta.env.VITE_PUBLIC_SHARE_URL || window.location.origin;

  // Public link state
  const [shareUrl, setShareUrl] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareRevoking, setShareRevoking] = useState(false);

  // Internal user share state
  const [allUsers, setAllUsers] = useState([]);
  const [sharedUsers, setSharedUsers] = useState([]);
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sharingUser, setSharingUser] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState(null);

  // Load existing share state on mount
  useEffect(() => {
    if (type === 'album') {
      loadAlbumShareState();
    } else {
      loadPhotoShareState();
    }
    loadUsers();
  }, [type, itemId]);

  const loadAlbumShareState = async () => {
    try {
      // Check for existing public share link
      const data = await shareAlbum(itemId);
      if (data.success && data.url) {
        setShareUrl(shareBaseUrl + data.url);
      }
    } catch {}
    try {
      const data = await fetchAlbumSharedUsers(itemId);
      if (data.users) setSharedUsers(data.users);
    } catch {}
  };

  const loadPhotoShareState = async () => {
    try {
      const data = await sharePhoto(itemId);
      if (data.success && data.url) {
        setShareUrl(shareBaseUrl + data.url);
      }
    } catch {}
  };

  const loadUsers = async () => {
    try {
      const data = await fetchAllUsers();
      if (data.users) setAllUsers(data.users);
    } catch {}
  };

  const handleGenerateLink = async () => {
    if (shareUrl) return; // already have one
    setShareLoading(true);
    try {
      let data;
      if (type === 'album') {
        data = await shareAlbum(itemId);
      } else {
        data = await sharePhoto(itemId);
      }
      if (data.success) {
        setShareUrl(shareBaseUrl + data.url);
      }
    } catch {} finally {
      setShareLoading(false);
    }
  };

  const handleRevokeLink = async () => {
    setShareRevoking(true);
    try {
      if (type === 'album') {
        await revokeAlbumShare(itemId);
      }
      // For single photo share revoke, we'd need an endpoint — for now, clear
      setShareUrl(null);
      setShareCopied(false);
    } catch {} finally {
      setShareRevoking(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleShareWithUser = async () => {
    if (!selectedUserId) return;
    setSharingUser(true);
    try {
      await shareAlbumWithUser(itemId, selectedUserId);
      setUsernameInput('');
      setSelectedUserId('');
      // Reload shared users
      const data = await fetchAlbumSharedUsers(itemId);
      if (data.users) setSharedUsers(data.users);
    } catch {} finally {
      setSharingUser(false);
    }
  };

  const handleRevokeUserShare = async (userId) => {
    setRevokingUserId(userId);
    try {
      await revokeAlbumUserShare(itemId, userId);
      const data = await fetchAlbumSharedUsers(itemId);
      if (data.users) setSharedUsers(data.users);
    } catch {} finally {
      setRevokingUserId(null);
    }
  };

  const unsharedUsers = allUsers.filter(
    u => u.username.toLowerCase().startsWith(usernameInput.toLowerCase())
      && !sharedUsers.some(su => su.user_id === u.id)
  );

  const handleSelectUser = (user) => {
    setUsernameInput(user.display_name || user.username);
    setSelectedUserId(user.id);
    setShowSuggestions(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-retro-cream rounded-2xl border-2 border-retro-mint shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-retro-mint/40">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-retro-navy" />
            <h3 className="text-lg font-bold text-retro-navy">
              Share {type === 'album' ? 'Album' : 'Photo'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-retro-teal hover:text-retro-navy hover:bg-retro-mint/30 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-retro-mint/40">
          <button
            onClick={() => setTab('public')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === 'public'
                ? 'text-retro-navy border-b-2 border-retro-navy bg-retro-mint/10'
                : 'text-retro-teal hover:text-retro-navy hover:bg-retro-mint/10'
            }`}
          >
            <Globe size={15} />
            Public Link
          </button>
          {type === 'album' && (
            <button
              onClick={() => setTab('internal')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                tab === 'internal'
                  ? 'text-retro-navy border-b-2 border-retro-navy bg-retro-mint/10'
                  : 'text-retro-teal hover:text-retro-navy hover:bg-retro-mint/10'
              }`}
            >
              <Users size={15} />
              Share with User
            </button>
          )}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tab === 'public' && (
            <div className="space-y-4">
              <p className="text-sm text-retro-teal">
                Anyone with this link can view the {type === 'album' ? 'album' : 'photo'}.
              </p>

              {shareUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-retro-white rounded-xl border border-retro-mint px-3 py-2.5">
                    <code className="flex-1 text-xs text-retro-navy break-all select-all">
                      {shareUrl}
                    </code>
                    <button
                      onClick={handleCopyUrl}
                      className="shrink-0 p-1.5 rounded-lg bg-retro-navy text-retro-cream hover:bg-retro-teal transition-colors"
                      title={shareCopied ? 'Copied!' : 'Copy link'}
                    >
                      {shareCopied ? <Check size={14} /> : <LinkIcon size={14} />}
                    </button>
                  </div>

                  <button
                    onClick={handleRevokeLink}
                    disabled={shareRevoking}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-retro-red/30 text-retro-red font-semibold text-sm hover:bg-retro-red/10 transition-colors disabled:opacity-50"
                  >
                    {shareRevoking ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <X size={15} />
                    )}
                    Revoke Link
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGenerateLink}
                  disabled={shareLoading}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-retro-navy text-retro-cream font-semibold text-sm hover:bg-retro-teal transition-colors disabled:opacity-50"
                >
                  {shareLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <LinkIcon size={15} />
                  )}
                  Generate Share Link
                </button>
              )}
            </div>
          )}

          {tab === 'internal' && (
            <div className="space-y-4">
              <p className="text-sm text-retro-teal">
                Share this album with specific users. Only you and the users you share with will see these albums.
              </p>

              {/* User picker — type to search */}
              <div className="relative flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={e => {
                      setUsernameInput(e.target.value);
                      setSelectedUserId('');
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="Type a username..."
                    className="w-full bg-retro-white border border-retro-mint rounded-xl px-3 py-2.5 text-sm text-retro-navy placeholder:text-retro-mint focus:outline-none focus:ring-2 focus:ring-retro-teal/40"
                  />
                  {showSuggestions && usernameInput.length > 0 && unsharedUsers.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-retro-white border border-retro-mint rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                      {unsharedUsers.map(u => (
                        <button
                          key={u.id}
                          onMouseDown={() => handleSelectUser(u)}
                          className="w-full text-left px-3 py-2 text-sm text-retro-navy hover:bg-retro-mint/20 transition-colors flex items-center gap-2"
                        >
                          <span className="font-medium">{u.display_name || u.username}</span>
                          {u.display_name && (
                            <span className="text-retro-teal text-xs">@{u.username}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {showSuggestions && usernameInput.length > 0 && unsharedUsers.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-retro-white border border-retro-mint rounded-xl shadow-lg z-10 py-3 px-3 text-sm text-retro-teal text-center">
                      No matching users found
                    </div>
                  )}
                </div>
                <button
                  onClick={handleShareWithUser}
                  disabled={!selectedUserId || sharingUser}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-retro-teal text-retro-cream font-semibold text-sm hover:bg-retro-navy transition-colors disabled:opacity-50 shrink-0"
                >
                  {sharingUser ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <UserPlus size={15} />
                  )}
                  Share
                </button>
              </div>

              {/* Shared users list */}
              {sharedUsers.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-retro-teal uppercase tracking-wider">
                    Shared with ({sharedUsers.length})
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {sharedUsers.map(su => (
                      <div
                        key={su.user_id}
                        className="flex items-center justify-between bg-retro-white rounded-xl border border-retro-mint/50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-retro-navy truncate">
                            {su.display_name || su.username}
                          </p>
                          <p className="text-xs text-retro-teal">
                            @{su.username}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRevokeUserShare(su.user_id)}
                          disabled={revokingUserId === su.user_id}
                          className="shrink-0 p-1.5 rounded-lg text-retro-red/60 hover:text-retro-red hover:bg-retro-red/10 transition-colors disabled:opacity-50"
                          title="Remove access"
                        >
                          {revokingUserId === su.user_id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <UserX size={14} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 bg-retro-white rounded-xl border border-retro-mint/30">
                  <Users size={32} className="text-retro-mint mx-auto mb-2" />
                  <p className="text-sm text-retro-teal">No users have been shared with yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
