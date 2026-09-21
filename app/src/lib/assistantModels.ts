export type AssistantProvider = 'anthropic' | 'openai'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra'

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 · most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fastest' },
] as const

