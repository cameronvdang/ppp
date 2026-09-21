import { create } from 'zustand'
import type { RecordCategory } from '../records/types'
import type { ReturnParams } from '../records/returnHandler'
import type { Tab } from '../components/TabBar'

export type TrackerFocus = 'flow' | 'symptoms' | 'intimacy'

interface AppState {
  launchAction: 'log' | null
  setLaunchAction: (action: 'log' | null) => void
  recordsCategory: RecordCategory | null
  setRecordsCategory: (category: RecordCategory | null) => void
  recordsReturn: ReturnParams | null
  setRecordsReturn: (params: ReturnParams | null) => void
  recordsNotice: string | null
  setRecordsNotice: (notice: string | null) => void
  tab: Tab
  setTab: (t: Tab) => void
  /** Date the log sheet is open for, or null when closed. */
  sheetDate: string | null
  /** Optional tracker section requested by a contextual quick action. */
  sheetFocus: TrackerFocus | null
  openSheet: (date: string, focus?: TrackerFocus) => void
  closeSheet: () => void
  calendarOpen: boolean
  setCalendarOpen: (open: boolean) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  reportOpen: boolean
  setReportOpen: (open: boolean) => void
  cycleReportOpen: boolean
  setCycleReportOpen: (open: boolean) => void
  pregnancyDetailOpen: boolean
  setPregnancyDetailOpen: (open: boolean) => void
  perimenopauseOpen: boolean
  setPerimenopauseOpen: (open: boolean) => void
  ttcDetailOpen: boolean
  setTtcDetailOpen: (open: boolean) => void
  trackerCustomizeOpen: boolean
  setTrackerCustomizeOpen: (open: boolean) => void
  locked: boolean
  setLocked: (locked: boolean) => void
  articleSlug: string | null
  setArticleSlug: (slug: string | null) => void
}

export const useApp = create<AppState>((set) => ({
  launchAction: null,
  setLaunchAction: (launchAction) => set({ launchAction }),
  recordsCategory: null,
  setRecordsCategory: (recordsCategory) => set({ recordsCategory }),
  recordsReturn: null,
  setRecordsReturn: (recordsReturn) => set({ recordsReturn }),
  recordsNotice: null,
  setRecordsNotice: (recordsNotice) => set({ recordsNotice }),
  tab: 'today',
  setTab: (tab) => set({ tab }),
  sheetDate: null,
  sheetFocus: null,
  openSheet: (sheetDate, sheetFocus) => set({ sheetDate, sheetFocus: sheetFocus ?? null }),
  closeSheet: () => set({ sheetDate: null, sheetFocus: null }),
  calendarOpen: false,
  setCalendarOpen: (calendarOpen) => set({ calendarOpen }),
  assistantOpen: false,
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  reportOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen }),
  cycleReportOpen: false,
  setCycleReportOpen: (cycleReportOpen) => set({ cycleReportOpen }),
  pregnancyDetailOpen: false,
  setPregnancyDetailOpen: (pregnancyDetailOpen) => set({ pregnancyDetailOpen }),
  perimenopauseOpen: false,
  setPerimenopauseOpen: (perimenopauseOpen) => set({ perimenopauseOpen }),
  ttcDetailOpen: false,
  setTtcDetailOpen: (ttcDetailOpen) => set({ ttcDetailOpen }),
  trackerCustomizeOpen: false,
  setTrackerCustomizeOpen: (trackerCustomizeOpen) => set({ trackerCustomizeOpen }),
  locked: false,
  setLocked: (locked) => set({ locked }),
  articleSlug: null,
  setArticleSlug: (articleSlug) => set({ articleSlug }),
}))
