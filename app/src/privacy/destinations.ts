export const PRIVACY_DESTINATIONS: { destination: string; when: string; sent: string; offByDefault: true }[] = [
  { destination: 'FinchNode demo API', when: 'User taps "Try with sample data"', sent: 'Chosen categories and a random external ID', offByDefault: true },
  { destination: 'Your relay → FinchNode', when: 'User taps "Connect my provider" / Refresh', sent: 'Chosen categories, random external ID, return URL; then subject ID; required client token goes only to your relay', offByDefault: true },
  { destination: 'AI provider (BYOK)', when: 'User sends a message', sent: 'The message plus only the ticked categories', offByDefault: true },
  { destination: 'Backup relay', when: 'User explicitly uploads via the backup action', sent: 'Client-encrypted backup blob, including imported records', offByDefault: true },
  { destination: 'Reminder worker', when: 'User enters an email', sent: 'Email + time only, no health words', offByDefault: true },
  { destination: 'Your calendar app', when: 'User taps Add to calendar', sent: 'An .ics file with estimated dates or reminder times, generated on this device', offByDefault: true },
  { destination: 'Anything else', when: 'Never', sent: '—', offByDefault: true },
]
