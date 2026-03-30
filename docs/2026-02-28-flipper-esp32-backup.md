# Flipper Zero ESP32-S2 Wi-Fi Dev Board Backup

**Date:** 2026-02-28
**Firmware:** Blackmagic Debug Probe (pre-flash backup)
**IP:** 192.168.4.33
**Purpose:** Backup before flashing ESP32-Serial-Bridge firmware

## System Info (`/api/v1/system/info`)

```json
{
  "idf_version": "v4.4-dev-3703-gddc44956bf",
  "model": "ESP32-S2",
  "revision": 0,
  "cores": 1,
  "heap": {
    "total_free_bytes": 135012,
    "total_allocated_bytes": 87256,
    "largest_free_block": 65536,
    "minimum_free_bytes": 112644
  },
  "ip": 553953472,
  "mac": [96, 85, 249, 236, 113, 54]
}
```

**MAC Address:** `60:55:F9:EC:71:36`

## Wi-Fi Networks Scanned (`/api/v1/wifi/list`)

30 total networks visible (20 returned). Top 5 by signal:
1. catfamily (ch1, -57dBm, WPA2)
2. healygang (ch6, -58dBm, WPA2)
3. Orange Julius (ch7, -60dBm, WPA2)
4. F3mmePalace (ch9, -60dBm, WPA2)
5. TMOBILE-28C2 (ch6, -61dBm, WPA2/WPA3)

## Restore Instructions

To restore Blackmagic firmware later if needed:
1. Download from: https://github.com/flipperdevices/blackmagic-esp32-s2
2. Hold BOOT, press RESET, release BOOT (enters USB bootloader)
3. Flash via `esptool.py` or the Flipper web updater
