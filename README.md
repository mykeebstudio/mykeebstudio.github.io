# MyKeebStudio

A lightweight local web UI for inspecting, testing, and exporting data from ZMK Studio enabled firmware.

MyKeebStudio is intentionally useful as a developer/diagnostic companion to DYA Studio rather than a replacement for it.

## v0.6

### Runtime Combo

- Connect to ZMK Studio over Web Serial
- Detect DYA-compatible Custom Studio RPC subsystems
- Read Runtime Combos
- Edit combo key positions from the firmware's physical layout
- Select behaviors by firmware-provided display name
- Save and re-read state from firmware
- Compatibility fallback for older/broken `list_combos` implementations

### Keymap

- Reads the active physical layout from firmware
- Reads all layers with standard `keymap.getKeymap`
- Switch between layers and edit bindings
- Displays behavior names when available
- Supports GUI selection for key behaviors and layer parameters when metadata is available
- Export the current layer as PNG
- Export every layer as individual PNG files
- Export all layers as one PDF, one layer per page
- Backup / Restore is integrated into the Keymap workspace

### Tools

- Key Tester in the main content area
- BLE Management in the main content area when compatible firmware exposes `mykeeb__ble_management`
- Trackball runtime settings
- Custom Settings
- Persistent Debug Console
- RPC timing/payload logs
- Clean Web Serial teardown so another Studio can connect immediately after disconnect

## Development

After pulling a version that changes dependencies, run:

```bash
npm install
npm run dev
```

On Windows PowerShell in environments where `npm.ps1` is blocked:

```powershell
npm.cmd install
npm.cmd run dev
```

Production build:

```bash
npm run build
```

## Architecture

```text
ZMK firmware
  |
  | ZMK Studio RPC / DYA-compatible Custom RPC
  v
MyKeebStudio
  |- Keymap editor + Backup / Restore
  |- Key Tester
  |- Trackball settings
  |- Runtime Combo inspector/editor
  |- BLE Management
  |- Custom Settings
  `- Debug Console
```

Legacy `my-zmk-studio-*` localStorage keys are intentionally retained for compatibility so existing user settings are not reset by the branding change.


## PG1KB RMK Runtime Backup (experimental)

The RMK Runtime Backup tool is separate from the ZMK Studio serial connection. In Chrome or Edge on localhost/HTTPS, select it from the sidebar, connect to the keyboard's Rynk WebHID interface, then read and export the live PG1KB trackball settings.

- Read-only commands: 0x0901, 0x0905, 0x0906, 0x0907
- Captures both device-level configs, all 16 layer/device profiles, active state, save status, and raw response bytes.
- Does not send setting-write, save, or load-default commands.
- Requires firmware exposing the Rynk HID collection (usage page 0xFF14, usage 0x61) and the PG1KB private trackball commands.
- This experimental UI has not yet been built and tested against the live keyboard. Do not flash or power-cycle the current RMK firmware until the exported JSON is verified.
