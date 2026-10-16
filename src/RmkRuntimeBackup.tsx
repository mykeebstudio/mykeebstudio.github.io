import { useRef, useState } from 'react';
import {
  RmkTrackballClient,
  type RmkTrackballConfig,
  type RmkLayerTrackballProfile,
  type RmkTrackballState,
  type RmkSaveStatus,
} from './rmkTrackballProtocol';
import './rmkRuntimeBackup.css';

type RuntimeBackup = {
  format: 'pg1kb-rmk-runtime-backup';
  version: 1;
  exportedAt: string;
  deviceName: string;
  readOnly: true;
  note: string;
  deviceConfigs: RmkTrackballConfig[];
  activeState: RmkTrackballState;
  saveStatus: RmkSaveStatus;
  layerProfiles: RmkLayerTrackballProfile[];
};

const layerNames = ['Base', 'Num', 'Sym', 'Sys', 'Layer 4', 'Layer 5', 'Layer 6', 'Layer 7'];

export default function RmkRuntimeBackup({ onDebug }: { onDebug: (event: string, detail?: unknown) => void }) {
  const clientRef = useRef<RmkTrackballClient | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [backup, setBackup] = useState<RuntimeBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect to the running PG1KB RMK firmware, then read and export its live settings.');
  const [error, setError] = useState('');

  async function connectAndRead() {
    setBusy(true);
    setError('');
    setMessage('Connecting to RMK over WebHID…');
    setBackup(null);
    try {
      if (clientRef.current) {
        await clientRef.current.close();
        clientRef.current = null;
      }
      const client = await RmkTrackballClient.connect();
      clientRef.current = client;
      setDeviceName(client.label);
      setMessage('Reading device configs, active state, save status, and all 16 layer profiles…');

      const deviceConfigs: RmkTrackballConfig[] = [];
      deviceConfigs.push(await client.getTrackballConfig(0));
      deviceConfigs.push(await client.getTrackballConfig(1));
      const activeState = await client.getTrackballState();
      const saveStatus = await client.getSaveStatus();
      const layerProfiles: RmkLayerTrackballProfile[] = [];
      for (let layer = 0; layer < 8; layer += 1) {
        layerProfiles.push(await client.getLayerTrackballProfile(layer, 0));
        layerProfiles.push(await client.getLayerTrackballProfile(layer, 1));
      }

      const result: RuntimeBackup = {
        format: 'pg1kb-rmk-runtime-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        deviceName: client.label,
        readOnly: true,
        note: 'Read-only snapshot. Runtime layer profiles may reset after power loss; verify this file before changing firmware.',
        deviceConfigs,
        activeState,
        saveStatus,
        layerProfiles,
      };
      setBackup(result);
      setMessage('Read complete: 2/2 device configs and 16/16 layer profiles. Export the JSON before changing firmware.');
      onDebug('RMK runtime backup read complete', { deviceConfigs: 2, layerProfiles: layerProfiles.length, deviceName: client.label });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Backup read failed. Keep the keyboard powered on and do not change firmware yet.');
      onDebug('RMK runtime backup failed', text);
    } finally {
      setBusy(false);
    }
  }

  function exportBackup() {
    if (!backup) return;
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pg1kb-rmk-runtime-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('JSON export requested. Confirm the file was downloaded and keep a second copy.');
  }

  async function disconnect() {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) await client.close();
    setDeviceName('');
    setMessage('Disconnected. The exported JSON remains available if already read.');
  }

  return (
    <div className="rmk-runtime-backup">
      <div className="rmk-runtime-backup-warning">
        <strong>Experimental · read-only</strong>
        <span>This tool only reads settings. It does not change configuration, save to flash, or flash firmware.</span>
      </div>
      <p className="rmk-runtime-backup-message">{message}</p>
      {deviceName && <p className="rmk-runtime-backup-device">Connected device: <strong>{deviceName}</strong></p>}
      {error && <p className="rmk-runtime-backup-error" role="alert">{error}</p>}
      <div className="rmk-runtime-backup-actions">
        <button className="button" type="button" onClick={() => void connectAndRead()} disabled={busy}>
          {busy ? 'Reading…' : 'Connect and read all settings'}
        </button>
        <button className="button secondary" type="button" onClick={exportBackup} disabled={!backup || busy}>
          Export JSON backup
        </button>
        <button className="button secondary" type="button" onClick={() => void disconnect()} disabled={!clientRef.current || busy}>
          Disconnect
        </button>
      </div>
      {backup && (
        <section className="rmk-runtime-backup-summary">
          <h3>Backup contents</h3>
          <p>Device configs: {backup.deviceConfigs.length}/2</p>
          <p>Layer profiles: {backup.layerProfiles.length}/16</p>
          <p>Active layer: {backup.activeState.activeLayer} ({layerNames[backup.activeState.activeLayer] ?? 'Unknown'})</p>
          <p>Save status: {backup.saveStatus.state} · generation {backup.saveStatus.completedGeneration}/{backup.saveStatus.requestedGeneration}</p>
          <p className="rmk-runtime-backup-note">Keep the keyboard powered on until the JSON file is downloaded and checked. Do not flash ZMK before verifying the backup.</p>
        </section>
      )}
    </div>
  );
}
