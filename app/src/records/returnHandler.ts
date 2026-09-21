export interface ReturnParams { isReturn: boolean; sessionId: string | null; invalidSession: boolean }
export function readReturnParams(search: string): ReturnParams {
  const params = new URLSearchParams(search)
  const ids = params.getAll('session')
  const isReturn = params.getAll('records').includes('return')
  const invalidSession = isReturn && (params.getAll('records').length !== 1 || ids.length > 1 || (ids.length === 1 && !/^cs_[a-f0-9]{20}$/.test(ids[0])))
  return { isReturn, sessionId: ids.length === 1 ? ids[0] : null, invalidSession }
}
export function stripReturnParams(): void {
  const url = new URL(location.href)
  url.searchParams.delete('records'); url.searchParams.delete('session')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}
