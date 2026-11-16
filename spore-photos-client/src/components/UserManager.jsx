import { useState, useEffect } from 'react';
import { User, ChevronRight, Calendar, Clock, Shield } from 'lucide-react';
import { fetchUsers } from '../api/client';
import UserDetail from './UserDetail';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function UserManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchUsers();
      setUsers(data.users || []);
      setError(null);
    } catch (e) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  if (selectedUser) {
    return <UserDetail user={selectedUser} onBack={() => setSelectedUser(null)} />;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-retro-navy flex items-center gap-2">
          <User size={24} />
          User Management
        </h2>
        <p className="text-retro-teal text-sm mt-1">
          Manage users, their devices and the addresses they connect from
        </p>
      </div>

      {error && (
        <div className="bg-retro-red/10 border border-retro-red/30 rounded-xl p-3 text-retro-red text-sm mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-retro-teal animate-pulse">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <User size={48} className="text-retro-mint mx-auto mb-3" />
          <p className="text-retro-teal text-lg">No users found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u)}
              className="w-full text-left rounded-xl p-4 border-2 border-retro-mint bg-retro-cream hover:bg-retro-cream/80 hover:shadow-md transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                  u.role === 'admin'
                    ? 'bg-retro-navy text-retro-cream'
                    : 'bg-retro-teal text-retro-white'
                }`}>
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-retro-navy">{u.display_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      u.role === 'admin'
                        ? 'bg-retro-navy/10 text-retro-navy'
                        : 'bg-retro-teal/20 text-retro-teal'
                    }`}>
                      {u.role}
                    </span>
                    {!u.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-retro-red/20 text-retro-red font-semibold">Disabled</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-retro-teal mt-0.5">
                    <span>@{u.username}</span>
                    <span className="flex items-center gap-1">
                      <Calendar size={11} />
                      Joined {formatDate(u.created_at)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-xs text-retro-teal">
                  {u.last_login ? (
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {timeAgo(u.last_login)}
                    </span>
                  ) : (
                    <span className="text-retro-mint">Never logged in</span>
                  )}
                </div>
                <ChevronRight size={18} className="text-retro-mint group-hover:text-retro-teal transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
