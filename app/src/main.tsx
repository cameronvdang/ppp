import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { Tab } from './components/TabBar'
import { readReturnParams, stripReturnParams } from './records/returnHandler'
import { useApp } from './state/appStore'
import { StartupErrorBoundary } from './components/StartupErrorBoundary'
import { initializeRuntime } from './platform/runtime'
import { Onboarding } from './screens/Onboarding'
import '@fontsource/aileron/300.css'
import '@fontsource/aileron/400.css'
import '@fontsource/aileron/600.css'
import '@fontsource/aileron/700.css'
import '@fontsource/aileron/800.css'
import './styles/base.css'
import './styles/app.css'
import './styles/health-import.css'
import './styles/records.css'
import './styles/mobile.css'
import './styles/desktop.css'

const ret = readReturnParams(window.location.search)
if (ret.isReturn) { stripReturnParams(); useApp.getState().setRecordsReturn(ret) }

const params = new URLSearchParams(window.location.search)
const tab = params.get('tab'); const action = params.get('action')
if (tab || action) {
  if (tab && ['today', 'insights', 'graphs', 'records', 'settings'].includes(tab)) useApp.getState().setTab(tab as Tab)
  if (action === 'log') useApp.getState().setLaunchAction('log')
  params.delete('tab'); params.delete('action')
  history.replaceState(null, '', window.location.pathname + (params.size ? `?${params}` : '') + window.location.hash)
}

void initializeRuntime()

const onboardingPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'onboarding'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      {onboardingPreview ? (
        <Onboarding
          onDone={() => {
            window.location.assign('/')
          }}
        />
      ) : (
        <App />
      )}
    </StartupErrorBoundary>
  </React.StrictMode>,
)
