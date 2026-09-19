# MyKeebStudio

MyKeebStudio is a browser-based keyboard configuration and diagnostic UI for ZMK Studio and RMK/Rynk firmware.

It is designed as a lightweight developer/diagnostic companion and is not intended to replace DYA Studio. The ZMK side uses standard ZMK Studio RPC together with optional DYA-compatible custom RPC subsystems when firmware exposes them.

## Live site

- Main / ZMK Studio: https://mykeebstudio.github.io/
- RMK Keymap: https://mykeebstudio.github.io/#rmk-keymap
- RMK Trackball: https://mykeebstudio.github.io/#rmk-trackball

Chrome or Edge is recommended because the project uses Web Serial and WebHID.

## v0.8

### ZMK Studio

- Connect to ZMK Studio over Web Serial
- Read the active physical layout and live keymap
- Edit bindings and layer parameters
- Runtime Combo inspector/editor
- Keymap backup / restore
- Key Tester
- Trackball runtime settings
- BLE Management when compatible firmware exposes `mykeeb__ble_management`
- Custom Settings support
- Lighting controls for compatible firmware
- Persistent debug console with RPC timing and payload logging
- Clean serial teardown so another Studio can connect immediately after disconnect
- Automatic continuation after Studio Unlock

### RMK / Rynk

MyKeebStudio v0.8 also includes dedicated RMK pages that use the official Rynk protocol over WebHID.

#### RMK Keymap

- Connect to an RMK keyboard through Rynk WebHID
- Read the live RMK keymap
- Edit key actions and layer actions
- Layer-Tap / Momentary Layer / Toggle Layer support
- Combo read, edit, save, and clear
- ZMK JSON to RMK keymap conversion helpers
- Japanese key action support

#### RMK Trackball

- Live PAW3222 cursor tuning
- Scroll tuning
- Scroll inertia settings
- Sensor rotation / orientation controls
- Runtime changes through RMK / Rynk

The RMK pages load the generated Rynk WebAssembly runtime from `/rynk-wasm/`.

## Development

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

On Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Production build:

```powershell
npm run build
```

### Build Rynk WASM

The Windows workflow keeps the main project on Windows and builds the Rust/WASM portion through WSL.

```powershell
npm run build:rynk-wasm
```

The WSL build cache is stored in the Linux filesystem under:

```text
~/.cache/mykeebstudio/
```

Only the generated Rynk WASM files are copied back to:

```text
public/rynk-wasm/
```

This avoids compiling the Rust project under `/mnt/c` and keeps repeat builds faster.

## Local GitHub Pages deployment

MyKeebStudio is deployed from a local production build rather than relying on the normal development branch as the Pages source.

From Windows PowerShell:

```powershell
git switch feature/rmk-trackball-v8
git pull --ff-only
npm run deploy:pages
```

The deployment script:

1. updates the source branch
2. builds Rynk WASM through WSL
3. installs Node dependencies
4. runs the TypeScript + Vite production build
5. verifies that the Rynk WASM runtime is present in `dist/rynk-wasm/`
6. publishes the generated `dist/` contents to the `gh-pages` branch

GitHub Pages should be configured once as:

```text
Settings
→ Pages
→ Deploy from a branch
→ gh-pages
→ /(root)
```

## Architecture

```text
ZMK firmware
  |
  | Web Serial
  | ZMK Studio RPC
  | optional DYA-compatible Custom RPC
  v
MyKeebStudio
  |- Keymap editor + Backup / Restore
  |- Key Tester
  |- Runtime Combo
  |- Trackball settings
  |- BLE Management
  |- Lighting / Custom Settings
  `- Debug Console

RMK firmware
  |
  | WebHID
  | Rynk protocol
  v
MyKeebStudio RMK
  |- Keymap editor
  |- Combo editor
  `- Trackball runtime settings
       |
       `- Rynk WASM
```

## Compatibility note

Legacy `my-zmk-studio-*` localStorage keys are intentionally retained so existing user settings are not reset by the MyKeebStudio branding change.
