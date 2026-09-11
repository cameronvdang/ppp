import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CalendarScreen } from './components/CalendarScreen'
import { RecordsReturnHandler } from './components/RecordsReturnHandler'
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
import { PerimenopauseScreen } from './screens/PerimenopauseScreen'
import { PregnancyDetailScreen } from './screens/PregnancyDetailScreen'
import { TrackerCustomizeScreen } from './screens/TrackerCustomizeScreen'
import { TtcDetailScreen } from './screens/TtcDetailScreen'
import { useApp } from './state/appStore'

const AssistantScreen = lazy(() => import('./components/AssistantScreen').then(m => ({ default: m.AssistantScreen })))
const DoctorReport = lazy(() => import('./components/DoctorReport').then(m => ({ default: m.DoctorReport })))
const CycleReportScreen = lazy(() => import('./screens/CycleReportScreen').then(m => ({ default: m.CycleReportScreen })))
const RecordsScreen = lazy(() => import('./screens/RecordsScreen').then(m => ({ default: m.RecordsScreen })))
const RecordsCategoryList = lazy(() => import('./components/RecordsCategoryList').then(m => ({ default: m.RecordsCategoryList })))

export default function App() {
  const {
    recordsCategory,
    setRecordsCategory,
    recordsReturn,
    tab,
    setTab,
    sheetDate,
    sheetFocus,
    closeSheet,
    calendarOpen,
    setCalendarOpen,
    assistantOpen,
    setAssistantOpen,
    reportOpen,
    setReportOpen,
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
      console.error('[PPP startup] Could not persist the health profile migration.', error)
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
  if (screen === 'loading') return <div className="page page-loading" role="status" aria-label="Loading PPP" />
  if (screen === 'onboarding') return <Onboarding onDone={() => setOnboarded(true)} />
  if (screen === 'locked') return <PinLock />

  return (
    <>
      <main>
        {tab === 'today' && <Today />}
        {tab === 'insights' && <Insights />}
        {tab === 'graphs' && <Graphs />}
        {tab === 'records' && <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}> <RecordsScreen /> </Suspense>}
        {tab === 'settings' && (
          <Settings
            onPinPresenceChange={(hasPin) => { hasPinRef.current = hasPin }}
            onDeleteAllData={deleteAllData}
          />
        )}
      </main>
      {recordsReturn && <RecordsReturnHandler params={recordsReturn} />}
      {recordsCategory && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close category" onClick={() => setRecordsCategory(null)} />
          <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}> <RecordsCategoryList category={recordsCategory} onBack={() => setRecordsCategory(null)} /> </Suspense>
        </>
      )}
      <TabBar active={tab} onChange={setTab} />

      {sheetDate && (
        <LogSheet date={sheetDate} initialFocus={sheetFocus ?? undefined} onClose={closeSheet} />
      )}
      {calendarOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close calendar" onClick={() => setCalendarOpen(false)} />
          <CalendarScreen />
        </>
      )}
      {assistantOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close assistant" onClick={() => setAssistantOpen(false)} />
          <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}> <AssistantScreen /> </Suspense>
        </>
      )}
      {reportOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close report" onClick={() => setReportOpen(false)} />
          <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}> <DoctorReport /> </Suspense>
        </>
      )}
      {cycleReportOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close cycle report" onClick={() => setCycleReportOpen(false)} />
          <Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}> <CycleReportScreen onBack={() => setCycleReportOpen(false)} /> </Suspense>
        </>
      )}
      {pregnancyDetailOpen && flags?.pregnancyDating && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close pregnancy guide" onClick={() => setPregnancyDetailOpen(false)} />
          <PregnancyDetailScreen
            dating={flags.pregnancyDating}
            onBack={() => setPregnancyDetailOpen(false)}
          />
        </>
      )}
      {perimenopauseOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close perimenopause view" onClick={() => setPerimenopauseOpen(false)} />
          <PerimenopauseScreen onBack={() => setPerimenopauseOpen(false)} />
        </>
      )}
      {ttcDetailOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close fertility view" onClick={() => setTtcDetailOpen(false)} />
          <TtcDetailScreen onBack={() => setTtcDetailOpen(false)} />
        </>
      )}
      {trackerCustomizeOpen && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close without saving" onClick={() => setTrackerCustomizeOpen(false)} />
          <TrackerCustomizeScreen onBack={() => setTrackerCustomizeOpen(false)} />
        </>
      )}
      {articleSlug && (
        <>
          <button type="button" className="dialog-scrim" tabIndex={-1} aria-label="Close article" onClick={() => setArticleSlug(null)} />
          <ArticleScreen slug={articleSlug} onClose={() => setArticleSlug(null)} />
        </>
      )}
    </>
  )
}
