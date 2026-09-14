# RMK Trackball Runtime UI

Use the existing Trackball / Custom Settings UI as the front-end for RMK trackball tuning.

## Per-side controls

- Mode: Cursor / Scroll
- Sensor Rotation: 0° / 90° / 180° / 270°
- CPI
- Cursor Speed
- Scroll Speed
- Scroll Inertia: On / Off
- Inertia Strength / Decay

Sensor rotation must be applied before cursor or scroll mapping so a physically 90°-rotated PAW3222 can be corrected without recompiling firmware.

Suggested transform convention:

```text
0°:   ( x,  y)
90°:  ( y, -x)
180°: (-x, -y)
270°: (-y,  x)
```

Changes should apply immediately while the user moves the trackball. A separate Save action should persist to firmware storage.
