import { useState, useEffect } from 'react';
import { checkSession, fetchSetupStatus } from './api/client';
import LoginPage from './components/LoginPage';
import SetupPage from './components/SetupPage';
import Dashboard from './components/Dashboard';
import VersionBanner from './components/VersionBanner';

function App() {
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const status = await fetchSetupStatus();
        if (status?.needsSetup) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }
      } catch {
        // Older server without the setup endpoint: fall through to login.
      }

      try {
        const data = await checkSession();
        if (data.authenticated && data.user) setUser(data.user);
      } catch {
        // Not logged in
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-retro-white flex items-center justify-center">
        <div className="text-retro-navy text-xl animate-pulse font-semibold">
          Loading...
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <SetupPage
        onComplete={(userData) => {
          setNeedsSetup(false);
          setUser(userData);
        }}
      />
    );
  }

  if (!user) {
    return <LoginPage onLogin={(userData) => setUser(userData)} />;
  }

  return (
    <>
      <Dashboard user={user} onLogout={() => setUser(null)} />
      <VersionBanner />
    </>
  );
}

export default App;
