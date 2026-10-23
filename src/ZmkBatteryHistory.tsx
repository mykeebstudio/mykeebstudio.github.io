import { useEffect, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import './zmkBatteryHistory.css';

type HistoryEntry = { timestamp: number; level: number; index: number };
type SourceHistory = { sourceId: number; entries: HistoryEntry[]; total: number | null };
type HistoryMap = Record<number, SourceHistory>;
type Field = { field: number; wire: number; value: number | Uint8Array };

function readVarint(bytes: Uint8Array, state: { offset: number }): number {
  let value = 0n;
  let shift = 0n;
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return Number(value);
    shift += 7n;
    if (shift > 70n) throw new Error('Invalid protobuf varint');
  }
  throw new Error('Unexpected end of protobuf varint');
}

function readFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const tag = readVarint(bytes, state);
    if (tag === 0) throw new Error('Invalid protobuf tag');
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      fields.push({ field, wire, value: readVarint(bytes, state) });
    } else if (wire === 2) {
      const length = readVarint(bytes, state);
      const end = state.offset + length;
      if (length < 0 || end > bytes.length) throw new Error('Invalid protobuf length');
      fields.push({ field, wire, value: bytes.subarray(state.offset, end) });
      state.offset = end;
    } else if (wire === 1) {
      state.offset += 8;
    } else if (wire === 5) {
      state.offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    if (state.offset > bytes.length) throw new Error('Unexpected end of protobuf field');
  }
  return fields;
}

function bytesField(field: Field, expected: number): Uint8Array | null {
  return field.field === expected && field.wire === 2 && field.value instanceof Uint8Array
    ? field.value
    : null;
}

function numberField(field: Field, expected: number): number | null {
  return field.field === expected && field.wire === 0 && typeof field.value === 'number'
    ? field.value
    : null;
}

function decodeEntry(payload: Uint8Array): { timestamp: number; level: number } {
  let timestamp = 0;
  let level = 0;
  for (const field of readFields(payload)) {
    const value = numberField(field, field.field);
    if (value === null) continue;
    if (field.field === 1) timestamp = value;
    if (field.field === 2) level = value;
  }
  if (timestamp <= 0 || level < 0 || level > 100) throw new Error('Invalid battery history entry');
  return { timestamp, level };
}

function decodeNotification(payload: Uint8Array) {
  for (const wrapper of readFields(payload)) {
    const batteryMessage = bytesField(wrapper, 1);
    if (!batteryMessage) continue;
    let sourceId = 0;
    let total: number | null = null;
    let index = 0;
    let isLast = false;
    let entry: { timestamp: number; level: number } | null = null;
    for (const field of readFields(batteryMessage)) {
      const number = numberField(field, field.field);
      const nested = bytesField(field, field.field);
      if (field.field === 1 && number !== null) sourceId = number;
      else if (field.field === 2 && nested) entry = decodeEntry(nested);
      else if (field.field === 3 && number !== null) isLast = number !== 0;
      else if (field.field === 4 && number !== null) total = number;
      else if (field.field === 5 && number !== null) index = number;
    }
    if (entry) return { sourceId, total, index, isLast, entry };
  }
  return null;
}

function decodeResponse(payload: Uint8Array) {
  for (const field of readFields(payload)) {
    const nested = bytesField(field, field.field);
    if (!nested) continue;
    if (field.field === 1) {
      const errorField = readFields(nested).find((part) => part.field === 1 && part.wire === 2);
      const errorBytes = errorField?.value;
      const message = errorBytes instanceof Uint8Array ? new TextDecoder().decode(errorBytes) : 'Firmware returned an error';
      throw new Error(message);
    }
    if (field.field === 2 || field.field === 3) return;
  }
  throw new Error('Unrecognized battery history response');
}

function sourceLabel(sourceId: number, japanese: boolean) {
  if (sourceId === 0) return japanese ? '右側（Central）' : 'Right side (central)';
  return japanese ? `左側（Peripheral ${sourceId}）` : `Left side (peripheral ${sourceId})`;
}

function formatTimestamp(timestamp: number, japanese: boolean) {
  return new Date(timestamp * 1000).toLocaleString(japanese ? 'ja-JP' : undefined);
}

function HistoryChart({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <div className="zbh-empty">履歴データがありません</div>;
  const width = 720;
  const height = 200;
  const left = 38;
  const right = 12;
  const top = 18;
  const bottom = 28;
  const minTime = entries[0].timestamp;
  const maxTime = entries[entries.length - 1].timestamp;
  const x = (time: number) => maxTime === minTime
    ? width / 2
    : left + ((time - minTime) / (maxTime - minTime)) * (width - left - right);
  const y = (level: number) => top + ((100 - level) / 100) * (height - top - bottom);
  const points = entries.map((entry) => `${x(entry.timestamp)},${y(entry.level)}`).join(' ');
  return (
    <svg className="zbh-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Battery history chart">
      {[0, 25, 50, 75, 100].map((level) => (
        <g key={level}>
          <line x1={left} y1={y(level)} x2={width - right} y2={y(level)} className="zbh-gridline" />
          <text x={left - 8} y={y(level) + 4} textAnchor="end" className="zbh-axis-label">{level}%</text>
        </g>
      ))}
      {entries.length > 1 && <polyline points={points} className="zbh-line" />}
      {entries.map((entry) => (
        <circle key={`${entry.timestamp}-${entry.index}`} cx={x(entry.timestamp)} cy={y(entry.level)} r="3.5" className="zbh-point">
          <title>{`${entry.level}% · ${new Date(entry.timestamp * 1000).toLocaleString()}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function ZmkBatteryHistory({
  connection,
  subsystemIndex,
  japanese,
  onDebug,
}: {
  connection: RpcConnection;
  subsystemIndex: number;
  japanese: boolean;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [history, setHistory] = useState<HistoryMap>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(japanese ? '履歴の読み出しを開始してください。' : 'Request battery history to begin.');
  const [error, setError] = useState<string | null>(null);
  const collectingRef = useRef(false);

  useEffect(() => {
    return subscribeNotifications(connection, (value) => {
      const notification = value.custom?.customNotification;
      if (!notification || notification.subsystemIndex !== subsystemIndex) return;
      try {
        const decoded = decodeNotification(notification.payload);
        if (!decoded) return;
        onDebug('Battery history notification', {
          sourceId: decoded.sourceId,
          index: decoded.index,
          total: decoded.total,
          isLast: decoded.isLast,
          timestamp: decoded.entry.timestamp,
          level: decoded.entry.level,
        });
        setHistory((previous) => {
          const current = previous[decoded.sourceId] ?? {
            sourceId: decoded.sourceId,
            entries: [],
            total: null,
          };
          const entries = current.entries.filter((entry) => entry.index !== decoded.index);
          entries.push({ ...decoded.entry, index: decoded.index });
          entries.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
          return {
            ...previous,
            [decoded.sourceId]: {
              sourceId: decoded.sourceId,
              entries,
              total: decoded.total ?? current.total,
            },
          };
        });
        if (decoded.isLast) {
          setMessage(japanese
            ? `${sourceLabel(decoded.sourceId, true)}の履歴を受信しました。`
            : `Received history from ${sourceLabel(decoded.sourceId, false)}.`);
        } else if (collectingRef.current) {
          setMessage(japanese ? 'ファームウェアから履歴を受信中…' : 'Receiving history from firmware…');
        }
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        onDebug('Battery history notification decode failed', text);
        setError(text);
      }
    });
  }, [connection, subsystemIndex, japanese]);

  async function requestHistory() {
    setBusy(true);
    setError(null);
    setHistory({});
    collectingRef.current = true;
    setMessage(japanese ? 'ファームウェアに履歴を要求しています…' : 'Requesting history from firmware…');
    try {
      const response = await call_rpc(connection, {
        custom: { call: { subsystemIndex, payload: new Uint8Array([0x0a, 0x00]) } },
      });
      const payload = response.custom?.call?.payload;
      if (!payload) throw new Error('Battery history subsystem returned no response payload');
      decodeResponse(payload);
      setMessage(japanese
        ? '要求を受け付けました。通知で届く履歴を表示しています。'
        : 'Request accepted. Displaying history entries as notifications arrive.');
      onDebug('Battery history request accepted');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(japanese ? '履歴の要求に失敗しました。' : 'Battery history request failed.');
      onDebug('Battery history request failed', text);
    } finally {
      collectingRef.current = false;
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm(japanese
      ? 'キーボード本体に保存されたバッテリー履歴を消去しますか？この操作は取り消せません。'
      : 'Clear battery history stored on the keyboard? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await call_rpc(connection, {
        custom: { call: { subsystemIndex, payload: new Uint8Array([0x12, 0x00]) } },
      });
      const payload = response.custom?.call?.payload;
      if (!payload) throw new Error('Battery history subsystem returned no response payload');
      decodeResponse(payload);
      setHistory({});
      setMessage(japanese ? 'ファームウェアに履歴消去を要求しました。' : 'Clear request accepted by firmware.');
      onDebug('Battery history clear request accepted');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Battery history clear request failed', text);
    } finally {
      setBusy(false);
    }
  }

  const sources = Object.values(history).sort((a, b) => a.sourceId - b.sourceId);
  const totalEntries = sources.reduce((sum, source) => sum + source.entries.length, 0);

  return (
    <div className="zbh-page">
      <section className="panel zbh-toolbar">
        <div>
          <div className="eyebrow">PG1KB Proto PH3</div>
          <h3>{japanese ? '本体保存バッテリー履歴' : 'On-device battery history'}</h3>
          <p>{japanese
            ? 'ファームウェアのフラッシュ保存履歴をZMK Studio RPC経由で読み出します。ブラウザー側で新しい履歴を採取する機能ではありません。'
            : 'Read flash-persisted history from the firmware through ZMK Studio RPC; this does not sample new history in the browser.'}</p>
        </div>
        <div className="zbh-actions">
          <button className="button" type="button" onClick={() => void requestHistory()} disabled={busy}>
            {busy ? (japanese ? '要求中…' : 'Requesting…') : (japanese ? '履歴を読み出す' : 'Read history')}
          </button>
          <button className="button secondary" type="button" onClick={() => void clearHistory()} disabled={busy}>
            {japanese ? '本体の履歴を消去' : 'Clear device history'}
          </button>
        </div>
      </section>
      {message && <div className="status-strip panel">{message}</div>}
      {error && <div className="notice">{error}</div>}
      <section className="panel zbh-summary">
        <div><strong>{japanese ? '受信件数' : 'Entries received'}</strong><span>{totalEntries}</span></div>
        <div><strong>{japanese ? 'デバイス数' : 'Sources'}</strong><span>{sources.length}</span></div>
        <div><strong>{japanese ? '保存先' : 'Source'}</strong><span>{japanese ? 'キーボード本体のフラッシュ' : 'Keyboard flash storage'}</span></div>
      </section>
      {sources.length === 0 ? (
        <section className="panel empty zbh-no-data">
          <h3>{japanese ? '履歴データがありません' : 'No history received yet'}</h3>
          <p>{japanese
            ? '「履歴を読み出す」を押すと、右側・左側のファームウェアから記録済みデータを取得します。'
            : 'Select “Read history” to request stored entries from the central and peripheral firmware.'}</p>
        </section>
      ) : sources.map((source) => {
        const latest = source.entries[source.entries.length - 1];
        return (
          <section className="panel zbh-source" key={source.sourceId}>
            <div className="zbh-source-heading">
              <div><h3>{sourceLabel(source.sourceId, japanese)}</h3><p>{source.entries.length} / {source.total ?? source.entries.length} {japanese ? '件' : 'entries'}</p></div>
              <strong>{latest ? `${latest.level}%` : '—'}</strong>
            </div>
            <HistoryChart entries={source.entries} />
            <div className="zbh-table-wrap">
              <table className="zbh-table">
                <thead><tr><th>{japanese ? '日時（ファームウェア記録時刻）' : 'Timestamp (firmware)'}</th><th>{japanese ? '残量' : 'Level'}</th></tr></thead>
                <tbody>
                  {[...source.entries].reverse().map((entry) => (
                    <tr key={`${entry.timestamp}-${entry.index}`}><td>{formatTimestamp(entry.timestamp, japanese)}</td><td>{entry.level}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="zbh-footnote">{japanese
        ? '記録時刻はファームウェアのUnix時刻です。RTCがない場合、時刻の正確さはファームウェア側の時刻基準に依存します。履歴は記録済みのエントリーのみ表示されます。'
        : 'Timestamps are Unix seconds supplied by firmware. If the device has no real-time clock, timestamp accuracy depends on the firmware time base. Only entries actually recorded by the firmware are shown.'}</p>
    </div>
  );
}
