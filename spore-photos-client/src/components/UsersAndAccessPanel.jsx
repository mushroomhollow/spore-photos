import { useState } from 'react';
import { Users, Key } from 'lucide-react';
import UserManager from './UserManager';
import AccessCodeManager from './AccessCodeManager';

/**
 * One settings destination for both account/device management and invite
 * codes. Previously these were two separate root-level settings entries;
 * they're closely related (both about who can access the server), so they
 * live behind one segmented control instead of two top-level tabs.
 */
export default function UsersAndAccessPanel() {
  const [tab, setTab] = useState('users');

  const tabs = [
    { id: 'users', label: 'Users & Devices', icon: Users },
    { id: 'codes', label: 'Access Codes', icon: Key },
  ];

  return (
    <div>
      <div className="flex gap-2 px-4 sm:px-5 py-3 border-b border-retro-mint/30">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? 'bg-retro-teal text-white'
                  : 'text-retro-teal hover:bg-retro-mint/20'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'users' ? <UserManager /> : <AccessCodeManager />}
    </div>
  );
}
