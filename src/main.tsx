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
import RmkKeymapSettings from './RmkKeymapSettings';
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
const rmkKeymapMode = window.location.hash === '#rmk-keymap';
const rmkMode = rmkTrackballMode || rmkKeymapMode;
const debugRmk = (event: string, detail?: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.info(`[MyKeebStudio/RMK] ${timestamp} ${event}${suffix}`);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      {rmkMode ? (
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-brand">
              <div>
                <div className="eyebrow">RMK / Rynk</div>
                <h1>MyKeebStudio <small className="version-badge">RMK</small></h1>
              </div>
            </div>
            <div className="content-header-actions">
              <a className={rmkKeymapMode ? 'button' : 'button secondary'} href="#rmk-keymap">Keymap</a>
              <a className={rmkTrackballMode ? 'button' : 'button secondary'} href="#rmk-trackball">Trackball</a>
              <a className="button secondary" href="./">Back to ZMK Studio</a>
            </div>
          </header>
          <main className="workspace menu-collapsed">
            <section className="content">
              <div className="content-header">
                <div>
                  <div className="eyebrow">PG1KB Proto PH3</div>
                  <h2>{rmkKeymapMode ? 'Keymap' : 'Trackball'}</h2>
                  <p>{rmkKeymapMode
                    ? 'Read and edit the live RMK keymap through the official Rynk protocol over WebHID.'
                    : 'Live-tune PAW3222 cursor, scroll, inertia, and sensor rotation over RMK Rynk WebHID.'}</p>
                </div>
              </div>
              {rmkKeymapMode
                ? <RmkKeymapSettings onDebug={debugRmk} />
                : <RmkTrackballSettings onDebug={debugRmk} />}
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
