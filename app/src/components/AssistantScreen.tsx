import { useEffect, useRef, useState } from 'react'
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import {
  anthropicCredentialKind,
  ANTHROPIC_MODELS,
  askAssistant,
  CLI_TOKEN_PREFIX,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AssistantConfig,
  type AssistantProvider,
  type ChatMessage,
} from '../lib/assistant'
import {
  collectApprovedAssistantContext,
  NO_ASSISTANT_CONSENT,
  parseAssistantConsent,
  type AssistantConsent,
} from '../lib/assistantContext'
import { screenAssistantUrgency } from '../lib/assistantSafety'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
  setSecureSecret,
} from '../platform/secureVault'
import { useApp } from '../state/appStore'
import { PppMark } from './PppMark'
import '../styles/assistant.css'

const CONSENT_OPTIONS: Array<{
  key: keyof AssistantConsent
  title: string
  detail: string
  sensitive?: boolean
}> = [
  { key: 'cycle', title: 'Cycle summary', detail: 'Period starts and current prediction' },
  { key: 'symptoms', title: 'Symptoms & mood', detail: 'Up to 30 recent logged days' },
  {
    key: 'fertility',
    title: 'Fertility & intimacy',
    detail: 'BBT, tests, discharge, sex, and pregnancy timing',
    sensitive: true,
  },
  { key: 'notes', title: 'Private notes', detail: 'Up to 12 recent notes', sensitive: true },
]

const STARTERS = [
  'What can change cycle length?',
  'Help me prepare questions for my doctor.',
  'Explain my fertile-window estimate.',
]

function defaultModel(provider: AssistantProvider): string {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
}

function vaultKeyFor(provider: AssistantProvider) {
  return provider === 'anthropic'
    ? SECURE_SECRET_KEYS.anthropicApiKey
    : SECURE_SECRET_KEYS.openAiApiKey
}

export function AssistantScreen() {
  const setAssistantOpen = useApp((state) => state.setAssistantOpen)
  const [provider, setProvider] = useState<AssistantProvider>('anthropic')
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_MODEL)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [consent, setConsent] = useState<AssistantConsent>(NO_ASSISTANT_CONSENT)
  const [vaultLabel, setVaultLabel] = useState('secure storage')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [setupOpen, setSetupOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)

  const credentialKind = apiKey ? anthropicCredentialKind(apiKey) : null

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [savedProvider, savedModel, savedBaseUrl, savedConsent, _status, legacyKey, savedOpenAiKey, savedAnthropicKey] =
        await Promise.all([
          getSetting(SK.aiProvider),
          getSetting(SK.aiModel),
          getSetting(SK.aiBaseUrl),
          getSetting(SK.aiConsent),
          secureVaultStatus(),
          getSetting(SK.aiKey),
          getSecureSecret(SECURE_SECRET_KEYS.openAiApiKey),
          getSecureSecret(SECURE_SECRET_KEYS.anthropicApiKey),
        ])
      const nextProvider: AssistantProvider = savedProvider === 'openai' ? 'openai' : 'anthropic'

      // One-time migration from the old Dexie implementation. Plaintext is
      // removed immediately after the browser vault accepts it.
      if (legacyKey) {
        await setSecureSecret(SECURE_SECRET_KEYS.openAiApiKey, legacyKey)
        await removeSetting(SK.aiKey)
      }
      const key =
        nextProvider === 'anthropic' ? savedAnthropicKey : legacyKey || savedOpenAiKey
      if (!alive) return
      setProvider(nextProvider)
      setModel(savedModel || defaultModel(nextProvider))
      setBaseUrl(savedBaseUrl || '')
      setConsent(parseAssistantConsent(savedConsent))
      setApiKey(key)
      setVaultLabel('Encrypted on this device')
      setSetupOpen(!key)
      setLoading(false)
    })().catch((reason: unknown) => {
      if (!alive) return
      setError(reason instanceof Error ? reason.message : 'Could not load AI settings.')
      setLoading(false)
      setSetupOpen(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    const textarea = composerInput.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 104)}px`
  }, [input])

  async function chooseProvider(next: AssistantProvider) {
    setProvider(next)
    setModel(defaultModel(next))
    setBaseUrl('')
    setKeyInput('')
    setError(null)
    setNotice(null)
    setApiKey(await getSecureSecret(vaultKeyFor(next)))
  }

  async function saveConfiguration() {
    const cleanModel = model.trim() || defaultModel(provider)
    setError(null)
    setNotice(null)
    try {
      const suppliedKey = keyInput.trim()
      if (suppliedKey) {
        if (provider === 'anthropic' && anthropicCredentialKind(suppliedKey) === null) {
          setError('Your Anthropic key or sign-in code should start with sk-ant-.')
          return
        }
        if (provider === 'openai' && !suppliedKey.startsWith('sk-')) {
          setError('That does not look like an OpenAI key.')
          return
        }
        await setSecureSecret(vaultKeyFor(provider), suppliedKey)
        setApiKey(suppliedKey)
        setKeyInput('')
      }
      await Promise.all([
        setSetting(SK.aiProvider, provider),
        setSetting(SK.aiModel, cleanModel),
        setSetting(SK.aiBaseUrl, baseUrl.trim()),
      ])
      setModel(cleanModel)
      if (!apiKey && !suppliedKey) {
        setError(
          provider === 'anthropic'
            ? 'Add your Anthropic key or Claude sign-in code.'
            : 'Add an OpenAI project key, or choose another provider.',
        )
        return
      }
      setSetupOpen(false)
      setNotice('AI connection settings saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save AI settings.')
    }
  }

  async function removeKey() {
    await deleteSecureSecret(vaultKeyFor(provider))
    setApiKey(null)
    setKeyInput('')
    setNotice(
      provider === 'anthropic'
        ? 'Anthropic credential removed from this device. Revoke it in the Anthropic console to invalidate it everywhere.'
        : 'OpenAI key removed.',
    )
  }

  async function toggleConsent(key: keyof AssistantConsent) {
    const next = { ...consent, [key]: !consent[key] }
    setConsent(next)
    await setSetting(SK.aiConsent, JSON.stringify(next))
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return
    if (!apiKey) {
      setSetupOpen(true)
      setError(
        provider === 'anthropic'
          ? 'Add your Anthropic key or Claude sign-in code before sending a message.'
          : 'Add an OpenAI key before sending a message.',
      )
      return
    }

    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    const safetyIntercept = screenAssistantUrgency(text)
    if (safetyIntercept) {
      setMessages([...next, { role: 'assistant', content: safetyIntercept.response }])
      setError(null)
      setNotice('This safety message was generated on device; no provider request was made.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const approvedContext = await collectApprovedAssistantContext(consent)
      const config: AssistantConfig = {
        provider,
        apiKey: apiKey ?? undefined,
        model,
        baseUrl: baseUrl || undefined,
      }
      const reply = await askAssistant(config, next, approvedContext)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }


  const sharedCount = Object.values(consent).filter(Boolean).length

  return (
    <div
      className="overlay assistant-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="PPP AI assistant"
    >
      <header className="overlay-head assistant-head">
        <button className="back-btn" onClick={() => setAssistantOpen(false)} aria-label="Close">
          ‹
        </button>
        <div className="assistant-title">
          <PppMark decorative size={25} />
          <span>
            <span className="assistant-kicker">Private companion</span>
            <h2>PPP AI</h2>
          </span>
        </div>
        <button
          className={`icon-button assistant-settings-button ${setupOpen ? 'is-active' : ''}`}
          onClick={() => setSetupOpen((open) => !open)}
          aria-label={setupOpen ? 'Close AI settings' : 'Open AI settings'}
          aria-pressed={setupOpen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.25" />
            <circle cx="12" cy="12" r="1.25" />
            <circle cx="19" cy="12" r="1.25" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div className="overlay-body assistant-loading">
          <PppMark decorative size={30} />
          <span>Preparing your private space…</span>
        </div>
      ) : setupOpen ? (
        <div className="overlay-body assistant-setup">
          <section className="assistant-setup-intro">
            <p className="eyebrow">Connection</p>
            <h3>Choose where answers come from</h3>
            <p>Your saved key is encrypted on this device. PPP sends it to the AI service used for your answers.</p>
            <div className="ai-provider-grid">
              <button
                className={`choice-card compact ${provider === 'anthropic' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('anthropic')}
              >
                <span className="choice-icon">✳</span>
                <span><strong>Anthropic</strong><small>Your key or Claude sign-in code</small></span>
              </button>
              <button
                className={`choice-card compact ${provider === 'openai' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('openai')}
              >
                <span className="choice-icon">✦</span>
                <span><strong>OpenAI</strong><small>Cloud · your key</small></span>
              </button>
            </div>
          </section>

          <section className="card ai-setup-card">
            {provider === 'anthropic' ? (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">Anthropic key or Claude sign-in code</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'Paste your key or sign-in code'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  {apiKey && (
                    <small className="field-hint">
                      Currently using{' '}
                      {credentialKind === 'cli-token'
                        ? 'a Claude sign-in code'
                        : 'an Anthropic key'}
                      .
                    </small>
                  )}
                </div>

                <details className="assistant-key-fallback">
                  <summary>Use your Claude subscription</summary>
                  <p className="microcopy">
                    PPP cannot create a Claude sign-in code. Run <code>claude</code> with the command below on a computer where you are signed in:
                  </p>
                  <pre className="cli-snippet"><code>claude setup-token</code></pre>
                  <p className="microcopy">
                    Paste the <code>{CLI_TOKEN_PREFIX}…</code> sign-in code into the field above. PPP sends it to Anthropic to use your Claude subscription. When it expires, run the command again.
                  </p>
                </details>

                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <select
                    id="assistant-model"
                    value={ANTHROPIC_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_ANTHROPIC_MODEL}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {ANTHROPIC_MODELS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">OpenAI project key</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'sk-proj-…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <input
                    id="assistant-model"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>
              </>
            )}
            <p className="microcopy">
              Saved keys: {vaultLabel}. They stay separate from your logs and backups. Your PIN and device unlock lock the screen. They do not encrypt everything you log.
            </p>
            {apiKey && (
              <button className="text-button danger" onClick={removeKey}>
                Remove saved credential
              </button>
            )}
          </section>

          {notice && <div className="assistant-notice" role="status">{notice}</div>}
          {error && <div className="assistant-error" role="alert">{error}</div>}
          <button className="cta" onClick={saveConfiguration}>
            Save connection
          </button>
        </div>
      ) : (
        <>
          <section className={`assistant-context-panel ${contextOpen ? 'is-open' : ''}`}>
            <button
              className="assistant-context-summary"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              aria-controls="assistant-consent-options"
            >
              <span className="assistant-context-mark" aria-hidden="true">
                <PppMark decorative size={18} />
              </span>
              <span className="assistant-context-copy">
                <strong>Tracker context</strong>
                <small>
                  {sharedCount === 0
                    ? 'Nothing shared'
                    : `${sharedCount} categor${sharedCount === 1 ? 'y' : 'ies'} selected`}
                </small>
              </span>
              <span className="privacy-pill">
                <i aria-hidden="true" />
                {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
              </span>
              <svg className="assistant-context-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7 9.5 5 5 5-5" />
              </svg>
            </button>

            {contextOpen && (
              <div className="assistant-context-disclosure" id="assistant-consent-options">
                <div className="assistant-context-note">
                  <strong>Choose what travels with your next message.</strong>
                  <span>Nothing is attached unless you select it here.</span>
                </div>
                <div className="consent-grid">
                  {CONSENT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`consent-row ${consent[option.key] ? 'selected' : ''}`}
                      onClick={() => toggleConsent(option.key)}
                      aria-pressed={consent[option.key]}
                    >
                      <span>
                        <strong>{option.title}</strong>
                        <small>
                          {option.detail}
                          {option.sensitive ? ' · Sensitive' : ''}
                        </small>
                      </span>
                      <span className="toggle-dot" aria-hidden="true"><i /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div
            className={`overlay-body assistant-messages ${messages.length === 0 ? 'is-empty' : ''}`}
            ref={scroller}
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="assistant-empty">
                <div className="assistant-orb" aria-hidden="true">
                  <span />
                  <PppMark decorative size={38} />
                </div>
                <span className="assistant-empty-kicker">Private by design</span>
                <h3>What would you like to understand?</h3>
                <p>
                  Ask a general question, or selectively share tracker context for a more
                  personal answer.
                </p>
                <div className="starter-list" aria-label="Starter questions">
                  {STARTERS.map((starter) => (
                    <button key={starter} onClick={() => send(starter)}>
                      <span>{starter}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-bubble ${message.role}`}>
                {message.role === 'assistant' && (
                  <span className="chat-bubble-mark" aria-hidden="true">
                    <PppMark decorative size={14} />
                  </span>
                )}
                <span>{message.content}</span>
              </div>
            ))}
            {busy && (
              <div className="chat-bubble assistant typing" aria-label="PPP is thinking">
                <span className="chat-bubble-mark" aria-hidden="true">
                  <PppMark decorative size={14} />
                </span>
                <span>Thinking</span>
                <i /><i /><i />
              </div>
            )}
            {notice && <div className="assistant-notice" role="status">{notice}</div>}
            {error && <div className="assistant-error" role="alert">{error}</div>}
          </div>
        </>
      )}

      {!loading && !setupOpen && (
        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className="assistant-compose-row">
            <textarea
              ref={composerInput}
              rows={1}
              placeholder="Message PPP…"
              aria-label="Message PPP"
              enterKeyHint="send"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send message">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 18V6m-5 5 5-5 5 5" />
              </svg>
            </button>
          </div>
          <p>Educational support only · not diagnosis or emergency care</p>
        </form>
      )}
    </div>
  )
}
