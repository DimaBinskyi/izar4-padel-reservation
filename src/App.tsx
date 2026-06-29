import { useEffect, useState } from 'react';
import { NavBar, type Tab } from './components/NavBar';
import { InstallBanner } from './components/InstallBanner';
import { SlotsScreen } from './screens/SlotsScreen';
import { MyBookingsScreen } from './screens/MyBookingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { loadProfile, type Profile } from './lib/profile';
import { pruneExpiredWatches } from './lib/watchlist';

export default function App() {
  const [tab, setTab] = useState<Tab>('slots');
  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [slotFocus, setSlotFocus] = useState<{ fecha: string; slot: string } | null>(null);

  useEffect(() => {
    const onForeground = () => {
      pruneExpiredWatches();   // drop date-passed watches locally
      void import('./lib/syncGrabbed').then((m) => m.pullGrabbed())                       // pull auto-grabs (clears grabbed watches)
        .then(() => import('./lib/pushClient').then((m) => m.syncRegistration()))          // push the cleaned watchlist to the worker
        .catch(() => {});
    };
    onForeground();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onForeground(); });
  }, []);

  // Deep link from a tapped push notification → open the Slots tab on that date and blink the slot.
  useEffect(() => {
    // Cold start: the SW opened `/?fecha=YYYYMMDD&slot=P1-6`. Consume it, then clean the URL.
    const q = new URLSearchParams(window.location.search);
    const fecha = q.get('fecha'); const slot = q.get('slot');
    if (fecha && slot) {
      setSlotFocus({ fecha, slot }); setTab('slots');
      window.history.replaceState(null, '', window.location.pathname);
    }
    // Already open: the SW posts the target (a window focus() alone wouldn't move the SPA).
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'padel-focus-slot' && e.data.fecha && e.data.slot) {
        setSlotFocus({ fecha: e.data.fecha, slot: e.data.slot }); setTab('slots');
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, []);

  // The Slots tab owns the mandatory first-run profile modal (it blocks the screen until filled).
  // Re-read the profile from storage on every tab switch so other tabs see the saved profile.
  function go(x: Tab) { setProfile(loadProfile()); setTab(x); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingTop: 'env(safe-area-inset-top)' }}>
      <InstallBanner />
      <div style={{ flex: 1 }}>
        {tab === 'slots' && <SlotsScreen focus={slotFocus} onFocusConsumed={() => setSlotFocus(null)} />}
        {tab === 'mybookings' && (profile ? (
          <MyBookingsScreen profile={profile}
            onOpenSlot={(fecha, slot) => { setSlotFocus({ fecha, slot }); setTab('slots'); }} />
        ) : null)}
        {tab === 'stats' && <StatsScreen profile={profile} />}
        {tab === 'settings' && profile && <SettingsScreen profile={profile} onProfileSaved={(p) => setProfile(p)} />}
      </div>
      <NavBar tab={tab} onChange={go} />
    </div>
  );
}
