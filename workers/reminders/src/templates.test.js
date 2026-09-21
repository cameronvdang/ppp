import { describe, expect, it } from 'vitest'
import { bodyFor, FORBIDDEN_TERMS, subjectFor } from './templates.js'

const APP = 'PPP'
const UNSUB = 'https://ppp.example/v1/unsubscribe?id=x&t=y'

describe('reminder templates leak no health information', () => {
  const surfaces = [
    subjectFor(APP).toLowerCase(),
    bodyFor(APP, UNSUB).text.toLowerCase(),
    bodyFor(APP, UNSUB).html.toLowerCase(),
  ]

  it.each(FORBIDDEN_TERMS)('contains no reference to "%s"', (term) => {
    for (const surface of surfaces) {
      expect(surface).not.toContain(term)
    }
  })

  it('still includes the app name and an unsubscribe link', () => {
    expect(subjectFor(APP)).toContain(APP)
    const body = bodyFor(APP, UNSUB)
    expect(body.text).toContain(UNSUB)
    expect(body.html).toContain(UNSUB)
  })
})
