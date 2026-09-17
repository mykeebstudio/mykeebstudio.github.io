import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DebugConsole from './DebugConsole';
import KeyTesterPortal from './KeyTesterPortal';
import BLEManagementPortal from './BLEManagementPortal';
import SensorBindingsPortal from './SensorBindingsPanel';
import HeaderIdentity from './HeaderIdentity';
import KeymapWorkspacePortal from './KeymapWorkspacePortal';
import RmkTrackballSettings from './RmkTrackballSettings';
import { installDeviceExportNaming } from './deviceIdentity';
import { LanguageProvider, LanguageSwitcher } from './i18n';
import './styles.css';
import './layerViewer.css';
import './sensorBindings.css';
import './bindingPicker.css';
import './comboEditor.css';
import './customSettings.css';
import './v05.css';
import './keymapDiffGuide.css';
import './debugConsoleOverride.css';
import './deviceName.css';
import './language.css';
import './uiPolish.css';
import './headerIdentity.css';
import './unifiedTools.css';

installDeviceExportNaming();

const rmkTrackballMode = window.location.hash === '#rmk-trackball';
const debugRmk = (event: string, detail?: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.info(`[MyKeebStudio/RMK] ${timestamp} ${event}${suffix}`);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      {rmkTrackballMode ? (
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-brand">
              <div>
                <div className="eyebrow">RMK / Rynk live tuning</div>
                <h1>MyKeebStudio <small className="version-badge">RMK</small></h1>
              </div>
            </div>
            <a className="button secondary" href="./">Back to ZMK Studio</a>
          </header>
          <main className="workspace menu-collapsed">
            <section className="content">
              <div className="content-header">
                <div>
                  <div className="eyebrow">PG1KB Proto PH3</div>
                  <h2>Trackball</h2>
                  <p>Live-tune PAW3222 cursor, scroll, inertia, and sensor rotation over RMK Rynk WebHID.</p>
                </div>
              </div>
              <RmkTrackballSettings onDebug={debugRmk} />
            </section>
          </main>
        </div>
      ) : (
        <>
          <App />
          <HeaderIdentity />
          <LanguageSwitcher />
          <KeymapWorkspacePortal />
          <SensorBindingsPortal />
          <DebugConsole />
          <KeyTesterPortal />
          <BLEManagementPortal />
        </>
      )}
    </LanguageProvider>
  </React.StrictMode>,
);
