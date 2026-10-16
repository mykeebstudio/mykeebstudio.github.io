# PG1KB RMK Runtime Backup (experimental)

## Purpose

Capture the settings currently held by the running PG1KB RMK firmware before changing firmware. The UI uses the RMK Rynk HID interface and is intentionally separate from the existing ZMK Studio Web Serial connection.

## Usage

1. Start the local My Keeb Studio development server in Chrome or Edge on localhost (or HTTPS).
2. Select **RMK Runtime Backup** in the sidebar.
3. Choose **Connect RMK via WebHID** and select the PG1KB Rynk device.
4. Select **Read all settings**. The operation must finish with 2/2 device configs and 16/16 layer profiles.
5. Select **Export JSON backup** and keep a second copy outside the repository.
6. Inspect the JSON and keep the keyboard powered on until the backup has been verified.

## Read-only protocol

The tool sends only:

| Command | Purpose | Request payload | Response data |
|---|---|---|---|
| 0x0901 | Read device config | one byte device ID (0 right, 1 left) | 16 bytes |
| 0x0905 | Read save status | empty | 5 bytes |
| 0x0906 | Read active state | empty | 9 bytes |
| 0x0907 | Read layer profile | layer, device ID | 6 bytes |

Rynk framing uses a three-byte command/sequence header, postcard payloads, COBS framing, and a zero delimiter. The backup stores decoded values and raw response bytes. It does not call 0x0902, 0x0903, 0x0904, or 0x0908.

## Limitations

- This is an experimental first pass; the TypeScript build and live-device protocol have not yet been verified in this environment.
- It requires the firmware to expose Rynk's WebHID vendor report (usage page 0xFF14, usage 0x61) and the PG1KB-specific commands above.
- It exports a backup only. Restore is intentionally not included until the live capture has been validated.
- Do not power-cycle or flash the current RMK firmware until the JSON has been exported and checked.
