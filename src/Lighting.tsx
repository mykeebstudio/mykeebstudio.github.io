import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import {
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  encodeListSettingsRequest,
  encodeWriteSettingRequest,
  type CustomSettingRecord,
  type CustomSettingValue,
} from './customSettingsSafeProtocol';
import {
  encodeDiscardSettingsForSourceRequest,
  encodeResetSettingsForSourceRequest,
  encodeSaveSettingsForSourceRequest,
} from './customSettingsSplitProtocol';
import './lighting.css';

const SOURCE_LOCAL = 0;
const EXPECTED_LIGHTING_SETTINGS = 28;

const AMBIENT_EFFECTS = [
  { value: 0, name: 'Firefly', description: 'Soft random glows that appear and fade independently.' },
  { value: 1, name: 'Breathing', description: 'All LEDs slowly breathe in and out together.' },
  { value: 2, name: 'Comet', description: 'A bright point with a fading tail travels around the LED chain.' },
  { value: 3, name: 'Sparkle', description: 'Small groups of stars jump to random positions.' },
  { value: 4, name: 'Rainbow Wave', description: 'A moving rainbow gradient flows across the LED chain.' },
] as const;

type Props = {
  connection: RpcConnection;
  customSettingsSubsystemIndex: number;
  lightingSubsystemIndex: number;
  layerNames: string[];
  onDebug: (event: string, detail?: unknown) => void;
};

function token(setting: CustomSettingRecord) {
  return `${setting.customSubsystemIndex}:${setting.source}:${setting.key}`;
}

function intValue(setting: CustomSettingRecord | undefined, fallback: number) {
  return setting?.value?.type === 'int32' ? setting.value.value : fallback;
}

function boolValue(setting: CustomSettingRecord | undefined, fallback: boolean) {
  return setting?.value?.type === 'bool' ? setting.value.value : fallback;
}

function colorHex(value: number) {
  return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0').toUpperCase()}`;
}

function colorInt(value: string) {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(0xffffff, parsed)) : 0;
}

export default function Lighting({
  connection,
  customSettingsSubsystemIndex,
  lightingSubsystemIndex,
  layerNames,
  onDebug,
}: Props) {
  const [settings, setSettings] = useState<CustomSettingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<Map<string, CustomSettingRecord>>(new Map());

  const byKey = useMemo(() => {
    const result = new Map<string, CustomSettingRecord>();
    for (const setting of settings) {
      if (setting.customSubsystemIndex === lightingSubsystemIndex && setting.source === SOURCE_LOCAL) {
        result.set(setting.key, setting);
      }
    }
    return result;
  }, [settings, lightingSubsystemIndex]);

  const unsaved = [...byKey.values()].filter((setting) => setting.hasUnsavedValue).length;

  async function callSettings(payload: Uint8Array, label: string) {
    onDebug(`RPC -> Lighting ${label}`, { bytes: payload.length });
    const response = await call_rpc(connection, {
      custom: { call: { subsystemIndex: customSettingsSubsystemIndex, payload } },
    });
    const bytes = response.custom?.call?.payload;
    if (!bytes) throw new Error(`Lighting ${label} returned no payload.`);
    const status = decodeCustomSettingsResponse(bytes);
    onDebug(`RPC <- Lighting ${label}`, status);
    return status;
  }

  async function load() {
    setLoading(true);
    setError(null);
    settingsRef.current = new Map();
    try {
      const status = await callSettings(encodeListSettingsRequest(true), 'list_settings');
      const deadline = performance.now() + 1600;
      while (performance.now() < deadline) {
        const count = [...settingsRef.current.values()].filter(
          (setting) => setting.customSubsystemIndex === lightingSubsystemIndex && setting.source === SOURCE_LOCAL,
        ).length;
        if (count >= EXPECTED_LIGHTING_SETTINGS || settingsRef.current.size >= status.affectedCount) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const loaded = [...settingsRef.current.values()].filter(
        (setting) => setting.customSubsystemIndex === lightingSubsystemIndex && setting.source === SOURCE_LOCAL,
      );
      setSettings(loaded);
      setMessage(loaded.length ? `Loaded ${loaded.length} Lighting setting(s).` : 'Lighting subsystem is present, but no settings were returned.');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Lighting load failed', text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeNotifications(connection, (notification) => {
      const custom = notification.custom?.customNotification;
      if (!custom || custom.subsystemIndex !== customSettingsSubsystemIndex) return;
      try {
        const decoded = decodeCustomSettingsNotification(custom.payload);
        if (!decoded) return;
        const setting = decoded.setting;
        if (setting.customSubsystemIndex !== lightingSubsystemIndex || setting.source !== SOURCE_LOCAL) return;
        settingsRef.current.set(token(setting), setting);
        setSettings(
          [...settingsRef.current.values()]
            .filter((item) => item.customSubsystemIndex === lightingSubsystemIndex && item.source === SOURCE_LOCAL)
            .sort((a, b) => a.key.localeCompare(b.key)),
        );
      } catch (cause) {
        onDebug('Lighting notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    void load();
    return unsubscribe;
  }, [connection, customSettingsSubsystemIndex, lightingSubsystemIndex]);

  async function stage(key: string, value: CustomSettingValue) {
    const setting = byKey.get(key);
    if (!setting) return;
    setError(null);
    try {
      await callSettings(encodeWriteSettingRequest(setting, value), `write(${key})`);
      const next = { ...setting, value, hasUnsavedValue: true };
      settingsRef.current.set(token(next), next);
      setSettings((current) => current.map((item) => item.key === key ? next : item));
      setMessage(`${key} previewed live. ${unsaved + (setting.hasUnsavedValue ? 0 : 1)} unsaved change(s).`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug(`Lighting write failed: ${key}`, text);
    }
  }

  async function mutate(kind: 'save' | 'discard' | 'reset') {
    setBusy(true);
    setError(null);
    try {
      const payload = kind === 'save'
        ? encodeSaveSettingsForSourceRequest(lightingSubsystemIndex, SOURCE_LOCAL)
        : kind === 'discard'
          ? encodeDiscardSettingsForSourceRequest(lightingSubsystemIndex, SOURCE_LOCAL)
          : encodeResetSettingsForSourceRequest(lightingSubsystemIndex, SOURCE_LOCAL);
      await callSettings(payload, kind);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await load();
      setMessage(kind === 'save' ? 'Lighting settings saved to firmware.' : kind === 'discard' ? 'Unsaved Lighting changes discarded.' : 'Lighting settings reset to firmware defaults.');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug(`Lighting ${kind} failed`, text);
    } finally {
      setBusy(false);
    }
  }

  const setting = (key: string) => byKey.get(key);
  const setInt = (key: string, value: number) => void stage(key, { type: 'int32', value });
  const setBool = (key: string, value: boolean) => void stage(key, { type: 'bool', value });

  function ColorControl({ settingKey, label }: { settingKey: string; label: string }) {
    const value = intValue(setting(settingKey), 0);
    return (
      <label className="lighting-color-row">
        <span>{label}</span>
        <input type="color" value={colorHex(value)} disabled={busy} onChange={(event) => setInt(settingKey, colorInt(event.target.value))} />
        <code>{colorHex(value)}</code>
      </label>
    );
  }

  function Slider({ settingKey, label, min, max, step = 1, unit = '' }: { settingKey: string; label: string; min: number; max: number; step?: number; unit?: string }) {
    const value = intValue(setting(settingKey), min);
    return (
      <label className="lighting-slider-row">
        <span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} disabled={busy} onChange={(event) => setInt(settingKey, Number(event.target.value))} />
        <strong>{value}{unit}</strong>
      </label>
    );
  }

  if (loading && !settings.length) {
    return <div className="panel empty"><div><h3>Lighting</h3><p>Reading lighting settings from firmware…</p></div></div>;
  }

  const ambientEffect = intValue(setting('ambient_effect'), 0);
  const ambientInfo = AMBIENT_EFFECTS.find((effect) => effect.value === ambientEffect) ?? AMBIENT_EFFECTS[0];

  return (
    <div className="lighting-page">
      <div className="lighting-toolbar panel">
        <div>
          <strong>Live preview</strong>
          <small>Changes are staged in RAM immediately. Save writes them to firmware.</small>
        </div>
        <div className="actions">
          <span className={unsaved ? 'pill' : 'pill muted'}>{unsaved} unsaved</span>
          <button className="button secondary" disabled={busy || !unsaved} onClick={() => void mutate('discard')}>Discard</button>
          <button className="button secondary" disabled={busy} onClick={() => void mutate('reset')}>Reset defaults</button>
          <button className="button" disabled={busy || !unsaved} onClick={() => void mutate('save')}>Save</button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}
      {message && <div className="lighting-message">{message}</div>}

      <div className="lighting-grid">
        <section className="panel lighting-card">
          <div className="panel-heading">
            <div><h3>Ambient · {ambientInfo.name}</h3><p>{ambientInfo.description}</p></div>
            <label className="lighting-switch"><input type="checkbox" checked={boolValue(setting('enabled'), true)} disabled={busy} onChange={(event) => setBool('enabled', event.target.checked)} /><span>{boolValue(setting('enabled'), true) ? 'On' : 'Off'}</span></label>
          </div>

          <label className="lighting-select-row">
            <span>Effect</span>
            <select value={ambientEffect} disabled={busy} onChange={(event) => setInt('ambient_effect', Number(event.target.value))}>
              {AMBIENT_EFFECTS.map((effect) => <option key={effect.value} value={effect.value}>{effect.name}</option>)}
            </select>
          </label>

          {ambientEffect !== 4 && <ColorControl settingKey="ambient_color" label="Ambient color" />}
          <Slider settingKey="ambient_brightness" label="Brightness" min={0} max={100} unit="%" />

          {ambientEffect === 0 && <>
            <Slider settingKey="firefly_count" label="Max fireflies" min={1} max={8} />
            <Slider settingKey="firefly_interval_ms" label="Spawn interval" min={100} max={5000} step={50} unit=" ms" />
            <Slider settingKey="firefly_fade_ms" label="Glow duration" min={100} max={5000} step={50} unit=" ms" />
            <Slider settingKey="firefly_variation" label="Brightness variation" min={0} max={50} unit="%" />
          </>}

          {ambientEffect === 1 &&
            <Slider settingKey="ambient_period_ms" label="Breathing cycle" min={400} max={10000} step={100} unit=" ms" />}

          {ambientEffect === 2 && <>
            <Slider settingKey="ambient_period_ms" label="One lap" min={400} max={10000} step={100} unit=" ms" />
            <Slider settingKey="firefly_count" label="Tail length" min={1} max={8} />
          </>}

          {ambientEffect === 3 && <>
            <Slider settingKey="ambient_period_ms" label="Sparkle tempo" min={400} max={10000} step={100} unit=" ms" />
            <Slider settingKey="firefly_count" label="Stars at once" min={1} max={8} />
            <Slider settingKey="firefly_variation" label="Brightness variation" min={0} max={50} unit="%" />
          </>}

          {ambientEffect === 4 &&
            <Slider settingKey="ambient_period_ms" label="Rainbow cycle" min={400} max={10000} step={100} unit=" ms" />}
        </section>

        <section className="panel lighting-card">
          <div className="panel-heading">
            <div><h3>Layer indicator</h3><p>Layer status temporarily overrides the selected ambient effect.</p></div>
            <label className="lighting-switch"><input type="checkbox" checked={boolValue(setting('layer_enabled'), true)} disabled={busy} onChange={(event) => setBool('layer_enabled', event.target.checked)} /><span>{boolValue(setting('layer_enabled'), true) ? 'On' : 'Off'}</span></label>
          </div>
          <label className="lighting-select-row"><span>Display mode</span><select value={intValue(setting('layer_mode'), 0)} disabled={busy} onChange={(event) => setInt('layer_mode', Number(event.target.value))}><option value={0}>While non-base layer is active</option><option value={1}>Flash on every layer change</option></select></label>
          <Slider settingKey="layer_duration_ms" label="Flash duration" min={100} max={3000} step={50} unit=" ms" />
          <Slider settingKey="layer_brightness" label="Brightness" min={1} max={100} unit="%" />
          <div className="lighting-color-list">
            {Array.from({ length: 6 }, (_, index) => (
              <ColorControl key={index} settingKey={`layer_color_${index}`} label={layerNames[index] || (index === 0 ? 'Base' : `Layer ${index}`)} />
            ))}
          </div>
        </section>

        <section className="panel lighting-card lighting-card-wide">
          <div className="panel-heading">
            <div><h3>Bluetooth profiles</h3><p>Profile selection has highest priority, then returns to the current layer or ambient effect.</p></div>
            <label className="lighting-switch"><input type="checkbox" checked={boolValue(setting('bt_enabled'), true)} disabled={busy} onChange={(event) => setBool('bt_enabled', event.target.checked)} /><span>{boolValue(setting('bt_enabled'), true) ? 'On' : 'Off'}</span></label>
          </div>
          <div className="lighting-two-col">
            <div>
              <Slider settingKey="bt_duration_ms" label="Display duration" min={100} max={3000} step={50} unit=" ms" />
              <Slider settingKey="bt_brightness" label="Brightness" min={1} max={100} unit="%" />
              <label className="lighting-select-row"><span>Effect</span><select value={intValue(setting('bt_effect'), 1)} disabled={busy} onChange={(event) => setInt('bt_effect', Number(event.target.value))}><option value={0}>Solid</option><option value={1}>Single pulse</option><option value={2}>Double pulse</option></select></label>
            </div>
            <div className="lighting-color-list">
              {Array.from({ length: 5 }, (_, index) => <ColorControl key={index} settingKey={`bt_color_${index}`} label={`Profile ${index}`} />)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
