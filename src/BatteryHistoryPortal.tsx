import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './i18n';
import './batteryHistory.css';

const BATTERY_SERVICE = 'battery_service';
const BATTERY_LEVEL = 'battery_level';
const STORAGE_KEY = 'mykeebstudio-pg1kb-battery-history-v1';
const SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
const MAX_POINTS_PER_SERIES = 2000;
const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const TOOL_EVENT = 'mykeebstudio-active-tool';

type BatteryPoint = { at: number; level: number };
type BatterySeries = { label: string; points: BatteryPoint[] };
type SavedDevice = { name: string; lastSeen: number; series: Record<string, BatterySeries> };
type HistoryStore = { version: 1; devices: Record<string, SavedDevice> };

type BatteryCharacteristic = { readValue(): Promise<DataView> };
type BatteryService = { uuid: string; getCharacteristic(uuid: string): Promise<BatteryCharacteristic> };
type BatteryGattServer = {
  connected: boolean;
  connect(): Promise<BatteryGattServer>;
  disconnect(): void;
  getPrimaryServices(uuid?: string): Promise<BatteryService[]>;
  getPrimaryService(uuid: string): Promise<BatteryService>;
};
type BatteryDevice = EventTarget & {
  id: string;
  name?: string;
  gatt?: BatteryGattServer | null;
};
type WebBluetoothApi = {
  requestDevice(options: {
    filters?: Array<{ services: string[] }>;
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<BatteryDevice>;
};
type SampleTarget = { key: string; label: string; characteristic: BatteryCharacteristic };

function emptyHistory(): HistoryStore {
  return { version: 1, devices: {} };
}

function readHistory(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyHistory();
    const parsed = JSON.parse(raw) as HistoryStore;
    if (parsed?.version !== 1 || !parsed.devices || typeof parsed.devices !== 'object') return emptyHistory();
    return parsed;
  } catch {
    return emptyHistory();
  }
}

function csvCell(value: string | number) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatTime(at: number) {
  return new Date(at).toLocaleString();
}

function BatteryChart({ points }: { points: BatteryPoint[] }) {
  const visible = points.slice(-48);
  if (visible.length === 0) return <div className="battery-history-chart-empty">No samples yet</div>;

  const width = 640;
  const height = 180;
  const padX = 28;
  const padY = 22;
  const levels = visible.map((point) => point.level);
  let minLevel = Math.max(0, Math.min(...levels) - 5);
  let maxLevel = Math.min(100, Math.max(...levels) + 5);
  if (maxLevel - minLevel < 10) {
    minLevel = Math.max(0, Math.min(90, minLevel - 5));
    maxLevel = Math.min(100, minLevel + 20);
  }
  const x = (index: number) => visible.length < 2
    ? width / 2
    : padX + (index / (visible.length - 1)) * (width - padX * 2);
  const y = (level: number) => height - padY - ((level - minLevel) / Math.max(1, maxLevel - minLevel)) * (height - padY * 2);
  const pointsString = visible.map((point, index) => `${x(index)},${y(point.level)}`).join(' ');

  return (
    <svg className="battery-history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Battery percentage history">
      {[0, 0.5, 1].map((fraction) => {
        const yy = padY + fraction * (height - padY * 2);
        const value = Math.round(maxLevel - fraction * (maxLevel - minLevel));
        return (
          <g key={fraction}>
            <line x1={padX} y1={yy} x2={width - padX} y2={yy} className="battery-history-gridline" />
            <text x="2" y={yy + 4} className="battery-history-axis-label">{value}%</text>
          </g>
        );
      })}
      {visible.length > 1 && <polyline points={pointsString} className="battery-history-line" />}
      {visible.map((point, index) => (
        <circle key={point.at} cx={x(index)} cy={y(point.level)} r={visible.length > 32 ? 2.5 : 4} className="battery-history-dot">
          <title>{`${point.level}% · ${formatTime(point.at)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function nativeToolTitle() {
  const active = document.querySelector<HTMLElement>('.tool-nav .nav-item.active');
  return (active?.textContent ?? '').trim() || 'Runtime Combo';
}

export default function BatteryHistoryPortal() {
  const { isJapanese } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const [device, setDevice] = useState<BatteryDevice | null>(null);
  const [targets, setTargets] = useState<SampleTarget[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryStore>(() => readHistory());
  const samplingRef = useRef(false);
  const bluetoothSupported = typeof navigator !== 'undefined'
    && !!(navigator as Navigator & { bluetooth?: WebBluetoothApi }).bluetooth;

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (!workspace) return undefined;
    const syncHosts = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
      setContentHost(document.querySelector<HTMLElement>('.content'));
    };
    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(workspace, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      setError(isJapanese
        ? '履歴をブラウザーに保存できません。空き容量またはプライバシー設定を確認してください。'
        : 'Could not save history in this browser. Check available storage and privacy settings.');
    }
  }, [history, isJapanese]);

  useEffect(() => {
    if (!contentHost) return;
    contentHost.classList.toggle('external-tool-active', open);
    return () => contentHost.classList.remove('external-tool-active');
  }, [contentHost, open]);

  useEffect(() => {
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id !== 'battery-history') setOpen(false);
    };
    const onDocumentClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('.tool-nav .nav-item');
      if (!button || button.classList.contains('battery-history-menu-item')) return;
      setOpen(false);
    };
    window.addEventListener(TOOL_EVENT, onToolEvent);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener(TOOL_EVENT, onToolEvent);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  async function sampleBatteryLevels(currentDevice: BatteryDevice, currentTargets: SampleTarget[]) {
    if (samplingRef.current || currentTargets.length === 0) return;
    samplingRef.current = true;
    setError(null);
    try {
      const now = Date.now();
      const readings = await Promise.all(currentTargets.map(async (target) => {
        const value = await target.characteristic.readValue();
        const level = value.getUint8(0);
        if (level < 0 || level > 100) throw new Error(`Invalid battery level from ${target.label}: ${level}`);
        return { target, level };
      }));
      setHistory((previous) => {
        const next: HistoryStore = {
          version: 1,
          devices: { ...previous.devices },
        };
        const prior = next.devices[currentDevice.id];
        const series: Record<string, BatterySeries> = { ...(prior?.series ?? {}) };
        for (const { target, level } of readings) {
          const oldPoints = series[target.key]?.points ?? [];
          const cutoff = now - HISTORY_WINDOW_MS;
          const points = oldPoints.filter((point) => point.at >= cutoff);
          if (!points.length || now - points[points.length - 1].at >= 60_000) {
            points.push({ at: now, level });
          } else {
            points[points.length - 1] = { at: now, level };
          }
          series[target.key] = {
            label: target.label,
            points: points.slice(-MAX_POINTS_PER_SERIES),
          };
        }
        next.devices[currentDevice.id] = {
          name: currentDevice.name?.trim() || prior?.name || 'PG1KB',
          lastSeen: now,
          series,
        };
        return next;
      });
      setMessage(isJapanese
        ? `${readings.length} 個のバッテリー値を ${formatTime(now)} に記録しました。`
        : `Recorded ${readings.length} battery reading(s) at ${formatTime(now)}.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(isJapanese
        ? `バッテリー値を取得できませんでした: ${text}`
        : `Could not read battery level: ${text}`);
    } finally {
      samplingRef.current = false;
    }
  }

  useEffect(() => {
    if (!connected || !device || targets.length === 0) return undefined;
    const timer = window.setInterval(() => {
      void sampleBatteryLevels(device, targets);
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, device, targets]);

  async function connectBluetooth() {
    const bluetooth = (navigator as Navigator & { bluetooth?: WebBluetoothApi }).bluetooth;
    if (!bluetooth) {
      setError(isJapanese ? 'このブラウザーはWeb Bluetoothに対応していません。ChromeまたはEdgeを使用してください。' : 'Web Bluetooth is unavailable. Use a supported browser such as Chrome or Edge.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(isJapanese ? 'PG1KBのバッテリーサービスを検索しています…' : 'Looking for the PG1KB Battery Service…');
    try {
      const selected = await bluetooth.requestDevice({
        // Battery Service is not guaranteed to be listed in the BLE advertisement.
        // Let the user select PG1KB, then request access to the service explicitly.
        acceptAllDevices: true,
        optionalServices: [BATTERY_SERVICE],
      });
      if (!selected.gatt) throw new Error('This Bluetooth device does not expose GATT.');
      const server = selected.gatt.connected ? selected.gatt : await selected.gatt.connect();
      let batteryServices: BatteryService[] = [];
      try {
        batteryServices = await server.getPrimaryServices(BATTERY_SERVICE);
      } catch {
        batteryServices = [await server.getPrimaryService(BATTERY_SERVICE)];
      }
      const nextTargets: SampleTarget[] = [];
      for (let index = 0; index < batteryServices.length; index += 1) {
        const service = batteryServices[index];
        try {
          const characteristic = await service.getCharacteristic(BATTERY_LEVEL);
          nextTargets.push({
            key: `battery-${index}`,
            label: batteryServices.length > 1
              ? `Battery service ${index + 1}`
              : 'Battery level',
            characteristic,
          });
        } catch {
          // Skip a service that does not expose Battery Level.
        }
      }
      if (nextTargets.length === 0) throw new Error('No readable Battery Level characteristic (0x2A19) was found.');
      selected.addEventListener('gattserverdisconnected', () => {
        setConnected(false);
        setTargets([]);
        setMessage(isJapanese ? 'Bluetoothが切断されました。履歴はこのブラウザーに保存されています。' : 'Bluetooth disconnected. History remains saved in this browser.');
      }, { once: true });
      setDevice(selected);
      setTargets(nextTargets);
      setConnected(true);
      setMessage(isJapanese ? '接続しました。最初のサンプルを記録しています…' : 'Connected. Recording the first sample…');
      await sampleBatteryLevels(selected, nextTargets);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(isJapanese ? `接続できませんでした: ${text}` : `Could not connect: ${text}`);
      setConnected(false);
      setTargets([]);
    } finally {
      setBusy(false);
    }
  }

  function disconnectBluetooth() {
    device?.gatt?.disconnect();
    setConnected(false);
    setTargets([]);
    setMessage(isJapanese ? '切断しました。記録済みの履歴は残ります。' : 'Disconnected. Recorded history is retained.');
  }

  function exportCsv() {
    const rows = [['Device', 'Battery service', 'Timestamp ISO', 'Battery percent']];
    for (const saved of Object.values(history.devices)) {
      for (const series of Object.values(saved.series)) {
        for (const point of series.points) {
          rows.push([saved.name, series.label, new Date(point.at).toISOString(), String(point.level)]);
        }
      }
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pg1kb-battery-history.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function clearHistory() {
    const confirmed = window.confirm(isJapanese
      ? 'このブラウザーに保存したPG1KBのバッテリー履歴をすべて削除しますか？'
      : 'Delete all PG1KB battery history saved in this browser?');
    if (!confirmed) return;
    setHistory(emptyHistory());
    setMessage(isJapanese ? 'バッテリー履歴を削除しました。' : 'Battery history cleared.');
  }

  const savedDevices = Object.entries(history.devices).sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  const activeDeviceId = device?.id ?? null;

  function toggle() {
    setOpen((current) => {
      const next = !current;
      window.dispatchEvent(new CustomEvent(TOOL_EVENT, {
        detail: next
          ? { id: 'battery-history', title: isJapanese ? 'バッテリー履歴' : 'Battery History' }
          : { id: 'native', title: nativeToolTitle() },
      }));
      return next;
    });
  }

  return (
    <>
      {menuHost && createPortal(
        <button
          type="button"
          className={`nav-item battery-history-menu-item ${open ? 'active' : ''}`}
          onClick={toggle}
          title={isJapanese ? 'バッテリー残量の推移を記録・表示' : 'Record and view battery level history'}
        >
          <span aria-hidden="true">▥</span>
          <span>{isJapanese ? 'バッテリー履歴' : 'Battery History'}</span>
        </button>,
        menuHost,
      )}

      {open && contentHost && createPortal(
        <div className="embedded-tool-page battery-history-main-page">
          <section className="panel battery-history-toolbar">
            <div>
              <div className="eyebrow">PG1KB Proto PH3</div>
              <h3>{isJapanese ? 'バッテリー履歴' : 'Battery History'}</h3>
              <p>{isJapanese
                ? '既存のZMK Battery Serviceから残量を取得し、時系列でこのブラウザーに保存します。追加ハードウェアは不要です。'
                : 'Read the existing ZMK Battery Service and save a time series in this browser. No additional hardware is required.'}</p>
            </div>
            <div className="battery-history-actions">
              <button className="button" type="button" onClick={() => void connectBluetooth()} disabled={busy || connected || !bluetoothSupported}>
                {busy ? (isJapanese ? '接続中…' : 'Connecting…') : connected ? (isJapanese ? '接続中' : 'Connected') : (isJapanese ? 'Bluetooth接続' : 'Connect Bluetooth')}
              </button>
              {connected && <button className="button secondary" type="button" onClick={disconnectBluetooth} disabled={busy}>{isJapanese ? '切断' : 'Disconnect'}</button>}
              <button className="button secondary" type="button" onClick={() => device && targets.length ? void sampleBatteryLevels(device, targets) : setMessage(isJapanese ? 'まずBluetoothでPG1KBに接続してください。' : 'Connect to PG1KB over Bluetooth first.')} disabled={busy || !connected || targets.length === 0}>
                {isJapanese ? '今すぐ記録' : 'Sample now'}
              </button>
            </div>
          </section>

          {!bluetoothSupported && <div className="notice">{isJapanese ? 'Web Bluetooth非対応のブラウザーです。デスクトップ版ChromeまたはEdgeで開いてください。' : 'Web Bluetooth is not supported by this browser. Open MyKeebStudio in desktop Chrome or Edge.'}</div>}
          {error && <div className="notice">{error}</div>}
          {message && <div className="status-strip panel"><span>{message}</span></div>}

          <section className="panel battery-history-info">
            <div><strong>{isJapanese ? '記録間隔' : 'Sample interval'}</strong><span>15 {isJapanese ? '分' : 'minutes'}</span></div>
            <div><strong>{isJapanese ? '保存期間' : 'Retention'}</strong><span>90 {isJapanese ? '日' : 'days'}</span></div>
            <div><strong>{isJapanese ? '保存先' : 'Storage'}</strong><span>{isJapanese ? 'このブラウザーのみ' : 'This browser only'}</span></div>
          </section>

          {savedDevices.length === 0 ? (
            <section className="panel empty battery-history-empty">
              <h3>{isJapanese ? 'まだ履歴がありません' : 'No battery history yet'}</h3>
              <p>{isJapanese
                ? 'Bluetooth接続すると最初の残量を記録します。ページを開いて接続している間は15分ごとに記録します。'
                : 'Connect over Bluetooth to record the first level. While this page stays open and connected, a sample is recorded every 15 minutes.'}</p>
            </section>
          ) : (
            <div className="battery-history-device-list">
              {savedDevices.map(([id, saved]) => (
                <section className="panel battery-history-device" key={id}>
                  <div className="battery-history-device-heading">
                    <div>
                      <h3>{saved.name}</h3>
                      <p>{isJapanese ? '最終記録' : 'Last sample'}: {formatTime(saved.lastSeen)} {activeDeviceId === id && connected && <span className="battery-history-live">{isJapanese ? '接続中' : 'Connected'}</span>}</p>
                    </div>
                    <span>{Object.values(saved.series).reduce((total, series) => total + series.points.length, 0)} {isJapanese ? 'サンプル' : 'samples'}</span>
                  </div>
                  {Object.entries(saved.series).map(([key, series]) => {
                    const latest = series.points[series.points.length - 1];
                    return (
                      <div className="battery-history-series" key={key}>
                        <div className="battery-history-series-heading">
                          <strong>{series.label}</strong>
                          <span>{latest ? `${latest.level}%` : '—'}</span>
                        </div>
                        <BatteryChart points={series.points} />
                        <div className="battery-history-series-footer">
                          <span>{series.points.length} {isJapanese ? '件' : 'points'}</span>
                          <span>{latest ? formatTime(latest.at) : (isJapanese ? '記録なし' : 'No sample')}</span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )}

          <section className="battery-history-footer">
            <p>{isJapanese
              ? '履歴はこのブラウザーのローカルストレージに保存されます。タブを閉じた状態やキーボードの電源が切れている間は記録されません。左右の電池を別々に取得できるかはZMKの公開するサービスに依存し、左右の識別ができない場合もあります。残量値は電池の劣化診断値ではありません。'
              : 'History is stored in this browser’s local storage. Sampling pauses while this page is closed or the keyboard is off. Whether both halves are exposed separately depends on the Battery Services published by ZMK, and the services may not identify left vs. right. Battery Level is not a battery-health diagnosis.'}</p>
            <div className="battery-history-actions">
              <button className="button secondary" type="button" onClick={exportCsv} disabled={savedDevices.length === 0}>{isJapanese ? 'CSVを書き出す' : 'Export CSV'}</button>
              <button className="button danger" type="button" onClick={clearHistory} disabled={savedDevices.length === 0}>{isJapanese ? '履歴を削除' : 'Clear history'}</button>
            </div>
          </section>
        </div>,
        contentHost,
      )}
    </>
  );
}
