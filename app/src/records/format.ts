const recordDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

/** Use UTC so date-only provider values never shift to the previous day. */
export function formatRecordDate(value: string | null): string {
  if (value === null) return 'Date not supplied'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : recordDate.format(date)
}
