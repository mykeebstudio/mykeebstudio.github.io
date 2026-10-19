import { useMemo, useRef, useState } from 'react';
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
  configurationScopes: string;
  backupContext: {
    keyboard: string;
    protocol: string;
    restoreSupported: boolean;
    deviceIdMapping: Record<string, string>;
    valueNotes: Record<string, string>;
    compatibilityWarning: string;
  };
  deviceConfigs: RmkTrackballConfig[];
  activeState: RmkTrackballState;
  saveStatus: RmkSaveStatus;
  layerProfiles: RmkLayerTrackballProfile[];
};

type DiffRow = {
  key: string;
  section: string;
  current: string;
  candidate: string;
  changed: boolean;
};

const layerNames = ['Base', 'Num', 'Sym', 'Sys', 'Layer 4', 'Layer 5', 'Layer 6', 'Layer 7'];
const configFields: Array<keyof RmkTrackballConfig> = [
  'mode', 'cpi', 'cursorGainQ8', 'scrollScaleDen', 'inertiaEnabled',
  'inertiaDecayNum', 'inertiaDecayDen', 'rotation', 'capabilities',
  'directionNoiseThreshold', 'directionReverseThreshold',
];
const profileFields: Array<keyof RmkLayerTrackballProfile> = [
  'mode', 'cursorGainQ8', 'scrollScaleDen', 'horizontalScrollScaleDen',
  'inertiaEnabled', 'rotation',
];
const fieldLabels: Record<string, string> = {
  mode: 'Mode', cpi: 'CPI', cursorGainQ8: 'Cursor gain (Q8)',
  scrollScaleDen: 'Vertical scroll denominator',
  horizontalScrollScaleDen: 'Horizontal scroll denominator',
  inertiaEnabled: 'Inertia enabled', inertiaDecayNum: 'Inertia decay numerator',
  inertiaDecayDen: 'Inertia decay denominator', rotation: 'Rotation (raw enum)',
  capabilities: 'Capabilities (raw bitfield)',
  directionNoiseThreshold: 'Direction noise threshold',
  directionReverseThreshold: 'Direction reverse threshold',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBackup(value: unknown): RuntimeBackup {
  if (!isRecord(value) || value.format !== 'pg1kb-rmk-runtime-backup' || value.version !== 1) {
    throw new Error('Unsupported backup format or version. Expected pg1kb-rmk-runtime-backup version 1.');
  }
  // backupContext was added after the first v1 backups were exported.
  // Treat it as optional metadata so older v1 JSON files remain readable.
  if (value.readOnly !== true || !Array.isArray(value.deviceConfigs) || value.deviceConfigs.length !== 2 ||
      !Array.isArray(value.layerProfiles) || value.layerProfiles.length !== 16 ||
      !isRecord(value.activeState) || !isRecord(value.saveStatus)) {
    const missing = [
      value.readOnly !== true ? 'readOnly: true' : '',
      !Array.isArray(value.deviceConfigs) || value.deviceConfigs.length !== 2 ? '2 device configs' : '',
      !Array.isArray(value.layerProfiles) || value.layerProfiles.length !== 16 ? '16 layer profiles' : '',
      !isRecord(value.activeState) ? 'activeState' : '',
      !isRecord(value.saveStatus) ? 'saveStatus' : '',
    ].filter(Boolean);
    throw new Error(`Backup structure is incomplete. Missing or invalid: ${missing.join(', ')}.`);
  }
  const deviceIds = value.deviceConfigs.map((item) => isRecord(item) ? item.deviceId : undefined);
  if (!deviceIds.includes(0) || !deviceIds.includes(1)) {
    throw new Error('Backup must contain both device IDs 0 (right) and 1 (left).');
  }
  const profileKeys = new Set(value.layerProfiles.map((item) =>
    isRecord(item) ? `${String(item.layer)}:${String(item.deviceId)}` : 'invalid'
  ));
  if (profileKeys.size !== 16 || Array.from({ length: 8 }, (_, layer) =>
    [`${layer}:0`, `${layer}:1`].every((key) => profileKeys.has(key))
  ).some((present) => !present)) {
    throw new Error('Backup must contain exactly one profile for each of 8 layers × 2 devices.');
  }
  for (const item of value.deviceConfigs) {
    if (!isRecord(item) || (item.deviceId !== 0 && item.deviceId !== 1)) {
      throw new Error('Each device config must have a valid deviceId (0 or 1).');
    }
    const integerRange = (field: string, min: number, max: number) => {
      const n = item[field];
      if (!Number.isInteger(n) || Number(n) < min || Number(n) > max) {
        throw new Error(`Device config ${item.deviceId}: ${field} must be an integer from ${min} to ${max}.`);
      }
    };
    integerRange('cpi', 100, 5000);
    integerRange('cursorGainQ8', 16, 2048);
    integerRange('scrollScaleDen', 1, 64);
    integerRange('inertiaDecayNum', 0, 255);
    integerRange('inertiaDecayDen', 1, 255);
    integerRange('rotation', 0, 3);
    integerRange('capabilities', 0, 255);
    integerRange('directionNoiseThreshold', 1, 32);
    integerRange('directionReverseThreshold', 1, 64);
    if (Number(item.directionReverseThreshold) < Number(item.directionNoiseThreshold)) {
      throw new Error(`Device config ${item.deviceId}: directionReverseThreshold must be at least directionNoiseThreshold.`);
    }
    if (item.inertiaEnabled !== true && item.inertiaEnabled !== false) {
      throw new Error(`Device config ${item.deviceId}: inertiaEnabled must be boolean.`);
    }
    if (item.mode !== 'cursor' && item.mode !== 'scroll') {
      throw new Error(`Device config ${item.deviceId}: unsupported mode.`);
    }
    if (Number(item.inertiaDecayNum) > Number(item.inertiaDecayDen)) {
      throw new Error(`Device config ${item.deviceId}: inertiaDecayNum must not exceed inertiaDecayDen.`);
    }
  }
  for (const item of value.layerProfiles) {
    if (!isRecord(item) || !Number.isInteger(item.layer) || Number(item.layer) < 0 || Number(item.layer) > 7 ||
        (item.deviceId !== 0 && item.deviceId !== 1)) {
      throw new Error('Each layer profile must have layer 0–7 and deviceId 0 or 1.');
    }
    const profileRange = (field: string, min: number, max: number) => {
      const n = item[field];
      if (!Number.isInteger(n) || Number(n) < min || Number(n) > max) {
        throw new Error(`Layer ${item.layer}, device ${item.deviceId}: ${field} must be an integer from ${min} to ${max}.`);
      }
    };
    profileRange('cursorGainQ8', 16, 2047);
    profileRange('scrollScaleDen', 1, 63);
    profileRange('horizontalScrollScaleDen', 1, 63);
    profileRange('rotation', 0, 3);
    if (item.mode !== 'cursor' && item.mode !== 'scroll') {
      throw new Error(`Layer ${item.layer}, device ${item.deviceId}: unsupported mode.`);
    }
    if (item.inertiaEnabled !== true && item.inertiaEnabled !== false) {
      throw new Error(`Layer ${item.layer}, device ${item.deviceId}: inertiaEnabled must be boolean.`);
    }
  }
  return value as unknown as RuntimeBackup;
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '—';
  return String(value);
}

function makeDiffRows(current: RuntimeBackup | null, candidate: RuntimeBackup): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const deviceId of [0, 1] as const) {
    const rightOrLeft = deviceId === 0 ? 'Right trackball' : 'Left trackball';
    const currentConfig = current?.deviceConfigs.find((item) => item.deviceId === deviceId);
    const candidateConfig = candidate.deviceConfigs.find((item) => item.deviceId === deviceId);
    if (!candidateConfig) continue;
    for (const field of configFields) {
      const next = candidateConfig[field];
      const before = currentConfig?.[field];
      rows.push({
        key: `device-${deviceId}-${field}`,
        section: `${rightOrLeft} · Device fallback · ${fieldLabels[field] ?? field}`,
        current: currentConfig ? formatValue(before) : 'Not read yet',
        candidate: formatValue(next),
        changed: !!currentConfig && before !== next,
      });
    }
  }
  for (let layer = 0; layer < 8; layer += 1) {
    for (const deviceId of [0, 1] as const) {
      const rightOrLeft = deviceId === 0 ? 'Right' : 'Left';
      const currentProfile = current?.layerProfiles.find((item) => item.layer === layer && item.deviceId === deviceId);
      const candidateProfile = candidate.layerProfiles.find((item) => item.layer === layer && item.deviceId === deviceId);
      if (!candidateProfile) continue;
      for (const field of profileFields) {
        const next = candidateProfile[field];
        const before = currentProfile?.[field];
        rows.push({
          key: `layer-${layer}-device-${deviceId}-${field}`,
          section: `Layer ${layer} (${layerNames[layer]}) · ${rightOrLeft} · ${fieldLabels[field] ?? field}`,
          current: currentProfile ? formatValue(before) : 'Not read yet',
          candidate: formatValue(next),
          changed: !!currentProfile && before !== next,
        });
      }
    }
  }
  return rows;
}

export default function RmkRuntimeBackup({ onDebug }: { onDebug: (event: string, detail?: unknown) => void }) {
  const clientRef = useRef<RmkTrackballClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [backup, setBackup] = useState<RuntimeBackup | null>(null);
  const [candidate, setCandidate] = useState<RuntimeBackup | null>(null);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect to the running PG1KB RMK firmware, then read its live settings. You can also load a backup JSON for a read-only comparison.');
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
        note: 'Backup snapshot. Device configs can be saved to flash; runtime layer profiles may reset after power loss.',
        configurationScopes: 'deviceConfigs contains device-wide fallback settings. layerProfiles contains per-layer overrides and takes precedence for that layer. activeState contains the effective runtime values for the currently active layer.',
        backupContext: {
          keyboard: 'PG1KB Proto PH3',
          protocol: 'RMK Rynk over WebHID',
          restoreSupported: true,
          deviceIdMapping: { '0': 'right trackball', '1': 'left trackball' },
          valueNotes: {
            cursorGainQ8: 'Q8 fixed-point gain. 256 represents 1.0x; preserve the exact integer.',
            scrollScaleDen: 'Vertical scroll scale denominator reported by firmware; preserve the exact integer.',
            horizontalScrollScaleDen: 'Horizontal scroll scale denominator reported by firmware; preserve the exact integer.',
            rotation: 'Raw firmware enum value. Its meaning must be checked against the matching firmware source before migration.',
            capabilities: 'Raw capability bitfield reported by firmware; decode only using the matching firmware definition.',
          },
          compatibilityWarning: 'The current read protocol does not report a firmware version or build ID. Restore only to a compatible PG1KB RMK firmware. Layer profiles are runtime-only and are not included in the persisted flash blob.',
        },
        deviceConfigs,
        activeState,
        saveStatus,
        layerProfiles,
      };
      setBackup(result);
      setMessage('Read complete: 2/2 device configs and 16/16 layer profiles.');
      onDebug('RMK runtime backup read complete', { deviceConfigs: 2, layerProfiles: layerProfiles.length, deviceName: client.label });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Live read failed. No settings were changed.');
      onDebug('RMK runtime backup failed', text);
    } finally {
      setBusy(false);
    }
  }

  async function loadBackupFile(file?: File) {
    if (!file) return;
    setError('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validated = validateBackup(parsed);
      setCandidate(validated);
      setShowChangedOnly(false);
      setMessage(`Loaded ${file.name}. This is a preview only; the keyboard has not been changed.`);
      onDebug('RMK backup JSON loaded for read-only comparison', { fileName: file.name, layerProfiles: validated.layerProfiles.length });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Could not load this backup. The previous comparison candidate, if any, is unchanged.');
      onDebug('RMK backup JSON validation failed', text);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function exportBackup() {
    if (!backup) return;
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pg1kb-rmk-runtime-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 1000);
    setMessage('JSON export requested. Confirm the file was downloaded and keep a second copy.');
  }

  async function restoreBackup() {
    const client = clientRef.current;
    if (!client || !candidate) return;
    const confirmed = window.confirm(
      'Restore this backup to the connected PG1KB RMK keyboard?\n\n' +
      'This will change both device configs and all 16 runtime layer profiles. ' +
      'Only the two device configs are saved to flash; layer profiles are runtime-only and may reset after power loss. ' +
      'The tool will read settings back and attempt rollback if a write or verification fails.\n\nContinue?'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('Reading a fresh safety snapshot before restore…');
    let previousConfigs: RmkTrackballConfig[] = [];
    let previousProfiles: RmkLayerTrackballProfile[] = [];
    let writeStarted = false;
    try {
      previousConfigs = [await client.getTrackballConfig(0), await client.getTrackballConfig(1)];
      previousProfiles = [];
      for (let layer = 0; layer < 8; layer += 1) {
        previousProfiles.push(await client.getLayerTrackballProfile(layer, 0));
        previousProfiles.push(await client.getLayerTrackballProfile(layer, 1));
      }

      setMessage('Applying device configs and 16 runtime layer profiles…');
      writeStarted = true;
      for (const deviceId of [0, 1] as const) {
        const config = candidate.deviceConfigs.find((item) => item.deviceId === deviceId);
        if (!config) throw new Error(`Backup is missing device config ${deviceId}.`);
        await client.setTrackballConfig(config);
      }
      for (let layer = 0; layer < 8; layer += 1) {
        for (const deviceId of [0, 1] as const) {
          const profile = candidate.layerProfiles.find((item) => item.layer === layer && item.deviceId === deviceId);
          if (!profile) throw new Error(`Backup is missing layer ${layer}, device ${deviceId} profile.`);
          await client.setLayerTrackballProfile(profile);
        }
      }

      setMessage('Saving device configs to flash…');
      await client.saveTrackballConfig();
      const saveStatus = await client.waitForSaveComplete();

      setMessage('Verifying restored values by reading them back…');
      const actualConfigs = [await client.getTrackballConfig(0), await client.getTrackballConfig(1)];
      const actualProfiles: RmkLayerTrackballProfile[] = [];
      for (let layer = 0; layer < 8; layer += 1) {
        actualProfiles.push(await client.getLayerTrackballProfile(layer, 0));
        actualProfiles.push(await client.getLayerTrackballProfile(layer, 1));
      }
      const configFieldsToVerify: Array<keyof RmkTrackballConfig> = [
        'cpi', 'cursorGainQ8', 'scrollScaleDen', 'inertiaEnabled',
        'inertiaDecayNum', 'inertiaDecayDen', 'rotation',
        'directionNoiseThreshold', 'directionReverseThreshold',
      ];
      const profileFieldsToVerify: Array<keyof RmkLayerTrackballProfile> = [
        'mode', 'cursorGainQ8', 'scrollScaleDen', 'horizontalScrollScaleDen',
        'inertiaEnabled', 'rotation',
      ];
      const mismatches: string[] = [];
      for (const expected of candidate.deviceConfigs) {
        const actual = actualConfigs.find((item) => item.deviceId === expected.deviceId);
        if (!actual) {
          mismatches.push(`device ${expected.deviceId}: missing read-back`);
          continue;
        }
        for (const field of configFieldsToVerify) {
          if (actual[field] !== expected[field]) mismatches.push(`device ${expected.deviceId} ${field}`);
        }
      }
      for (const expected of candidate.layerProfiles) {
        const actual = actualProfiles.find((item) => item.layer === expected.layer && item.deviceId === expected.deviceId);
        if (!actual) {
          mismatches.push(`layer ${expected.layer}, device ${expected.deviceId}: missing read-back`);
          continue;
        }
        for (const field of profileFieldsToVerify) {
          if (actual[field] !== expected[field]) mismatches.push(`layer ${expected.layer}, device ${expected.deviceId} ${field}`);
        }
      }
      const actualSnapshot: RuntimeBackup = {
        format: 'pg1kb-rmk-runtime-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        deviceName: client.label,
        readOnly: true,
        note: 'Read-back snapshot after a runtime restore.',
        configurationScopes: 'Device configs are persisted to flash. Layer profiles are runtime-only and may reset after power loss.',
        backupContext: {
          keyboard: 'PG1KB Proto PH3',
          protocol: 'RMK Rynk over WebHID',
          restoreSupported: true,
          deviceIdMapping: { '0': 'right trackball', '1': 'left trackball' },
          valueNotes: {},
          compatibilityWarning: 'Layer profiles are runtime-only and are not included in the 32-byte persisted flash blob.',
        },
        deviceConfigs: actualConfigs,
        activeState: await client.getTrackballState(),
        saveStatus,
        layerProfiles: actualProfiles,
      };
      if (mismatches.length) {
        throw new Error(`Read-back verification found ${mismatches.length} mismatch(es): ${mismatches.slice(0, 8).join(', ')}${mismatches.length > 8 ? ', …' : ''}`);
      }
      setBackup(actualSnapshot);
      setMessage('Restore completed and verified. Device configs are saved to flash; layer profiles are active in runtime memory only.');
      onDebug('RMK runtime backup restore verified', { deviceConfigs: 2, layerProfiles: 16, saveStatus });
    } catch (cause) {
      const originalError = cause instanceof Error ? cause.message : String(cause);
      let rollbackMessage = '';
      if (writeStarted && previousConfigs.length === 2 && previousProfiles.length === 16) {
        try {
          setMessage('Restore failed. Attempting to return to the pre-restore settings…');
          for (const config of previousConfigs) await client.setTrackballConfig(config);
          for (const profile of previousProfiles) await client.setLayerTrackballProfile(profile);
          await client.saveTrackballConfig();
          await client.waitForSaveComplete();
          rollbackMessage = ' Previous settings were reapplied and saved.';
        } catch (rollbackCause) {
          rollbackMessage = ` Rollback could not be confirmed: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}. Please reconnect and read current settings before further changes.`;
        }
      }
      setError(`Restore failed: ${originalError}.${rollbackMessage}`);
      setMessage('Restore did not complete successfully. Read the current settings before trying again.');
      onDebug('RMK runtime backup restore failed', { error: originalError, rollbackMessage });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) await client.close();
    setDeviceName('');
    setMessage('Disconnected.');
  }

  const diffRows = useMemo(() => candidate ? makeDiffRows(backup, candidate) : [], [backup, candidate]);
  const changedCount = diffRows.filter((row) => row.changed).length;
  const visibleRows = showChangedOnly ? diffRows.filter((row) => row.changed) : diffRows;

  return (
    <div className="rmk-runtime-backup">
      <div className="rmk-runtime-backup-warning">
        <strong>Experimental · backup preview and guarded restore</strong>
        <span>Loading a JSON file only creates a preview. Keyboard settings change only after you press Restore and confirm the warning. Device configs can be saved to flash; layer profiles are runtime-only.</span>
      </div>
      <p className="rmk-runtime-backup-message">{message}</p>
      {deviceName && <p className="rmk-runtime-backup-device">Connected device: <strong>{deviceName}</strong></p>}
      {error && <p className="rmk-runtime-backup-error" role="alert">{error}</p>}
      <div className="rmk-runtime-backup-actions">
        <button className="button" type="button" onClick={() => void connectAndRead()} disabled={busy}>
          {busy ? 'Reading…' : 'Connect and read current settings'}
        </button>
        <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          Load backup JSON for preview
        </button>
        <input
          ref={fileInputRef}
          className="rmk-runtime-backup-file-input"
          type="file"
          accept=".json,application/json"
          aria-label="Select RMK runtime backup JSON"
          onChange={(event) => void loadBackupFile(event.currentTarget.files?.[0])}
        />
        <button className="button secondary" type="button" onClick={exportBackup} disabled={!backup || busy}>
          Export current settings JSON
        </button>
        <button className="button secondary" type="button" onClick={() => void disconnect()} disabled={!clientRef.current || busy}>
          Disconnect
        </button>
      </div>
      {backup && (
        <section className="rmk-runtime-backup-summary">
          <h3>Current device snapshot</h3>
          <p>Device configs: {backup.deviceConfigs.length}/2</p>
          <p>Layer profiles: {backup.layerProfiles.length}/16 (runtime-only; not saved to flash)</p>
          <p>Active layer: {backup.activeState.activeLayer} ({layerNames[backup.activeState.activeLayer] ?? 'Unknown'})</p>
          <p>Save status: {backup.saveStatus.state} · generation {backup.saveStatus.completedGeneration}/{backup.saveStatus.requestedGeneration}</p>
        </section>
      )}
      {candidate && (
        <section className="rmk-runtime-backup-preview">
          <div className="rmk-runtime-backup-preview-heading">
            <div>
              <h3>Restore preview (not applied)</h3>
              <p>File date: {candidate.exportedAt || 'Unknown'} · source: {candidate.deviceName || 'Unknown device'}</p>
            </div>
            <div className="rmk-runtime-backup-actions">
              <button className="button" type="button" onClick={() => void restoreBackup()} disabled={!backup || busy || !clientRef.current}>
                {busy ? 'Working…' : 'Restore this backup'}
              </button>
              <button className="button secondary" type="button" onClick={() => { setCandidate(null); setShowChangedOnly(false); }} disabled={busy}>
                Clear preview
              </button>
            </div>
          </div>
          <div className="rmk-runtime-backup-preview-notice">
            {backup
              ? `Comparing the loaded backup with the latest live read. ${changedCount} field(s) differ across device configs and layer profiles.`
              : 'Connect and read the keyboard to compare against its current values. Until then, current values are shown as not read.'}
          </div>
          <div className="rmk-runtime-backup-preview-notice">
            <strong>Restore scope:</strong> Applying this backup changes the live device configs and all 16 layer profiles. Device configs are saved to flash; layer profiles remain runtime-only and can reset after power loss. Firmware defaults are not queried.
          </div>
          <label className="rmk-runtime-backup-filter">
            <input type="checkbox" checked={showChangedOnly} onChange={(event) => setShowChangedOnly(event.currentTarget.checked)} disabled={!backup} />
            Show only fields that differ from current settings
          </label>
          <div className="rmk-runtime-backup-table-wrap">
            <table className="rmk-runtime-backup-table">
              <thead>
                <tr><th>Setting</th><th>Current device</th><th>Backup candidate</th><th>Firmware default</th><th>Status</th></tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key} className={row.changed ? 'is-changed' : ''}>
                    <th scope="row">{row.section}</th>
                    <td>{row.current}</td>
                    <td>{row.candidate}</td>
                    <td className="is-unknown">Not queried</td>
                    <td>{!backup ? 'Awaiting live read' : row.changed ? 'Different' : 'Same'}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={5}>{backup ? 'No differences in the selected fields.' : 'Read the current device to calculate differences.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="rmk-runtime-backup-note">No settings change when a JSON is loaded. Only the explicit Restore button sends settings to the keyboard. The tool verifies restored values by reading them back and attempts to reapply the pre-restore snapshot if an operation fails.</p>
        </section>
      )}
    </div>
  );
}
