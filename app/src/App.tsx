import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { AssistantScreen } from './components/AssistantScreen'
import { CalendarScreen } from './components/CalendarScreen'
import { DoctorReport } from './components/DoctorReport'
import { DataWipeRecovery } from './components/DataWipeRecovery'
import { LogSheet } from './components/LogSheet'
import { PinLock } from './components/PinLock'
import { TabBar } from './components/TabBar'
import { ensureHealthProfile, getHealthProfile, getSetting, SK } from './db/schema'
import { resolvePregnancyDating } from './engine/pregnancyDating'
import { ArticleScreen } from './screens/ArticleScreen'
import { Graphs } from './screens/Graphs'
import { Insights } from './screens/Insights'
import { Onboarding } from './screens/Onboarding'
import { Settings } from './screens/Settings'
import { Today } from './screens/Today'
import { appScreen, initializeSessionLock, lockHiddenSession, syncPinPresence } from './lib/lockSession'
import { runDataWipe, type DataWipeState } from './lib/dataWipe'
import {
  CycleReportScreen,
  PerimenopauseScreen,
  PregnancyDetailScreen,
  TrackerCustomizeScreen,
  TtcDetailScreen,
} from './screens/healthFeatures'
import { useApp } from './state/appStore'

export default function App() {
  const {
    tab,
    setTab,
    sheetDate,
    sheetFocus,
    closeSheet,
    calendarOpen,
    assistantOpen,
    reportOpen,
    cycleReportOpen,
    setCycleReportOpen,
    pregnancyDetailOpen,
    setPregnancyDetailOpen,
    perimenopauseOpen,
    setPerimenopauseOpen,
    ttcDetailOpen,
    setTtcDetailOpen,
    trackerCustomizeOpen,
    setTrackerCustomizeOpen,
    locked,
    setLocked,
    articleSlug,
    setArticleSlug,
  } = useApp()

  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [wipeState, setWipeState] = useState<DataWipeState>({ status: 'idle' })

  useEffect(() => {
    // Persist legacy/fresh-install profile state outside Dexie's read-only
    // liveQuery context. getHealthProfile remains safe to call reactively.
    void ensureHealthProfile().catch((error: unknown) => {
      console.error('[Lunara startup] Could not persist the health profile migration.', error)
    })
  }, [])

  const flags = useLiveQuery(async () => {
    const [ob, pin, legacyPregnancyLmp, profile] = await Promise.all([
      getSetting(SK.onboarded),
      getSetting(SK.pinHash),
      getSetting(SK.pregnancyLMP),
      getHealthProfile(),
    ])
    const pregnancyLmp = profile.reproductive.pregnancyLmp ?? legacyPregnancyLmp
    const pregnancyDating =
      (profile.reproductive.pregnancyDating
        ? resolvePregnancyDating({
            method: profile.reproductive.pregnancyDating.method,
            date: profile.reproductive.pregnancyDating.inputDate,
            clinicianConfirmed:
              profile.reproductive.pregnancyDating.authority === 'clinician-assigned',
          })
        : undefined) ??
      (pregnancyLmp
        ? resolvePregnancyDating({
            method: 'lmp',
            date: pregnancyLmp,
          })
        : undefined)
    return { ob: ob === '1', hasPin: !!pin, pregnancyDating }
  }, [])

  const hasPinRef = useRef(false)
  const observedPinRef = useRef<boolean | undefined>(undefined)
  const initialLockDone = useRef(false)
  syncPinPresence(flags?.hasPin, observedPinRef, hasPinRef)
  const flagsReady = flags !== undefined

  // Decide the initial lock before marking the UI ready, so protected content
  // cannot paint for one frame between profile loading and the lock effect.
  useEffect(() => {
    initializeSessionLock(flagsReady, initialLockDone, hasPinRef, setLocked)
  }, [flagsReady, setLocked])

  useEffect(() => {
    if (flags === undefined) return
    setOnboarded(flags.ob)
    setReady(true)
  }, [flags])

  useEffect(() => {
    const onVisibility = () => lockHiddenSession(document.visibilityState, hasPinRef, setLocked)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [setLocked])

  const screen = appScreen(ready, onboarded, locked, wipeState.status !== 'idle')
  const deleteAllData = () => { void runDataWipe(setWipeState) }
  if (screen === 'wipe' && wipeState.status !== 'idle') {
    return <DataWipeRecovery state={wipeState} onRetry={deleteAllData} />
  }
  if (screen === 'loading') return <div className="page page-loading" role="status" aria-label="Loading Lunara" />
  if (screen === 'onboarding') return <Onboarding onDone={() => setOnboarded(true)} />
  if (screen === 'locked') return <PinLock />

  return (
    <>
      <main>
        {tab === 'today' && <Today />}
        {tab === 'insights' && <Insights />}
        {tab === 'graphs' && <Graphs />}
        {tab === 'settings' && (
          <Settings
            onPinPresenceChange={(hasPin) => { hasPinRef.current = hasPin }}
            onDeleteAllData={deleteAllData}
          />
        )}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {sheetDate && (
        <LogSheet date={sheetDate} initialFocus={sheetFocus ?? undefined} onClose={closeSheet} />
      )}
      {calendarOpen && <CalendarScreen />}
      {assistantOpen && <AssistantScreen />}
      {reportOpen && <DoctorReport />}
      {cycleReportOpen && <CycleReportScreen onBack={() => setCycleReportOpen(false)} />}
      {pregnancyDetailOpen && flags?.pregnancyDating && (
        <PregnancyDetailScreen
          dating={flags.pregnancyDating}
          onBack={() => setPregnancyDetailOpen(false)}
        />
      )}
      {perimenopauseOpen && <PerimenopauseScreen onBack={() => setPerimenopauseOpen(false)} />}
      {ttcDetailOpen && <TtcDetailScreen onBack={() => setTtcDetailOpen(false)} />}
      {trackerCustomizeOpen && (
        <TrackerCustomizeScreen onBack={() => setTrackerCustomizeOpen(false)} />
      )}
      {articleSlug && <ArticleScreen slug={articleSlug} onClose={() => setArticleSlug(null)} />}
    </>
  )
}
