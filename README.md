# Geoloc Memo

Geoloc Memo is a lightweight map memo app for saving notes and media at specific geographic points. Tap a point on the map to place a temporary blue pin, then save a memo to turn that selection into a solid saved pin.

The app is built as a plain web app and packaged for Android with Capacitor.

Live app: [https://ghmoon90.github.io/geolocmemo/](https://ghmoon90.github.io/geolocmemo/)

![QR code for Geoloc Memo](assets/geolocmemo-qr.svg)

## Features

- Tap the map to choose the exact memo location.
- Blue temporary pin shows the currently selected point.
- Saved memos become solid map pins.
- Add title, memo text, latitude, longitude, and optional altitude.
- Attach gallery or camera media.
- Read GPS metadata from supported media when available.
- Use current device location when permitted.
- Export and import memo metadata as JSON.
- Store media files locally in the browser/device storage.

## User Manual

### Selecting a Point

1. Open the app.
2. Pan and zoom the map to the area you want.
3. Tap the exact point where the memo should be placed.
4. A temporary blue pin appears at the tapped point.

### Adding a Memo

1. Tap a point on the map.
2. Tap **Memo**.
3. Enter a title, memo text, or both.
4. Confirm or adjust latitude, longitude, and altitude if needed.
5. Tap **Save memo**.
6. The temporary blue pin is replaced by a solid saved pin.

### Editing a Memo

1. Tap an existing solid pin.
2. Update the title, memo text, coordinates, altitude, or media.
3. Tap **Save memo**.

### Deleting a Memo

1. Tap an existing solid pin.
2. Tap **Delete**.
3. The memo and its locally stored media reference are removed from this device.

### Adding Media

- Tap **Gallery** to import image or video files.
- Tap **Camera** to capture a new image on supported devices.
- If the media includes GPS metadata, the app pins it at that location.
- If GPS metadata is missing, the app uses the selected map point. For camera capture, it may try the current device position as a fallback.

### Current Location

Tap the location button in the top bar to request the device's current position. If permission is granted, the map centers on that position and shows it with a current-location marker.

### Exporting Data

Use **Export JSON** to download memo metadata as a JSON file. This includes memo text, coordinates, addresses, timestamps, and media references.

Media files themselves remain in this browser or device storage and are not embedded in the exported JSON.

The exported file is downloaded by the browser with a name like `map-memos-2026-05-24.json`. In a PWA install, the exact file location is controlled by the browser or operating system, usually the user's Downloads folder or a browser download prompt.

### Importing Data

Use **Import JSON** to restore memo metadata from a previously exported file. Imported memos are saved to local storage on the current device.

## PWA Storage Location

Geoloc Memo does not keep its active memo data as a visible `.json` file inside the project or phone storage. While using the PWA, memo metadata is stored in browser storage for the app origin:

```text
https://ghmoon90.github.io/geolocmemo/
```

The metadata storage key is:

```text
localStorage: map-memos:v2
```

Media blobs are stored separately in IndexedDB:

```text
Database: map-memos-media
Object store: media
```

To get a portable JSON file, use **Export JSON** inside the app. To restore it later, use **Import JSON** and select that exported file.

## Data and Privacy

- Memo metadata is stored locally in browser storage.
- Media files are stored locally with IndexedDB.
- Map tiles are loaded from OpenStreetMap.
- Reverse address lookup uses OpenStreetMap Nominatim when the network is available.
- Location access only runs after the user chooses a feature that needs it.

## Development

Install dependencies:

```sh
npm install
```

Run a simple local web server from the project root:

```sh
python -m http.server 4174 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4174/index.html
```

## Android Build

Copy the web files into the Capacitor `www` directory:

```sh
npm run prepare:web
```

Sync Capacitor:

```sh
npm run cap:sync
```

Build a debug APK:

```sh
npm run apk:debug
```

Open the Android project:

```sh
npm run android
```

## Project Structure

- `index.html` - app markup
- `styles.css` - app styling
- `app.js` - map, memo, media, storage, and interaction logic
- `manifest.webmanifest` - PWA manifest
- `sw.js` - service worker
- `scripts/copy-web-assets.mjs` - copies web assets into `www`
- `www/` - Capacitor web output
- `android/` - Capacitor Android project

## Notes for Publishing

Before publishing or building Android, run:

```sh
npm run prepare:web
```

This keeps the Capacitor `www` folder in sync with the source web files.
