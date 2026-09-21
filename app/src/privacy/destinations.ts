export const PRIVACY_DESTINATIONS: { destination: string; when: string; sent: string; offByDefault: true }[] = [
  { destination: 'FinchNode (sample data)', when: 'When you tap Try with sample data', sent: 'The categories you pick', offByDefault: true },
  { destination: 'Your connector and FinchNode', when: 'When you tap Connect my provider or Refresh', sent: 'The categories you pick, then your records come back', offByDefault: true },
  { destination: 'Your AI provider', when: 'When you send a message', sent: 'Your message and only the categories you tick', offByDefault: true },
  { destination: 'Your backup service', when: 'When you upload a backup', sent: 'An encrypted copy of your data', offByDefault: true },
  { destination: 'Reminder emails', when: 'When you enter an email', sent: 'Your email address and reminder time', offByDefault: true },
  { destination: 'Your calendar app', when: 'When you tap Add to calendar', sent: 'A calendar file with estimated dates or reminder times', offByDefault: true },
  { destination: 'Anything else', when: 'Never', sent: 'Nothing', offByDefault: true },
]
