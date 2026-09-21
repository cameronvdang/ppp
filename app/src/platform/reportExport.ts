export interface ReportExportDependencies {
  browserPrint?: () => void
}

/** Web build: the browser print dialog is the export surface. */
export async function exportCurrentReport(
  _jobName = 'PPP cycle report',
  dependencies: ReportExportDependencies = {},
): Promise<void> {
  const browserPrint = dependencies.browserPrint ?? (() => window.print())
  browserPrint()
}
