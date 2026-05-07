import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Catch unhandled renderer errors and show them instead of black screen
window.addEventListener('error', (e) => {
  document.body.innerHTML = `
    <div style="padding:24px;font-family:monospace;color:#ff5577;background:#0d0d14;height:100vh;box-sizing:border-box;">
      <b style="font-size:14px;">Renderer error — please report this</b><br/><br/>
      ${e.message}<br/>
      <pre style="font-size:11px;opacity:0.6;margin-top:12px;">${e.error?.stack ?? ''}</pre>
    </div>`
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
