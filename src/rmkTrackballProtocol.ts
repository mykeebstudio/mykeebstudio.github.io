export type RmkTrackballConfig = {
  deviceId: 0 | 1;
  cpi: number;
  cursorGainQ8: number;
  scrollScaleDen: number;
  inertiaEnabled: boolean;
  inertiaDecayNum: number;
  inertiaDecayDen: number;
  rotation: 0 | 1 | 2 | 3;
  capabilities: number;
  mode: 'cursor' | 'scroll';
};

const CMD_GET_VERSION = 0x0001;
const CMD_GET_TRACKBALL_CONFIG = 0x0901;
const CMD_SET_TRACKBALL_CONFIG = 0x0902;
const RYNK_HID_REPORT_SIZE = 32;
const RYNK_TOPIC_BIT = 0x8000;

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((v) => v.toString(16).padStart(2, '0')).join(' ');
}

function cobsEncode(input: Uint8Array) {
  const out = new Uint8Array(input.length + Math.ceil(input.length / 254) + 2);
  let read = 0;
  let write = 1;
  let codeIndex = 0;
  let code = 1;

  while (read < input.length) {
    if (input[read] === 0) {
      out[codeIndex] = code;
      codeIndex = write++;
      code = 1;
      read += 1;
    } else {
      out[write++] = input[read++];
      code += 1;
      if (code === 0xff) {
        out[codeIndex] = code;
        codeIndex = write++;
        code = 1;
      }
    }
  }
  out[codeIndex] = code;
  out[write++] = 0;
  return out.slice(0, write);
}

function cobsDecode(input: Uint8Array) {
  const out: number[] = [];
  let offset = 0;
  while (offset < input.length) {
    const code = input[offset++];
    if (code === 0) throw new Error('Invalid COBS frame');
    const end = offset + code - 1;
    if (end > input.length) throw new Error('Truncated COBS frame');
    while (offset < end) out.push(input[offset++]);
    if (code !== 0xff && offset < input.length) out.push(0);
  }
  return Uint8Array.from(out);
}

function u16le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function putU16le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

type Pending = {
  seq: number;
  resolve: (payload: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: number;
};

export class RmkTrackballClient {
  private device: any;
  private rx = new Uint8Array(0);
  private seq = 1;
  private pending: Pending | null = null;
  private reportHandler: ((event: any) => void) | null = null;

  private constructor(device: any) {
    this.device = device;
  }

  static async connect() {
    const hid = (navigator as any).hid;
    if (!hid) throw new Error('WebHID is unavailable. Use Chrome or Edge.');
    const devices = await hid.requestDevice({ filters: [{ usagePage: 0xff14, usage: 0x61 }] });
    if (!devices.length) throw new Error('No RMK Rynk HID device selected.');
    const client = new RmkTrackballClient(devices[0]);
    await client.open();
    const version = await client.request(CMD_GET_VERSION, new Uint8Array(0));
    if (!version.length || version[0] !== 0) {
      await client.close();
      throw new Error(`Selected device did not answer as an RMK Rynk keyboard. reply=[${hex(version)}]`);
    }
    return client;
  }

  get label() {
    return this.device?.productName || 'RMK keyboard';
  }

  private async open() {
    if (!this.device.opened) await this.device.open();
    this.reportHandler = (event: any) => {
      const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      this.rx = concat(this.rx, data);
      this.drainFrames();
    };
    this.device.addEventListener('inputreport', this.reportHandler);
  }

  async close() {
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error('RMK link closed'));
      this.pending = null;
    }
    if (this.reportHandler) this.device.removeEventListener('inputreport', this.reportHandler);
    this.reportHandler = null;
    try { await this.device.close(); } catch { /* ignore */ }
  }

  private drainFrames() {
    for (;;) {
      const delimiter = this.rx.indexOf(0);
      if (delimiter < 0) return;
      const encoded = this.rx.slice(0, delimiter);
      this.rx = this.rx.slice(delimiter + 1);
      if (!encoded.length) continue;
      let decoded: Uint8Array;
      try { decoded = cobsDecode(encoded); } catch { continue; }
      if (decoded.length < 3) continue;
      const cmd = decoded[0] | (decoded[1] << 8);
      const seq = decoded[2];
      if (cmd & RYNK_TOPIC_BIT) continue;
      if (!this.pending || this.pending.seq !== seq) continue;
      const pending = this.pending;
      this.pending = null;
      window.clearTimeout(pending.timer);
      pending.resolve(decoded.slice(3));
    }
  }

  private async sendFrame(frame: Uint8Array) {
    const framed = concat(Uint8Array.of(0), frame);
    for (let offset = 0; offset < framed.length; offset += RYNK_HID_REPORT_SIZE) {
      const report = new Uint8Array(RYNK_HID_REPORT_SIZE);
      report.set(framed.subarray(offset, offset + RYNK_HID_REPORT_SIZE));
      await this.device.sendReport(0, report);
    }
  }

  private async request(cmd: number, payload: Uint8Array) {
    if (this.pending) throw new Error('Another RMK request is still pending.');
    const seq = this.seq++ || 1;
    if (this.seq > 255) this.seq = 1;
    const logical = new Uint8Array(3 + payload.length);
    logical[0] = cmd & 0xff;
    logical[1] = (cmd >>> 8) & 0xff;
    logical[2] = seq;
    logical.set(payload, 3);
    const frame = cobsEncode(logical);

    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.seq === seq) this.pending = null;
        reject(new Error(`RMK request 0x${cmd.toString(16)} timed out`));
      }, 1500);
      this.pending = { seq, resolve, reject, timer };
    });
    await this.sendFrame(frame);
    return response;
  }

  async getTrackballConfig(deviceId: 0 | 1): Promise<RmkTrackballConfig> {
    const payload = await this.request(CMD_GET_TRACKBALL_CONFIG, Uint8Array.of(deviceId));
    if (payload.length < 17 || payload[0] !== 0) {
      throw new Error(`RMK get trackball config failed. reply=[${hex(payload)}] len=${payload.length}`);
    }
    const data = payload.slice(1, 17);
    return {
      deviceId,
      cpi: u16le(data, 0),
      cursorGainQ8: u16le(data, 2),
      scrollScaleDen: u16le(data, 4),
      inertiaEnabled: data[6] !== 0,
      inertiaDecayNum: data[7],
      inertiaDecayDen: data[8] || 1,
      rotation: (data[9] & 0x03) as 0 | 1 | 2 | 3,
      capabilities: data[10],
      mode: data[11] === 1 ? 'scroll' : 'cursor',
    };
  }

  async setTrackballConfig(config: RmkTrackballConfig) {
    const data = new Uint8Array(17);
    data[0] = config.deviceId;
    putU16le(data, 1, config.cpi);
    putU16le(data, 3, config.cursorGainQ8);
    putU16le(data, 5, config.scrollScaleDen);
    data[7] = config.inertiaEnabled ? 1 : 0;
    data[8] = config.inertiaDecayNum;
    data[9] = config.inertiaDecayDen || 1;
    data[10] = config.rotation;
    const response = await this.request(CMD_SET_TRACKBALL_CONFIG, data);
    if (!response.length || response[0] !== 0) {
      throw new Error(`RMK set trackball config failed. reply=[${hex(response)}] len=${response.length}`);
    }
  }
}
