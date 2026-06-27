import { useEffect, useState } from 'react';
import { NavBar, type Tab } from './components/NavBar';
import { InstallBanner } from './components/InstallBanner';
import { SlotsScreen } from './screens/SlotsScreen';
import { MyBookingsScreen } from './screens/MyBookingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { loadProfile, isProfileComplete, type Profile } from './lib/profile';
import { ProfileModal } from './components/ProfileModal';
import { saveProfile } from './lib/profile';

export default function App() {
  const [tab, setTab] = useState<Tab>('slots');
  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const need = !isProfileComplete(profile);

  useEffect(() => {
    const sync = () => { void import('./lib/syncGrabbed').then((m) => m.pullGrabbed()).catch(() => {}); };
    sync();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <InstallBanner />
      <div style={{ flex: 1 }}>
        {tab === 'slots' && <SlotsScreen />}
        {tab === 'mybookings' && (profile ? <MyBookingsScreen profile={profile} /> : null)}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'settings' && profile && <SettingsScreen profile={profile} onProfileSaved={(p) => setProfile(p)} />}
      </div>
      <NavBar tab={tab} onChange={setTab} />
      {need && (
        <ProfileModal initial={profile} mode="fill"
          onSave={(p) => { saveProfile(p); setProfile(p); }} />
      )}
    </div>
  );
}
