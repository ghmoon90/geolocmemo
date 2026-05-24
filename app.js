const TILE_SIZE = 256;
const STORAGE_KEY = "map-memos:v2";
const LEGACY_STORAGE_KEY = "map-memos:v1";
const MEDIA_DB_NAME = "map-memos-media";
const MEDIA_STORE_NAME = "media";
const DEFAULT_VIEW = { lat: 37.5665, lng: 126.978, zoom: 13 };

const els = {
  map: document.querySelector("#map"),
  tileLayer: document.querySelector("#tileLayer"),
  markerLayer: document.querySelector("#markerLayer"),
  storageToggleBtn: document.querySelector("#storageToggleBtn"),
  locateBtn: document.querySelector("#locateBtn"),
  zoomInBtn: document.querySelector("#zoomInBtn"),
  zoomOutBtn: document.querySelector("#zoomOutBtn"),
  addHereBtn: document.querySelector("#addHereBtn"),
  addMediaBtn: document.querySelector("#addMediaBtn"),
  cameraBtn: document.querySelector("#cameraBtn"),
  sheet: document.querySelector("#memoSheet"),
  sheetMode: document.querySelector("#sheetMode"),
  coordinateLabel: document.querySelector("#coordinateLabel"),
  closeSheetBtn: document.querySelector("#closeSheetBtn"),
  mediaPreview: document.querySelector("#mediaPreview"),
  addressLabel: document.querySelector("#addressLabel"),
  llaLabel: document.querySelector("#llaLabel"),
  memoTitle: document.querySelector("#memoTitle"),
  memoText: document.querySelector("#memoText"),
  memoLat: document.querySelector("#memoLat"),
  memoLng: document.querySelector("#memoLng"),
  memoAlt: document.querySelector("#memoAlt"),
  saveMemoBtn: document.querySelector("#saveMemoBtn"),
  deleteMemoBtn: document.querySelector("#deleteMemoBtn"),
  storagePanel: document.querySelector("#storagePanel"),
  closeStorageBtn: document.querySelector("#closeStorageBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  selectAllExportBtn: document.querySelector("#selectAllExportBtn"),
  deselectAllExportBtn: document.querySelector("#deselectAllExportBtn"),
  exportCountLabel: document.querySelector("#exportCountLabel"),
  exportMemoList: document.querySelector("#exportMemoList"),
  jsonFileInput: document.querySelector("#jsonFileInput"),
  mediaFileInput: document.querySelector("#mediaFileInput"),
  cameraFileInput: document.querySelector("#cameraFileInput"),
  toast: document.querySelector("#toast")
};

const state = {
  center: { lat: DEFAULT_VIEW.lat, lng: DEFAULT_VIEW.lng },
  zoom: DEFAULT_VIEW.zoom,
  memos: [],
  exportSelection: new Set(),
  selectedId: null,
  pendingLocation: null,
  draftMedia: null,
  currentPosition: null,
  pointers: new Map(),
  drag: null,
  pinch: null,
  toastTimer: null,
  addressAbort: null
};

let mediaDbPromise = null;

function openMediaDb() {
  if (mediaDbPromise) return mediaDbPromise;

  mediaDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) db.createObjectStore(MEDIA_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return mediaDbPromise;
}

async function putMediaBlob(id, blob) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).put(blob, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getMediaBlob(id) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(MEDIA_STORE_NAME, "readonly").objectStore(MEDIA_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteMediaBlob(id) {
  if (!id) return;
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, "readwrite");
    transaction.objectStore(MEDIA_STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCoord(value) {
  return Number(Number(value).toFixed(6));
}

function normalizeLng(value) {
  return roundCoord(((Number(value) + 180) % 360 + 360) % 360 - 180);
}

function normalizeLat(value) {
  return roundCoord(clamp(Number(value), -85.05112878, 85.05112878));
}

function latLngToPoint(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function pointToLatLng(x, y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function getMapSize() {
  const rect = els.map.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function screenToLatLng(screenX, screenY) {
  const rect = els.map.getBoundingClientRect();
  const size = getMapSize();
  const centerPoint = latLngToPoint(state.center.lat, state.center.lng, state.zoom);
  return pointToLatLng(
    centerPoint.x + (screenX - rect.left - size.width / 2),
    centerPoint.y + (screenY - rect.top - size.height / 2),
    state.zoom
  );
}

function latLngToScreen(lat, lng) {
  const size = getMapSize();
  const centerPoint = latLngToPoint(state.center.lat, state.center.lng, state.zoom);
  const point = latLngToPoint(lat, lng, state.zoom);
  return {
    x: size.width / 2 + point.x - centerPoint.x,
    y: size.height / 2 + point.y - centerPoint.y
  };
}

function formatCoord(value, digits = 5) {
  return Number(value).toFixed(digits);
}

function formatLla(memo) {
  const hasAltitude = memo.alt !== null && memo.alt !== "" && Number.isFinite(Number(memo.alt));
  const altitude = hasAltitude ? `, alt ${Number(memo.alt).toFixed(1)} m` : "";
  return `${formatCoord(memo.lat, 6)}, ${formatCoord(memo.lng, 6)}${altitude}`;
}

function makeId(prefix = "memo") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExportPayload(memos = state.memos) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    memos: memos.map(serializeMemo)
  };
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getExportPayload(), updatedAt: new Date().toISOString() }));
  } catch {
    showToast("Memo metadata saved, but browser JSON storage is full.");
  }
}

function serializeMemo(memo) {
  return {
    ...memo,
    media: memo.media ? serializeMedia(memo.media) : null
  };
}

function serializeMedia(media) {
  const { dataUrl, objectUrl, blob, ...safeMedia } = media;
  return safeMedia;
}

function normalizeMedia(media) {
  if (!media) return null;
  return {
    id: media.id || makeId("asset"),
    name: String(media.name || "Media"),
    type: String(media.type || "application/octet-stream"),
    size: Number(media.size) || 0,
    metadataSource: String(media.metadataSource || "Unknown"),
    unavailable: Boolean(media.unavailable)
  };
}

function normalizeMemo(memo) {
  const now = new Date().toISOString();
  return {
    id: memo.id || makeId(),
    kind: memo.kind || (memo.media ? "media" : "text"),
    title: String(memo.title || ""),
    text: String(memo.text || ""),
    lat: normalizeLat(memo.lat),
    lng: normalizeLng(memo.lng),
    alt: memo.alt !== null && memo.alt !== "" && Number.isFinite(Number(memo.alt)) ? Number(Number(memo.alt).toFixed(1)) : null,
    address: String(memo.address || ""),
    media: normalizeMedia(memo.media),
    createdAt: memo.createdAt || now,
    updatedAt: memo.updatedAt || now
  };
}

function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const memos = Array.isArray(parsed) ? parsed : parsed.memos;
    state.memos = Array.isArray(memos) ? memos.map(normalizeMemo) : [];
    selectAllMemosForExport();
  } catch {
    showToast("Saved data could not be loaded.");
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  state.toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function renderTiles() {
  const size = getMapSize();
  const centerPoint = latLngToPoint(state.center.lat, state.center.lng, state.zoom);
  const topLeft = {
    x: centerPoint.x - size.width / 2,
    y: centerPoint.y - size.height / 2
  };
  const minTileX = Math.floor(topLeft.x / TILE_SIZE) - 1;
  const minTileY = Math.floor(topLeft.y / TILE_SIZE) - 1;
  const maxTileX = Math.floor((topLeft.x + size.width) / TILE_SIZE) + 1;
  const maxTileY = Math.floor((topLeft.y + size.height) / TILE_SIZE) + 1;
  const maxIndex = 2 ** state.zoom;
  const liveKeys = new Set();

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= maxIndex) continue;

      const wrappedX = ((x % maxIndex) + maxIndex) % maxIndex;
      const key = `${state.zoom}-${wrappedX}-${y}`;
      liveKeys.add(key);

      let tile = els.tileLayer.querySelector(`[data-key="${key}"]`);
      if (!tile) {
        tile = new Image(TILE_SIZE, TILE_SIZE);
        tile.className = "map-tile";
        tile.dataset.key = key;
        tile.alt = "";
        tile.decoding = "async";
        tile.onload = () => tile.classList.add("loaded");
        tile.onerror = () => tile.remove();
        tile.src = `https://tile.openstreetmap.org/${state.zoom}/${wrappedX}/${y}.png`;
        els.tileLayer.append(tile);
      }

      tile.style.left = `${x * TILE_SIZE - topLeft.x}px`;
      tile.style.top = `${y * TILE_SIZE - topLeft.y}px`;
    }
  }

  els.tileLayer.querySelectorAll(".map-tile").forEach((tile) => {
    if (!liveKeys.has(tile.dataset.key)) tile.remove();
  });
}

function renderMarkers() {
  els.markerLayer.replaceChildren();

  if (state.pendingLocation) {
    const position = latLngToScreen(state.pendingLocation.lat, state.pendingLocation.lng);
    const marker = document.createElement("div");
    marker.className = "marker pending";
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
    marker.title = "Selected location";
    els.markerLayer.append(marker);
  }

  state.memos.forEach((memo) => {
    const position = latLngToScreen(memo.lat, memo.lng);
    const marker = document.createElement("button");
    const mediaClass = memo.kind === "media" ? " media" : "";
    const selectedClass = memo.id === state.selectedId ? " selected" : "";
    marker.className = `marker${mediaClass}${selectedClass}`;
    marker.type = "button";
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
    marker.ariaLabel = memo.title ? `Open ${memo.kind} memo: ${memo.title}` : `Open ${memo.kind} memo`;
    marker.title = memo.title || memo.text.slice(0, 60) || "Memo";
    marker.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      openMemo(memo);
    });
    els.markerLayer.append(marker);
  });

  if (state.currentPosition) {
    const position = latLngToScreen(state.currentPosition.lat, state.currentPosition.lng);
    const current = document.createElement("div");
    current.className = "marker current";
    current.style.left = `${position.x}px`;
    current.style.top = `${position.y}px`;
    current.title = "Current position";
    els.markerLayer.append(current);
  }
}

function getMemoExportLabel(memo, index) {
  return memo.title || memo.text || `${memo.kind === "media" ? "Media" : "Memo"} ${index + 1}`;
}

function syncExportSelection() {
  const liveIds = new Set(state.memos.map((memo) => memo.id));
  state.exportSelection.forEach((id) => {
    if (!liveIds.has(id)) state.exportSelection.delete(id);
  });
}

function selectAllMemosForExport() {
  state.exportSelection = new Set(state.memos.map((memo) => memo.id));
}

function renderExportSelector() {
  syncExportSelection();
  const selectedCount = state.exportSelection.size;
  els.exportCountLabel.textContent = `${selectedCount} of ${state.memos.length} memo${state.memos.length === 1 ? "" : "s"} selected`;
  els.exportMemoList.replaceChildren();

  if (!state.memos.length) {
    const empty = document.createElement("p");
    empty.className = "empty-export-list";
    empty.textContent = "No saved memos yet.";
    els.exportMemoList.append(empty);
    return;
  }

  state.memos.forEach((memo, index) => {
    const label = document.createElement("label");
    label.className = "export-memo-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.exportSelection.has(memo.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.exportSelection.add(memo.id);
      } else {
        state.exportSelection.delete(memo.id);
      }
      renderExportSelector();
    });

    const detail = document.createElement("span");
    detail.className = "export-memo-detail";

    const title = document.createElement("strong");
    title.textContent = getMemoExportLabel(memo, index);

    const coords = document.createElement("small");
    coords.textContent = formatLla(memo);

    detail.append(title, coords);
    label.append(checkbox, detail);
    els.exportMemoList.append(label);
  });
}

function render() {
  renderTiles();
  renderMarkers();
  const activeLocation = state.pendingLocation || state.center;
  els.coordinateLabel.textContent = `${formatCoord(activeLocation.lat)}, ${formatCoord(activeLocation.lng)}`;
}

function setCenter(lat, lng) {
  state.center = {
    lat: normalizeLat(lat),
    lng: normalizeLng(lng)
  };
  render();
}

function setPendingLocation(latLng) {
  state.pendingLocation = {
    lat: normalizeLat(latLng.lat),
    lng: normalizeLng(latLng.lng),
    alt: latLng.alt !== null && latLng.alt !== "" && Number.isFinite(Number(latLng.alt)) ? Number(Number(latLng.alt).toFixed(1)) : null
  };
  state.selectedId = null;
  render();
}

function getMemoTargetLocation() {
  return state.pendingLocation || state.center;
}

function setZoom(nextZoom, anchorEvent) {
  const oldZoom = state.zoom;
  const zoom = clamp(nextZoom, 2, 19);
  if (zoom === oldZoom) return;

  const anchorBefore = anchorEvent ? screenToLatLng(anchorEvent.clientX, anchorEvent.clientY) : state.center;
  state.zoom = zoom;
  const anchorAfterPoint = latLngToPoint(anchorBefore.lat, anchorBefore.lng, state.zoom);
  const size = getMapSize();
  const anchorX = anchorEvent ? anchorEvent.clientX - els.map.getBoundingClientRect().left : size.width / 2;
  const anchorY = anchorEvent ? anchorEvent.clientY - els.map.getBoundingClientRect().top : size.height / 2;
  const centerPoint = {
    x: anchorAfterPoint.x - anchorX + size.width / 2,
    y: anchorAfterPoint.y - anchorY + size.height / 2
  };
  state.center = pointToLatLng(centerPoint.x, centerPoint.y, state.zoom);
  render();
}

function renderLocationDetails(memo) {
  els.addressLabel.textContent = memo.address || "Address not loaded yet";
  els.llaLabel.textContent = formatLla(memo);
}

async function getMediaSource(media) {
  if (!media) return "";
  if (media.objectUrl || media.dataUrl) return media.objectUrl || media.dataUrl;
  if (!media.id) return "";

  try {
    const blob = await getMediaBlob(media.id);
    if (!blob) return "";
    media.objectUrl = URL.createObjectURL(blob);
    return media.objectUrl;
  } catch {
    return "";
  }
}

async function renderMediaPreview(media) {
  els.mediaPreview.replaceChildren();
  els.mediaPreview.hidden = !media;
  if (!media) return;

  const figure = document.createElement("figure");
  figure.className = "media-frame";
  const isVideo = media.type && media.type.startsWith("video/");
  const source = await getMediaSource(media);

  if (source) {
    const element = document.createElement(isVideo ? "video" : "img");
    element.src = source;
    if (isVideo) {
      element.controls = true;
      element.playsInline = true;
    } else {
      element.alt = media.name || "Pinned media";
    }
    figure.append(element);
  } else {
    const missing = document.createElement("div");
    missing.className = "missing-media";
    missing.textContent = "Media file is not stored on this device.";
    figure.append(missing);
  }

  const caption = document.createElement("figcaption");
  caption.textContent = `${media.name || "Media"} - ${media.type || "file"}`;
  figure.append(caption);
  els.mediaPreview.append(figure);
}

function openSheet() {
  els.sheet.classList.add("open");
}

function openStoragePanel() {
  renderExportSelector();
  els.storagePanel.classList.add("open");
}

function closeStoragePanel() {
  els.storagePanel.classList.remove("open");
}

function closeSheet() {
  els.sheet.classList.remove("open");
  state.selectedId = null;
  state.draftMedia = null;
  renderMediaPreview(null);
  renderMarkers();
}

async function ensureAddress(memo) {
  if (memo.address) return;
  if (state.addressAbort) state.addressAbort.abort();
  state.addressAbort = new AbortController();

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", memo.lat);
    url.searchParams.set("lon", memo.lng);
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const response = await fetch(url, { signal: state.addressAbort.signal });
    if (!response.ok) throw new Error("Address lookup failed.");
    const data = await response.json();
    memo.address = data.display_name || "";
    memo.updatedAt = new Date().toISOString();
    if (memo.id) saveLocal();
    if (!memo.id || state.selectedId === memo.id) renderLocationDetails(memo);
  } catch (error) {
    if (error.name !== "AbortError") {
      els.addressLabel.textContent = "Address unavailable offline";
    }
  }
}

function openMemo(memo) {
  state.pendingLocation = null;
  state.selectedId = memo.id;
  state.draftMedia = memo.media || null;
  els.sheetMode.textContent = memo.kind === "media" ? "Media pin" : "Edit memo";
  els.memoTitle.value = memo.title || "";
  els.memoText.value = memo.text || "";
  els.memoLat.value = memo.lat.toFixed(6);
  els.memoLng.value = memo.lng.toFixed(6);
  els.memoAlt.value = memo.alt !== null && memo.alt !== "" && Number.isFinite(Number(memo.alt)) ? Number(memo.alt).toFixed(1) : "";
  els.deleteMemoBtn.hidden = false;
  renderMediaPreview(memo.media);
  renderLocationDetails(memo);
  setCenter(memo.lat, memo.lng);
  openSheet();
  ensureAddress(memo);
}

function openNewMemo(latLng = state.center, media = null) {
  const memo = {
    id: "",
    kind: media ? "media" : "text",
    title: media ? media.name || "Media pin" : "",
    text: media?.metadataSource ? `Location source: ${media.metadataSource}` : "",
    lat: normalizeLat(latLng.lat),
    lng: normalizeLng(latLng.lng),
    alt: latLng.alt !== null && latLng.alt !== "" && Number.isFinite(Number(latLng.alt)) ? Number(Number(latLng.alt).toFixed(1)) : null,
    address: "",
    media
  };
  state.selectedId = null;
  state.draftMedia = media;
  els.sheetMode.textContent = media ? "New media pin" : "New memo";
  els.memoTitle.value = memo.title;
  els.memoText.value = memo.text;
  els.memoLat.value = memo.lat.toFixed(6);
  els.memoLng.value = memo.lng.toFixed(6);
  els.memoAlt.value = memo.alt == null ? "" : memo.alt.toFixed(1);
  els.deleteMemoBtn.hidden = true;
  renderMediaPreview(media);
  renderLocationDetails(memo);
  openSheet();
  ensureAddress(memo);
}

function readMemoForm() {
  const lat = Number(els.memoLat.value);
  const lng = Number(els.memoLng.value);
  const alt = els.memoAlt.value.trim() === "" ? null : Number(els.memoAlt.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Latitude and longitude must be valid numbers.");
  }
  if (alt !== null && !Number.isFinite(alt)) {
    throw new Error("Altitude must be a valid number.");
  }

  return {
    kind: state.draftMedia ? "media" : "text",
    title: els.memoTitle.value.trim(),
    text: els.memoText.value.trim(),
    lat: normalizeLat(lat),
    lng: normalizeLng(lng),
    alt: alt === null ? null : Number(alt.toFixed(1)),
    media: state.draftMedia
  };
}

function saveMemo() {
  let form;
  try {
    form = readMemoForm();
  } catch (error) {
    showToast(error.message);
    return;
  }

  if (!form.title && !form.text && !form.media) {
    showToast("Add a title, memo text, or media first.");
    return;
  }

  const now = new Date().toISOString();
  const existing = state.memos.find((memo) => memo.id === state.selectedId);

  if (existing) {
    Object.assign(existing, form, {
      address: existing.lat === form.lat && existing.lng === form.lng ? existing.address : "",
      updatedAt: now
    });
    ensureAddress(existing);
  } else {
    const memo = normalizeMemo({
      id: makeId(form.kind),
      ...form,
      createdAt: now,
      updatedAt: now
    });
    state.memos.push(memo);
    state.exportSelection.add(memo.id);
    ensureAddress(memo);
  }

  saveLocal();
  state.pendingLocation = null;
  setCenter(form.lat, form.lng);
  renderExportSelector();
  closeSheet();
  showToast("Memo saved.");
}

async function deleteMemo() {
  if (!state.selectedId) return;
  const existing = state.memos.find((memo) => memo.id === state.selectedId);
  state.memos = state.memos.filter((memo) => memo.id !== state.selectedId);
  state.exportSelection.delete(state.selectedId);
  saveLocal();
  if (existing?.media?.id) await deleteMediaBlob(existing.media.id);
  closeSheet();
  render();
  renderExportSelector();
  showToast("Memo deleted.");
}

function exportJson() {
  const selectedMemos = state.memos.filter((memo) => state.exportSelection.has(memo.id));
  if (!selectedMemos.length) {
    showToast("Select at least one memo to export.");
    return;
  }

  const blob = new Blob([JSON.stringify(getExportPayload(selectedMemos), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `map-memos-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJsonText(text) {
  const parsed = JSON.parse(text);
  const memos = Array.isArray(parsed) ? parsed : parsed.memos;
  if (!Array.isArray(memos)) throw new Error("JSON must contain a memos array.");

  state.memos = memos
    .filter((memo) => Number.isFinite(Number(memo.lat)) && Number.isFinite(Number(memo.lng)))
    .map(normalizeMemo);
  selectAllMemosForExport();

  saveLocal();
  render();
  renderExportSelector();
  showToast(`Imported ${state.memos.length} memo${state.memos.length === 1 ? "" : "s"}.`);
}

function locate() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not available in this browser.");
    return;
  }

  showToast("Finding current position...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const next = {
        lat: normalizeLat(position.coords.latitude),
        lng: normalizeLng(position.coords.longitude)
      };
      state.currentPosition = next;
      state.zoom = Math.max(state.zoom, 16);
      setCenter(next.lat, next.lng);
      showToast("Current position found.");
    },
    () => showToast("Could not get current position."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = {
          lat: normalizeLat(position.coords.latitude),
          lng: normalizeLng(position.coords.longitude),
          alt: Number.isFinite(Number(position.coords.altitude)) ? Number(Number(position.coords.altitude).toFixed(1)) : null,
          source: "Current position at capture"
        };
        state.currentPosition = current;
        resolve(current);
      },
      () => reject(new Error("Could not get current position.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

function getStringFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    output += code >= 32 && code <= 126 ? String.fromCharCode(code) : " ";
  }
  return output;
}

function parseIso6709(buffer) {
  const text = getStringFromBuffer(buffer);
  const match = text.match(/([+-]\d{2,3}\.\d+)([+-]\d{3}\.\d+)([+-]\d+(?:\.\d+)?)?\//);
  if (!match) return null;
  return {
    lat: normalizeLat(match[1]),
    lng: normalizeLng(match[2]),
    alt: match[3] ? Number(Number(match[3]).toFixed(1)) : null,
    source: "ISO 6709 media metadata"
  };
}

function readAscii(view, offset, length) {
  if (offset < 0 || offset + length > view.byteLength) return "";
  let result = "";
  for (let i = 0; i < length; i += 1) result += String.fromCharCode(view.getUint8(offset + i));
  return result;
}

function readRational(view, offset, littleEndian) {
  if (offset < 0 || offset + 8 > view.byteLength) return null;
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  return denominator ? numerator / denominator : null;
}

function readSignedRational(view, offset, littleEndian) {
  if (offset < 0 || offset + 8 > view.byteLength) return null;
  const numerator = view.getInt32(offset, littleEndian);
  const denominator = view.getInt32(offset + 4, littleEndian);
  return denominator ? numerator / denominator : null;
}

function tiffTypeSize(type) {
  const sizes = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    9: 4,
    10: 8
  };
  return sizes[type] || 1;
}

function getTiffEntryValueOffset(view, entryOffset, tiffOffset, type, count, littleEndian) {
  const totalSize = tiffTypeSize(type) * count;
  if (totalSize <= 4) return entryOffset + 8;
  const relativeOffset = view.getUint32(entryOffset + 8, littleEndian);
  return tiffOffset + relativeOffset;
}

function convertDms(values, ref) {
  const decimal = values[0] + values[1] / 60 + values[2] / 3600;
  return ref === "S" || ref === "W" ? -decimal : decimal;
}

function parseJpegGps(buffer) {
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && readAscii(view, offset + 4, 6) === "Exif\0\0") {
      return parseExifGps(view, offset + 10);
    }
    offset += 2 + size;
  }
  return null;
}

function findBytes(bytes, pattern, start = 0) {
  for (let i = start; i <= bytes.length - pattern.length; i += 1) {
    let matched = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function hasHeifBrand(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || readAscii(view, 4, 4) !== "ftyp") return false;
  const brandText = readAscii(view, 8, Math.min(view.byteLength - 8, 64));
  return /heic|heix|hevc|hevx|mif1|msf1|heif/i.test(brandText);
}

function readUintBySize(view, offset, size) {
  if (size === 0) return 0;
  if (offset < 0 || offset + size > view.byteLength) return null;
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + view.getUint8(offset + i);
  return value;
}

function readBoxHeader(view, offset, end) {
  if (offset + 8 > end || offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = readAscii(view, offset + 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > end || offset + 16 > view.byteLength) return null;
    size = Number(view.getBigUint64(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end || offset + size > view.byteLength) return null;
  return {
    type,
    start: offset,
    end: offset + size,
    contentStart: offset + headerSize
  };
}

function findChildBoxes(view, start, end, wantedTypes = null) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = readBoxHeader(view, offset, end);
    if (!box) break;
    if (!wantedTypes || wantedTypes.includes(box.type)) boxes.push(box);
    offset = box.end;
  }
  return boxes;
}

function tryParseExifGps(view, offset) {
  try {
    return parseExifGps(view, offset);
  } catch {
    return null;
  }
}

function parseIinfExifItemIds(view, iinfBox) {
  let offset = iinfBox.contentStart + 4;
  if (offset + 2 > iinfBox.end) return [];
  const version = view.getUint8(iinfBox.contentStart);
  const entryCount = version === 0 ? view.getUint16(offset) : view.getUint32(offset);
  offset += version === 0 ? 2 : 4;

  const ids = [];
  for (let i = 0; i < entryCount && offset + 8 <= iinfBox.end; i += 1) {
    const infe = readBoxHeader(view, offset, iinfBox.end);
    if (!infe || infe.type !== "infe") break;
    const infeVersion = view.getUint8(infe.contentStart);
    let cursor = infe.contentStart + 4;

    if (infeVersion >= 2) {
      const itemId = infeVersion === 2 ? view.getUint16(cursor) : view.getUint32(cursor);
      cursor += infeVersion === 2 ? 2 : 4;
      cursor += 2;
      const itemType = readAscii(view, cursor, 4);
      if (itemType === "Exif") ids.push(itemId);
    }
    offset = infe.end;
  }
  return ids;
}

function parseIlocItems(view, ilocBox) {
  const version = view.getUint8(ilocBox.contentStart);
  let cursor = ilocBox.contentStart + 4;
  if (cursor + 2 > ilocBox.end) return new Map();

  const sizes1 = view.getUint8(cursor);
  const sizes2 = view.getUint8(cursor + 1);
  cursor += 2;
  const offsetSize = sizes1 >> 4;
  const lengthSize = sizes1 & 0x0f;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0;
  const itemCount = version < 2 ? view.getUint16(cursor) : view.getUint32(cursor);
  cursor += version < 2 ? 2 : 4;

  const items = new Map();
  for (let i = 0; i < itemCount && cursor < ilocBox.end; i += 1) {
    const itemId = version < 2 ? view.getUint16(cursor) : view.getUint32(cursor);
    cursor += version < 2 ? 2 : 4;

    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(cursor) & 0x000f;
      cursor += 2;
    }

    cursor += 2;
    const baseOffset = readUintBySize(view, cursor, baseOffsetSize);
    cursor += baseOffsetSize;
    if (baseOffset === null || cursor + 2 > ilocBox.end) break;

    const extentCount = view.getUint16(cursor);
    cursor += 2;
    const extents = [];
    for (let j = 0; j < extentCount && cursor < ilocBox.end; j += 1) {
      if (indexSize > 0) cursor += indexSize;
      const extentOffset = readUintBySize(view, cursor, offsetSize);
      cursor += offsetSize;
      const extentLength = readUintBySize(view, cursor, lengthSize);
      cursor += lengthSize;
      if (extentOffset === null || extentLength === null) break;
      extents.push({
        constructionMethod,
        offset: baseOffset + extentOffset,
        length: extentLength
      });
    }
    items.set(itemId, extents);
  }
  return items;
}

function parseHeicExifPayloadGps(view, start, length) {
  const end = Math.min(view.byteLength, start + length);
  if (start < 0 || start + 8 > end) return null;

  const exifHeader = readAscii(view, start, Math.min(6, end - start));
  if (exifHeader === "Exif\0\0") {
    const gps = tryParseExifGps(view, start + 6);
    if (gps) return gps;
  }

  const embeddedTiffOffset = view.getUint32(start);
  const candidates = [
    start + 4 + embeddedTiffOffset,
    start + embeddedTiffOffset,
    start + 4,
    start
  ];

  for (const candidate of candidates) {
    if (candidate < start || candidate + 8 > end) continue;
    const gps = tryParseExifGps(view, candidate);
    if (gps) return gps;
  }
  return null;
}

function parseHeicGps(buffer) {
  if (!hasHeifBrand(buffer)) return null;

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const topBoxes = findChildBoxes(view, 0, view.byteLength);
  const metaBox = topBoxes.find((box) => box.type === "meta");

  if (metaBox && metaBox.contentStart + 4 < metaBox.end) {
    const metaChildren = findChildBoxes(view, metaBox.contentStart + 4, metaBox.end, ["iinf", "iloc"]);
    const iinfBox = metaChildren.find((box) => box.type === "iinf");
    const ilocBox = metaChildren.find((box) => box.type === "iloc");

    if (iinfBox && ilocBox) {
      const exifItemIds = parseIinfExifItemIds(view, iinfBox);
      const itemExtents = parseIlocItems(view, ilocBox);

      for (const itemId of exifItemIds) {
        const extents = itemExtents.get(itemId) || [];
        for (const extent of extents) {
          if (extent.constructionMethod !== 0 || extent.length <= 0) continue;
          const gps = parseHeicExifPayloadGps(view, extent.offset, extent.length);
          if (gps) return { ...gps, source: "HEIC EXIF GPS" };
        }
      }
    }
  }

  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  let offset = findBytes(bytes, exifHeader);

  while (offset !== -1) {
    const gps = tryParseExifGps(view, offset + exifHeader.length);
    if (gps) return { ...gps, source: "HEIC EXIF GPS" };
    offset = findBytes(bytes, exifHeader, offset + 1);
  }

  for (let i = 0; i < bytes.length - 8; i += 1) {
    const isLittleTiff = bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a && bytes[i + 3] === 0x00;
    const isBigTiff = bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0x00 && bytes[i + 3] === 0x2a;
    if (!isLittleTiff && !isBigTiff) continue;

    const gps = tryParseExifGps(view, i);
    if (gps) return { ...gps, source: "HEIC EXIF GPS" };
  }

  return null;
}

function parseExifGps(view, tiffOffset) {
  if (tiffOffset < 0 || tiffOffset + 8 > view.byteLength) return null;
  const byteOrder = readAscii(view, tiffOffset, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return null;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return null;

  const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (ifd0Offset < 0 || ifd0Offset + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(ifd0Offset, littleEndian);
  let gpsIfdOffset = 0;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) return null;
    if (view.getUint16(entryOffset, littleEndian) === 0x8825) {
      gpsIfdOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
      break;
    }
  }
  if (!gpsIfdOffset) return null;
  if (gpsIfdOffset < 0 || gpsIfdOffset + 2 > view.byteLength) return null;

  const gpsCount = view.getUint16(gpsIfdOffset, littleEndian);
  const gps = {};
  for (let i = 0; i < gpsCount; i += 1) {
    const entryOffset = gpsIfdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) return null;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = getTiffEntryValueOffset(view, entryOffset, tiffOffset, type, count, littleEndian);
    if (valueOffset < 0 || valueOffset >= view.byteLength) continue;

    if (tag === 1 || tag === 3) {
      gps[tag] = readAscii(view, valueOffset, 1);
    } else if ((tag === 2 || tag === 4) && (type === 5 || type === 10)) {
      const read = type === 10 ? readSignedRational : readRational;
      gps[tag] = [0, 1, 2].map((part) => read(view, valueOffset + part * 8, littleEndian));
    } else if (tag === 5) {
      gps[tag] = view.getUint8(valueOffset);
    } else if (tag === 6 && (type === 5 || type === 10)) {
      gps[tag] = type === 10 ? readSignedRational(view, valueOffset, littleEndian) : readRational(view, valueOffset, littleEndian);
    }
  }

  if (!gps[1] || !gps[2] || !gps[3] || !gps[4]) return null;
  if (gps[2].some((value) => value === null) || gps[4].some((value) => value === null)) return null;
  const alt = Number.isFinite(gps[6]) ? Number(((gps[5] === 1 ? -1 : 1) * gps[6]).toFixed(1)) : null;
  return {
    lat: normalizeLat(convertDms(gps[2], gps[1])),
    lng: normalizeLng(convertDms(gps[4], gps[3])),
    alt,
    source: "EXIF GPS"
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function getMediaLocation(file) {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    const gps = parseJpegGps(buffer);
    if (gps) return gps;
  }

  if (file.type === "image/heic" || file.type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif") || hasHeifBrand(buffer)) {
    const gps = parseHeicGps(buffer);
    if (gps) return gps;
  }

  return parseIso6709(buffer);
}

async function importMediaFiles(files, options = {}) {
  if (!files.length) return;

  let pinned = 0;
  let missingGps = 0;
  let usedCurrentPosition = 0;
  for (const file of files) {
    let location = await getMediaLocation(file);
    if (!location && options.useCurrentPositionFallback) {
      showToast("No metadata GPS found. Using current position...");
      try {
        location = await getCurrentPosition();
        usedCurrentPosition += 1;
      } catch {
        location = null;
      }
    }

    const latLng = location || getMemoTargetLocation();
    const now = new Date().toISOString();
    const mediaId = makeId("asset");
    await putMediaBlob(mediaId, file);
    const media = {
      id: mediaId,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      metadataSource: location?.source || "No GPS metadata found"
    };
    const memo = normalizeMemo({
      id: makeId("media"),
      kind: "media",
      title: file.name,
      text: location ? `Location source: ${location.source}` : "No GPS metadata found; pinned at selected location.",
      lat: latLng.lat,
      lng: latLng.lng,
      alt: location?.alt ?? null,
      media,
      createdAt: now,
      updatedAt: now
    });
    state.memos.push(memo);
    state.exportSelection.add(memo.id);
    pinned += 1;
    if (!location) missingGps += 1;
    ensureAddress(memo);
  }

  saveLocal();
  state.pendingLocation = null;
  renderExportSelector();
  const last = state.memos[state.memos.length - 1];
  if (last) {
    state.zoom = Math.max(state.zoom, 15);
    openMemo(last);
  }
  if (missingGps) {
    showToast(`${pinned} media pinned. ${missingGps} used selected location.`);
  } else if (usedCurrentPosition) {
    showToast(`${pinned} camera media pinned using current position.`);
  } else {
    showToast(`${pinned} media pinned from metadata.`);
  }
}

function getGesturePoints() {
  return [...state.pointers.values()];
}

function getGestureCenter(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function getGestureDistance(points) {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function startDrag(point) {
  state.drag = {
    pointerId: point.id,
    startX: point.x,
    startY: point.y,
    centerPoint: latLngToPoint(state.center.lat, state.center.lng, state.zoom),
    moved: false
  };
  state.pinch = null;
}

function startPinch() {
  const points = getGesturePoints();
  if (points.length < 2) return;
  const center = getGestureCenter(points);
  state.pinch = {
    distance: getGestureDistance(points),
    zoom: state.zoom,
    anchorLatLng: screenToLatLng(center.x, center.y)
  };
  state.drag = null;
}

function onPointerDown(event) {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  els.map.setPointerCapture(event.pointerId);
  state.pointers.set(event.pointerId, {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  });

  const points = getGesturePoints();
  if (points.length === 1) {
    startDrag(points[0]);
  } else if (points.length === 2) {
    startPinch();
  }
}

function onPointerMove(event) {
  const point = state.pointers.get(event.pointerId);
  if (!point) return;
  point.x = event.clientX;
  point.y = event.clientY;

  const points = getGesturePoints();
  if (state.pinch && points.length >= 2) {
    const distance = getGestureDistance(points);
    if (distance <= 0 || state.pinch.distance <= 0) return;

    const nextZoom = Math.round(clamp(state.pinch.zoom + Math.log2(distance / state.pinch.distance), 2, 19));
    const center = getGestureCenter(points);
    const rect = els.map.getBoundingClientRect();
    const size = getMapSize();
    const anchorPoint = latLngToPoint(state.pinch.anchorLatLng.lat, state.pinch.anchorLatLng.lng, nextZoom);
    const nextCenterPoint = {
      x: anchorPoint.x - (center.x - rect.left) + size.width / 2,
      y: anchorPoint.y - (center.y - rect.top) + size.height / 2
    };
    state.zoom = nextZoom;
    state.center = pointToLatLng(nextCenterPoint.x, nextCenterPoint.y, nextZoom);
    render();
    return;
  }

  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - state.drag.startX;
  const dy = event.clientY - state.drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 4) state.drag.moved = true;
  const next = pointToLatLng(state.drag.centerPoint.x - dx, state.drag.centerPoint.y - dy, state.zoom);
  setCenter(next.lat, next.lng);
}

function onPointerUp(event) {
  const wasDrag = state.drag && state.drag.pointerId === event.pointerId;
  const wasMoved = Boolean(state.drag?.moved || state.pinch);
  state.pointers.delete(event.pointerId);

  if (state.pointers.size >= 2) {
    startPinch();
  } else if (state.pointers.size === 1) {
    startDrag(getGesturePoints()[0]);
  } else {
    state.drag = null;
    state.pinch = null;
  }

  const tappedMapSurface = els.map.contains(event.target) && !event.target.closest(".marker");
  if (wasDrag && !wasMoved && tappedMapSurface) {
    setPendingLocation(screenToLatLng(event.clientX, event.clientY));
    showToast("Location selected. Tap Memo to add a memo here.");
  }
}

function bindEvents() {
  els.locateBtn.addEventListener("click", locate);
  els.storageToggleBtn.addEventListener("click", openStoragePanel);
  els.closeStorageBtn.addEventListener("click", closeStoragePanel);
  els.zoomInBtn.addEventListener("click", () => setZoom(state.zoom + 1));
  els.zoomOutBtn.addEventListener("click", () => setZoom(state.zoom - 1));
  els.addHereBtn.addEventListener("click", () => openNewMemo(getMemoTargetLocation()));
  els.addMediaBtn.addEventListener("click", () => els.mediaFileInput.click());
  els.cameraBtn.addEventListener("click", () => els.cameraFileInput.click());
  els.closeSheetBtn.addEventListener("click", closeSheet);
  els.saveMemoBtn.addEventListener("click", saveMemo);
  els.deleteMemoBtn.addEventListener("click", deleteMemo);
  els.exportBtn.addEventListener("click", exportJson);
  els.importBtn.addEventListener("click", () => els.jsonFileInput.click());
  els.selectAllExportBtn.addEventListener("click", () => {
    selectAllMemosForExport();
    renderExportSelector();
  });
  els.deselectAllExportBtn.addEventListener("click", () => {
    state.exportSelection.clear();
    renderExportSelector();
  });
  els.jsonFileInput.addEventListener("change", async () => {
    const file = els.jsonFileInput.files[0];
    if (!file) return;

    try {
      importJsonText(await file.text());
    } catch (error) {
      showToast(error.message);
    } finally {
      els.jsonFileInput.value = "";
    }
  });
  els.mediaFileInput.addEventListener("change", async () => {
    try {
      await importMediaFiles([...els.mediaFileInput.files]);
    } catch (error) {
      showToast(error.message || "Media could not be imported.");
    } finally {
      els.mediaFileInput.value = "";
    }
  });
  els.cameraFileInput.addEventListener("change", async () => {
    try {
      await importMediaFiles([...els.cameraFileInput.files], { useCurrentPositionFallback: true });
    } catch (error) {
      showToast(error.message || "Camera media could not be imported.");
    } finally {
      els.cameraFileInput.value = "";
    }
  });
  els.map.addEventListener("pointerdown", onPointerDown);
  els.map.addEventListener("pointermove", onPointerMove);
  els.map.addEventListener("pointerup", onPointerUp);
  els.map.addEventListener("pointercancel", (event) => {
    state.pointers.delete(event.pointerId);
    if (state.pointers.size === 0) {
      state.drag = null;
      state.pinch = null;
    } else if (state.pointers.size === 1) {
      startDrag(getGesturePoints()[0]);
    } else {
      startPinch();
    }
  });
  els.map.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(state.zoom + (event.deltaY < 0 ? 1 : -1), event);
  }, { passive: false });
  window.addEventListener("resize", render);
}

loadLocal();
bindEvents();
renderExportSelector();
render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
