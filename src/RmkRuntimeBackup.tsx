import { useRef, useState } from 'react';
import './rmkRuntimeBackup.css';

type CollectionLike = { usagePage?: number; usage?: number };
type HidDeviceLike = {
  productName?: string; vendorId: number; productId: number; opened: boolean;
  collections: CollectionLike[];
  open(): Promise<void>; close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: EventListener): void;
  removeEventListener(type: 'inputreport', listener: EventListener): void;
};
type HidApiLike = { requestDevice(options: { filters: { usagePage: number; usage: number }[] }): Promise<HidDeviceLike[]> };
type NavigatorHid = Navigator & { hid?: HidApiLike };
type Link = {
  label: string;
  request(command: number, payload: Uint8Array, expectedLength: number): Promise<Uint8Array>;
  close(): Promise<void>;
};
type DeviceConfig = {
  deviceId: number; device: string; cpi: number; cursorGainQ8: number; scrollDenominator: number;
  inertiaEnabled: boolean; inertiaDecayNumerator: number; inertiaDecayDenominator: number;
  rotationRaw: number; rotationDegrees: number; supportedFields: number; effectiveMode: string;
  directionNoiseThreshold: number; directionReverseThreshold: number; wireBytes: number[];
};
type LayerProfile = {
  layer: number; layerName: string; deviceId: number; device: string; mode: string; cursorGainQ8: number;
  scrollDenominator: number; horizontalScrollDenominator: number; inertiaEnabled: boolean;
  rotationRaw: number; rotationDegrees: number; wireBytes: number[];
};
type Backup = {
  format: 'pg1kb-rmk-trackball-runtime'; version: 1; exportedAt: string; deviceName: string;
  transport: 'Rynk WebHID'; readOnly: true; commands: Record<string, string>;
  deviceConfigs: DeviceConfig[]; layerProfiles: LayerProfile[];
  activeState: { activeLayer: number; rightMode: string; leftMode: string; rightGainSixteenths: number;
    leftGainSixteenths: number; rightScrollDenominator: number; leftScrollDenominator: number;
    rightHorizontalScrollDenominator: number; leftHorizontalScrollDenominator: number; wireBytes: number[] };
  saveStatus: { statusCode: number; status: string; requestedGeneration: number; completedGeneration: number; wireBytes: number[] };
};

const USAGE_PAGE = 0xff14;
const USAGE = 0x61;
const REPORT_SIZE = 32;
const LAYERS = ['Base', 'Num', 'Sym', 'Sys', 'Layer 4', 'Layer 5', 'Layer 6', 'Layer 7'];
const CMD = { config: 0x0901, saveStatus: 0x0905, state: 0x0906, profile: 0x0907 };

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length); return out;
}
function cobsEncode(input: Uint8Array) {
  const out = new Uint8Array(input.length + Math.floor(input.length / 254) + 2);
  let read = 0, write = 1, codeAt = 0, code = 1;
  while (read < input.length) {
    const value = input[read++];
    if (value === 0) { out[codeAt] = code; codeAt = write++; code = 1; }
    else {
      out[write++] = value; code++;
      if (code === 0xff) { out[codeAt] = code; codeAt = write++; code = 1; }
    }
  }
  out[codeAt] = code; out[write++] = 0;
  return out.slice(0, write);
}
function cobsDecode(input: Uint8Array) {
  const out = new Uint8Array(input.length);
  let read = 0, write = 0;
  while (read < input.length) {
    const code = input[read++];
    if (code === 0 || read + code - 1 > input.length) throw new Error('Malformed COBS frame from RMK.');
    for (let i = 1; i < code; i++) out[write++] = input[read++];
    if (code < 0xff && read < input.length) out[write++] = 0;
  }
  return out.slice(0, write);
}
function frame(command: number, sequence: number, payload: Uint8Array) {
  const raw = new Uint8Array(3 + payload.length);
  raw[0] = command & 255; raw[1] = (command >>> 8) & 255; raw[2] = sequence; raw.set(payload, 3);
  return cobsEncode(raw);
}
function degrees(raw: number) { return [0, 90, 180, 270][raw & 3]; }
function mode(raw: number) { return (raw & 1) ? 'scroll' : 'cursor'; }
function expectLength(bytes: Uint8Array, expected: number, label: string) {
  if (bytes.length !== expected) throw new Error(label + ': expected ' + expected + ' bytes, received ' + bytes.length + '.');
}

function createLink(device: HidDeviceLike, label: string): Link {
  let closed = false, sequence = 0, rx = new Uint8Array(0);
  const frames: Uint8Array[] = [];
  const waiters: (() => void)[] = [];
  const wake = () => { while (waiters.length) waiters.shift()?.(); };
  const onReport: EventListener = (event) => {
    const data = (event as Event & { data: DataView }).data;
    rx = concat(rx, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    let end = rx.indexOf(0);
    while (end >= 0) {
      const item = rx.slice(0, end);
      rx = rx.slice(end + 1);
      if (item.length) frames.push(item);
      end = rx.indexOf(0);
    }
    wake();
  };
  device.addEventListener('inputreport', onReport);
  async function readFrame(timeout: number) {
    const deadline = Date.now() + timeout;
    while (!frames.length) {
      if (closed) throw new Error('RMK device disconnected.');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for RMK Rynk response.');
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const onWake = () => {
          if (done) return; done = true; clearTimeout(timer);
          const index = waiters.indexOf(onWake); if (index >= 0) waiters.splice(index, 1);
          resolve();
        };
        const timer = setTimeout(() => {
          if (done) return; done = true;
          const index = waiters.indexOf(onWake); if (index >= 0) waiters.splice(index, 1);
          reject(new Error('Timed out waiting for RMK Rynk response.'));
        }, remaining);
        waiters.push(onWake);
      });
    }
    return frames.shift()!;
  }
  async function send(bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length; offset += REPORT_SIZE) {
      const report = new Uint8Array(REPORT_SIZE);
      report.set(bytes.subarray(offset, offset + REPORT_SIZE));
      await device.sendReport(0, report);
    }
  }
  return {
    label,
    async request(command, payload, expected) {
      if (closed) throw new Error('RMK device is disconnected.');
      sequence = (sequence + 1) & 255;
      const seq = sequence;
      await send(frame(command, seq, payload));
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const incoming = await readFrame(Math.max(1, deadline - Date.now()));
        const raw = cobsDecode(incoming);
        if (raw.length < 3) continue;
        if ((raw[0] | (raw[1] << 8)) !== command || raw[2] !== seq) continue;
        const response = raw.slice(3);
        if (!response.length) throw new Error('Empty response for command 0x' + command.toString(16) + '.');
        if (response[0] !== 0) throw new Error('RMK rejected command 0x' + command.toString(16) + ' (response tag ' + response[0] + ').');
        const value = response.slice(1);
        expectLength(value, expected, 'Command 0x' + command.toString(16));
        return value;
      }
      throw new Error('Timed out waiting for command 0x' + command.toString(16) + '.');
    },
    async close() {
      if (closed) return;
      closed = true; device.removeEventListener('inputreport', onReport); wake();
      if (device.opened) await device.close();
    },
  };
}
function decodeConfig(id: number, b: Uint8Array): DeviceConfig {
  expectLength(b, 16, 'Device config');
  const rotationRaw = b[9] & 3;
  return {
    deviceId: id, device: id === 0 ? 'right' : 'left',
    cpi: b[0] | (b[1] << 8), cursorGainQ8: b[2] | (b[3] << 8),
    scrollDenominator: b[4] | (b[5] << 8), inertiaEnabled: b[6] !== 0,
    inertiaDecayNumerator: b[7], inertiaDecayDenominator: b[8], rotationRaw,
    rotationDegrees: degrees(rotationRaw), supportedFields: b[10], effectiveMode: mode(b[11]),
    directionNoiseThreshold: b[12], directionReverseThreshold: b[13], wireBytes: Array.from(b),
  };
}
function decodeProfile(layer: number, id: number, b: Uint8Array): LayerProfile {
  expectLength(b, 6, 'Layer profile');
  const vertical = b[3], packed = b[0], rotationRaw = b[5] & 3;
  return {
    layer, layerName: LAYERS[layer] || ('Layer ' + layer), deviceId: id,
    device: id === 0 ? 'right' : 'left', mode: mode(packed), cursorGainQ8: b[1] | (b[2] << 8),
    scrollDenominator: vertical, horizontalScrollDenominator: ((packed >>> 2) & 63) || vertical,
    inertiaEnabled: b[4] !== 0, rotationRaw, rotationDegrees: degrees(rotationRaw), wireBytes: Array.from(b),
  };
}
function saveJson(value: Backup) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'pg1kb-rmk-trackball-runtime-' + new Date().toISOString().slice(0, 10) + '.json';
  anchor.click(); URL.revokeObjectURL(url);
}

export default function RmkRuntimeBackup({ onDebug }: { onDebug: (event: string, detail?: unknown) => void }) {
  const [link, setLink] = useState<Link | null>(null);
  const linkRef = useRef<Link | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Read the live RMK settings before powering off or flashing.');
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true); setError(null); setMessage('Opening the RMK Rynk HID interface…');
    try {
      const hid = (navigator as NavigatorHid).hid;
      if (!hid) throw new Error('WebHID is unavailable. Use Chrome or Edge on localhost or HTTPS.');
      const devices = await hid.requestDevice({ filters: [{ usagePage: USAGE_PAGE, usage: USAGE }] });
      const device = devices[0];
      if (!device) { setMessage('No device selected.'); return; }
      if (!device.opened) await device.open();
      if (!device.collections.some((c) => c.usagePage === USAGE_PAGE && c.usage === USAGE)) {
        throw new Error('Selected device does not expose the RMK Rynk HID report.');
      }
      const next = createLink(device, device.productName || ('RMK ' + device.vendorId.toString(16) + ':' + device.productId.toString(16)));
      linkRef.current = next; setLink(next); setBackup(null);
      setMessage('Connected to ' + next.label + '. No settings have been changed.');
      onDebug('RMK Rynk HID connected', next.label);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text); setMessage(''); onDebug('RMK Rynk connection failed', text);
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await linkRef.current?.close(); linkRef.current = null; setLink(null); setBackup(null);
      setMessage('Disconnected. No firmware settings were changed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function readAll() {
    const current = linkRef.current;
    if (!current) return;
    setBusy(true); setError(null); setMessage('Reading live settings with read-only Rynk commands…'); setBackup(null);
    try {
      const right = await current.request(CMD.config, Uint8Array.of(0), 16);
      const left = await current.request(CMD.config, Uint8Array.of(1), 16);
      const profiles: LayerProfile[] = [];
      for (let layer = 0; layer < 8; layer++) {
        for (const id of [0, 1]) {
          profiles.push(decodeProfile(layer, id, await current.request(CMD.profile, Uint8Array.of(layer, id), 6)));
        }
      }
      const state = await current.request(CMD.state, new Uint8Array(0), 9);
      const saved = await current.request(CMD.saveStatus, new Uint8Array(0), 5);
      const saveNames = ['Idle', 'Pending', 'Saved', 'Save failed'];
      const result: Backup = {
        format: 'pg1kb-rmk-trackball-runtime', version: 1, exportedAt: new Date().toISOString(),
        deviceName: current.label, transport: 'Rynk WebHID', readOnly: true,
        commands: { getTrackballConfig: '0x0901', getSaveStatus: '0x0905', getTrackballState: '0x0906', getLayerProfile: '0x0907' },
        deviceConfigs: [decodeConfig(0, right), decodeConfig(1, left)], layerProfiles: profiles,
        activeState: {
          activeLayer: state[0], rightMode: mode(state[1]), leftMode: mode(state[2]),
          rightGainSixteenths: state[3], leftGainSixteenths: state[4],
          rightScrollDenominator: state[5], leftScrollDenominator: state[6],
          rightHorizontalScrollDenominator: state[7], leftHorizontalScrollDenominator: state[8],
          wireBytes: Array.from(state),
        },
        saveStatus: {
          statusCode: saved[0], status: saveNames[saved[0]] || ('Unknown (' + saved[0] + ')'),
          requestedGeneration: saved[1] | (saved[2] << 8), completedGeneration: saved[3] | (saved[4] << 8),
          wireBytes: Array.from(saved),
        },
      };
      if (result.layerProfiles.length !== 16) throw new Error('Incomplete backup: only ' + result.layerProfiles.length + '/16 profiles were read.');
      setBackup(result);
      setMessage('Read complete: 2 device configs, 16 layer profiles, active state and save status. No write commands were sent.');
      onDebug('RMK runtime backup read', { configs: 2, profiles: profiles.length, activeLayer: state[0] });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text); setMessage('Read failed. Keep the keyboard powered on and do not flash ZMK yet.');
      onDebug('RMK runtime backup failed', text);
    } finally { setBusy(false); }
  }

  return (
    <div className="rmk-runtime-backup">
      <section className="panel rmk-backup-panel">
        <div className="rmk-backup-heading">
          <div><h3>RMK Runtime Backup</h3><p>Capture the live PG1KB RMK trackball settings over Rynk. Read-only; no settings are written.</p></div>
          <div className="rmk-backup-actions">
            {!link ? <button className="button" onClick={() => void connect()} disabled={busy}>Connect RMK via WebHID</button> : <>
              <button className="button secondary" onClick={() => void readAll()} disabled={busy}>{busy ? 'Reading…' : 'Read all settings'}</button>
              <button className="button secondary" onClick={() => void disconnect()} disabled={busy}>Disconnect</button>
            </>}
          </div>
        </div>
        <div className="rmk-backup-notice"><strong>Read-only safety</strong><span>Uses 0x0901, 0x0905, 0x0906 and 0x0907 only. It does not call SET, SAVE, LOAD DEFAULTS or flash-write commands.</span></div>
        {link && <div className="status-strip"><span>Connected: {link.label}</span><code>Rynk / WebHID</code></div>}
        {message && <div className="status-strip"><span>{message}</span></div>}
        {error && <div className="notice">{error}</div>}
        {backup && <>
          <div className="rmk-backup-summary">
            <div><strong>{backup.deviceConfigs.length}/2</strong><span>Device configs</span></div>
            <div><strong>{backup.layerProfiles.length}/16</strong><span>Layer profiles</span></div>
            <div><strong>{LAYERS[backup.activeState.activeLayer] || backup.activeState.activeLayer}</strong><span>Active layer</span></div>
            <div><strong>{backup.saveStatus.status}</strong><span>Firmware save status</span></div>
          </div>
          <div className="rmk-backup-actions"><button className="button" onClick={() => { saveJson(backup); onDebug('RMK runtime JSON exported', { profiles: backup.layerProfiles.length }); }} disabled={busy || backup.layerProfiles.length !== 16}>Export JSON backup</button></div>
          <details className="rmk-backup-details">
            <summary>Review captured settings</summary>
            <h4>Device-level settings</h4>
            <div className="rmk-backup-table-wrap"><table><thead><tr><th>Device</th><th>CPI</th><th>Cursor gain Q8</th><th>Scroll denominator</th><th>Rotation</th><th>Inertia</th></tr></thead>
              <tbody>{backup.deviceConfigs.map((c) => <tr key={c.deviceId}><td>{c.device}</td><td>{c.cpi}</td><td>{c.cursorGainQ8}</td><td>{c.scrollDenominator}</td><td>{c.rotationDegrees}°</td><td>{c.inertiaEnabled ? 'On' : 'Off'}</td></tr>)}</tbody>
            </table></div>
            <h4>Layer profiles</h4>
            <div className="rmk-backup-table-wrap"><table><thead><tr><th>Layer</th><th>Device</th><th>Mode</th><th>Gain Q8</th><th>Vertical scroll</th><th>Horizontal scroll</th><th>Inertia</th><th>Rotation</th></tr></thead>
              <tbody>{backup.layerProfiles.map((p) => <tr key={p.layer + '-' + p.deviceId}><td>{p.layer}: {p.layerName}</td><td>{p.device}</td><td>{p.mode}</td><td>{p.cursorGainQ8}</td><td>{p.scrollDenominator}</td><td>{p.horizontalScrollDenominator}</td><td>{p.inertiaEnabled ? 'On' : 'Off'}</td><td>{p.rotationDegrees}°</td></tr>)}</tbody>
            </table></div>
            <p>Exported at {backup.exportedAt}. The JSON includes the raw bytes returned by firmware.</p>
          </details>
        </>}
      </section>
    </div>
  );
}
