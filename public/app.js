/**
 * STRAT-TRAFFIC v3.0 LIVE // 100% Real-Time Full-City Discovery, Google Maps Traffic & Multi-Script OSINT
 */

let map;
let activeBaseTileLayer = null;
let openSeaMapLayer = null;
let perimeterLayerGroup;
let poiLayerGroup;
let housingLayerGroup;
let corridorLayerGroup;
let maritimeLayerGroup;
let aviationLayerGroup;

let baselineChartInstance = null;
let waveChartInstance = null;

let countriesCatalog = {};
let currentData = null;
let selectedPoiId = null;
let selectedCorridorId = null;
let selectedCategoryFilter = "all";
let isMapPickMode = false;
let customCoord = null;

let liveStreamEnabled = true;
let liveStreamInterval = null;

const routeGeometryCache = new Map();
const flightMarkersById = new Map();

const MAP_TILE_STYLES = {
  google_traffic: {
    url: "https://mt1.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}&hl=tr",
    attribution: "&copy; Google Maps &amp; Google Live Traffic"
  },
  google_hybrid: {
    url: "https://mt1.google.com/vt/lyrs=y,traffic&x={x}&y={y}&z={z}&hl=tr",
    attribution: "&copy; Google Satellite &amp; Live Traffic"
  },
  google_standard: {
    url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=tr",
    attribution: "&copy; Google Maps"
  },
  dark_osint: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OSM &amp; CARTO"
  }
};

const CATEGORY_ICONS = {
  military: "🛡️",
  aviation: "✈️",
  maritime: "⚓",
  telecom: "📡",
  government: "🏛️",
  municipality: "🏢",
  hospital: "🏥"
};

const CATEGORY_LABELS = {
  military: "Askeri Üs / Hava Üssü / Füze & Nükleer Tesis",
  aviation: "Uluslararası Havalimanı & VIP Devlet Protokol Terminali",
  maritime: "Stratejik Liman, Deniz Üssü & Tanker Terminali",
  telecom: "Telekomünikasyon, Uydu, Denizaltı Fiber & Siber Altyapı",
  government: "Başkanlık / Liderlik / Başbakanlık / Bakanlık",
  municipality: "Belediye Başkanlığı / Eyalet Valiliği",
  hospital: "Stratejik / Askeri Hastane & Travma Kampüsü"
};

const RES_TYPE_META = {
  lojman: { icon: "🎖️", badgeLabel: "AÇIK KAYNAK LOJMAN", color: "#7c3aed", cssClass: "mark-lojman" },
  vip_stay: { icon: "🏨", badgeLabel: "VIP KONUT & KONAKLAMA", color: "#d97706", cssClass: "mark-vip" },
  residential: { icon: "🏘️", badgeLabel: "MAHALLE / KONUT", color: "#059669", cssClass: "mark-residential" }
};

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  startLiveClock();
  await initCountryCitySelectors();
  bindEvents();
  await loadAnalysis({ flyTo: true });
  startLiveStreamTimer();
});

function startLiveClock() {
  const el = document.getElementById("liveClockText");
  const tick = () => {
    const now = new Date();
    if (el) {
      el.textContent = now.toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }
  };
  tick();
  setInterval(tick, 1000);
}

async function initCountryCitySelectors() {
  const countrySelect = document.getElementById("countrySelect");
  const citySelect = document.getElementById("citySelect");

  try {
    const resp = await fetch("/api/countries");
    countriesCatalog = await resp.json();
  } catch (_) {
    countriesCatalog = {
      IL: { name: "İsrail (ישראל)", cities: [{ id: "tel_aviv", name: "Tel Aviv (תל אביב-יפו)" }] }
    };
  }

  countrySelect.innerHTML = Object.entries(countriesCatalog)
    .map(([code, obj]) => `<option value="${code}">${obj.name}</option>`)
    .join("");

  populateCitiesForCountry(countrySelect.value);

  countrySelect.addEventListener("change", () => {
    customCoord = null;
    populateCitiesForCountry(countrySelect.value);
    loadAnalysis({ flyTo: true });
  });

  citySelect.addEventListener("change", () => {
    customCoord = null;
    loadAnalysis({ flyTo: true });
  });
}

function populateCitiesForCountry(countryCode) {
  const citySelect = document.getElementById("citySelect");
  const countryObj = countriesCatalog[countryCode];
  if (!countryObj) return;
  citySelect.innerHTML = countryObj.cities
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");
}

function initMap() {
  map = L.map("map", {
    center: [32.0755, 34.7895],
    zoom: 13,
    zoomControl: true
  });

  setMapStyle("google_traffic");

  perimeterLayerGroup = L.layerGroup().addTo(map);
  corridorLayerGroup = L.layerGroup().addTo(map);
  maritimeLayerGroup = L.layerGroup().addTo(map);
  aviationLayerGroup = L.layerGroup().addTo(map);
  housingLayerGroup = L.layerGroup().addTo(map);
  poiLayerGroup = L.layerGroup().addTo(map);

  openSeaMapLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenSeaMap",
    maxZoom: 18,
    opacity: 0.85
  }).addTo(map);

  map.on("click", (e) => {
    if (!isMapPickMode) return;
    const { lat, lng } = e.latlng;
    const inIsrael = lat >= 29.4 && lat <= 33.4 && lng >= 34.1 && lng <= 35.9;
    const inIran = lat >= 25.0 && lat <= 39.8 && lng >= 44.0 && lng <= 63.4;
    const inTurkey = lat >= 35.8 && lat <= 42.2 && lng >= 25.6 && lng <= 44.75;
    if (inTurkey || (!inIsrael && !inIran)) {
      alert("Sistem yalnızca İsrail (IL) ve İran (IR) verilerini aktif olarak çekecek şekilde sınırlandırılmıştır. Türkiye dahil diğer ülkelerden veri çekilmez.");
      return;
    }
    customCoord = { lat, lon: lng, customName: `Harita Seçimi (${lat.toFixed(3)}, ${lng.toFixed(3)})` };
    toggleMapPickMode(false);
    loadAnalysis({ lat, lon: lng, flyTo: true });
  });
}

function setMapStyle(styleKey) {
  const cfg = MAP_TILE_STYLES[styleKey] || MAP_TILE_STYLES.google_traffic;
  if (activeBaseTileLayer) {
    map.removeLayer(activeBaseTileLayer);
  }
  activeBaseTileLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: 20
  }).addTo(map);
}

async function fetchRealRoadCoordinates(lat1, lon1, lat2, lon2) {
  const key = `${lat1.toFixed(4)},${lon1.toFixed(4)}_${lat2.toFixed(4)},${lon2.toFixed(4)}`;
  if (routeGeometryCache.has(key)) {
    return routeGeometryCache.get(key);
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      const coords = data.routes?.[0]?.geometry?.coordinates;
      if (coords && coords.length > 1) {
        const latLngs = coords.map((c) => [c[1], c[0]]);
        routeGeometryCache.set(key, latLngs);
        return latLngs;
      }
    }
  } catch (_) {}

  const fallback = [
    [lat1, lon1],
    [lat2, lon2]
  ];
  routeGeometryCache.set(key, fallback);
  return fallback;
}

function startLiveStreamTimer() {
  if (liveStreamInterval) clearInterval(liveStreamInterval);
  liveStreamInterval = setInterval(() => {
    if (liveStreamEnabled && !isMapPickMode) {
      loadAnalysis({ flyTo: false });
    }
  }, 25000);
}

function bindEvents() {
  document.querySelectorAll("#mapStyleSwitcher .style-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#mapStyleSwitcher .style-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setMapStyle(btn.dataset.style);
    });
  });

  const btnLiveStream = document.getElementById("btnLiveStream");
  btnLiveStream.addEventListener("click", () => {
    liveStreamEnabled = !liveStreamEnabled;
    btnLiveStream.classList.toggle("active", liveStreamEnabled);
    btnLiveStream.textContent = liveStreamEnabled ? "📡 Oto-Tarama: AÇIK" : "⏸️ Oto-Tarama: DURAKLATILDI";
    if (liveStreamEnabled) loadAnalysis({ flyTo: false });
  });

  ["chkShowPerimeters", "chkShowLojman", "chkShowVipStay", "chkShowAviation", "chkShowMaritime", "chkShowCorridors"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => renderMapLayers(false));
    }
  });

  document.querySelectorAll("#categoryFilterTabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#categoryFilterTabs .tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedCategoryFilter = btn.dataset.cat;
      renderPoiList();
      renderMapLayers(false);
    });
  });

  const btnSearchCity = document.getElementById("btnSearchCity");
  const citySearchInput = document.getElementById("citySearchInput");

  const triggerCitySearch = async () => {
    const q = citySearchInput.value.trim();
    if (!q) return;
    btnSearchCity.textContent = "Taranıyor...";
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.found) {
        customCoord = { lat: d.lat, lon: d.lon, customName: d.name };
        await loadAnalysis({ lat: d.lat, lon: d.lon, customName: d.name, flyTo: true });
      } else {
        alert("Aranan bölge İsrail (IL) veya İran (IR) sınırları içinde bulunamadı. Türkiye dahil diğer ülkelerden veri çekimi kapalıdır.");
      }
    } finally {
      btnSearchCity.textContent = "Canlı Tara";
    }
  };

  btnSearchCity.addEventListener("click", triggerCitySearch);
  citySearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") triggerCitySearch();
  });

  document.getElementById("btnPickMap").addEventListener("click", () => {
    toggleMapPickMode(!isMapPickMode);
  });

  document.getElementById("btnCancelPick").addEventListener("click", () => {
    toggleMapPickMode(false);
  });

  document.getElementById("btnShowAllCorridors").addEventListener("click", () => {
    selectedPoiId = null;
    selectedCorridorId = null;
    renderPoiList();
    renderHousingList();
    renderMapLayers(false);
    if (currentData && currentData.pois.length > 0) {
      updateCharts(currentData.pois[0], currentData.corridors[0]);
    }
  });

  const apiModal = document.getElementById("apiModal");
  document.getElementById("btnApiModal").addEventListener("click", () => {
    apiModal.classList.remove("hidden");
  });
  document.getElementById("btnCloseModal").addEventListener("click", () => {
    apiModal.classList.add("hidden");
  });
  document.getElementById("btnSaveApiSettings").addEventListener("click", () => {
    apiModal.classList.add("hidden");
    loadAnalysis({ flyTo: false });
  });
}

function toggleMapPickMode(active) {
  isMapPickMode = active;
  const btn = document.getElementById("btnPickMap");
  const banner = document.getElementById("mapPickBanner");
  const mapEl = document.getElementById("map");
  if (active) {
    btn.classList.add("active");
    banner.classList.remove("hidden");
    mapEl.style.cursor = "crosshair";
  } else {
    btn.classList.remove("active");
    banner.classList.add("hidden");
    mapEl.style.cursor = "";
  }
}

async function loadAnalysis(options = { flyTo: true }) {
  const country = document.getElementById("countrySelect")?.value || "IL";
  const city = document.getElementById("citySelect")?.value || "tel_aviv";
  const tomtomKey = document.getElementById("tomtomKeyInput")?.value.trim() || "";

  const params = new URLSearchParams({
    country,
    city,
    tomtomKey
  });

  const targetCoord =
    options.lat !== undefined
      ? { lat: options.lat, lon: options.lon, customName: options.customName || "" }
      : customCoord;

  if (targetCoord) {
    params.set("lat", String(targetCoord.lat));
    params.set("lon", String(targetCoord.lon));
    if (targetCoord.customName) {
      params.set("customName", targetCoord.customName);
    }
  }

  const resp = await fetch(`/api/analyze?${params.toString()}`);
  const data = await resp.json();
  currentData = data;

  const sortedByZ = [...data.pois].sort(
    (a, b) => (b.roadClosureActive ? 1 : 0) - (a.roadClosureActive ? 1 : 0) || b.zScore - a.zScore
  );
  const topPoi = sortedByZ[0] || data.pois[0];
  if (!selectedPoiId || !data.pois.some((p) => p.id === selectedPoiId)) {
    selectedPoiId = topPoi ? topPoi.id : null;
  }

  const matchingCorridor =
    data.corridors.find((c) => c.poiId === selectedPoiId) || data.corridors[0] || null;
  selectedCorridorId = matchingCorridor ? matchingCorridor.id : null;

  updateKpiStrip(data);
  renderAlerts(data.alerts, data.pois);
  renderFlightAlerts(data.flightAlerts || data.flights || []);
  renderAgenda(data.agenda);
  renderPoiList();
  renderHousingList();
  await renderMapLayers(options.flyTo);

  const activePoi = data.pois.find((p) => p.id === selectedPoiId) || topPoi;
  updateCharts(activePoi, matchingCorridor);
}

function updateKpiStrip(data) {
  document.getElementById("kpiRegionName").textContent = `${data.regionName.split("—")[0].trim()} • ${data.liveClockStr || data.simHour}`;
  document.getElementById("kpiSourceMode").textContent = data.sourceMode;
  document.getElementById("kpiCriticalCount").textContent = `${data.summary.criticalCount} Canlı Anomali • ${data.summary.flightCount || 0} Askeri Uçuş`;
  document.getElementById("kpiMaxZScore").textContent = `Polis Yol Kapaması: ${data.summary.roadClosureCount || 0} Nokta | Maks Z: +${data.summary.maxZScore}σ`;

  const topAgenda =
    data.agenda && data.agenda.items && data.agenda.items.length > 0
      ? data.agenda.items[0].title
      : "Üst Düzey Görüşme ve Protokol Takibi";
  document.getElementById("kpiAgendaTop").textContent = topAgenda;
  document.getElementById("kpiAgendaStatus").textContent =
    data.agenda && data.agenda.scannedLanguages
      ? `🌐 Taranan Alfabeler: ${data.agenda.scannedLanguages}`
      : "🟢 Çok Dilli (עברית / العربية / RU / TR / EN) Canlı Akış";

  document.getElementById("kpiHousingCount").textContent = `${data.summary.detectedHousingCount} Lojman/Mahalle Marklandı`;
  document.getElementById("kpiCorridorCount").textContent = data.summary.activeCorridorsCount;
}

function renderAlerts(alerts, allPois = []) {
  const container = document.getElementById("alertsContainer");
  const badge = document.getElementById("alertBadgeCount");
  badge.textContent = alerts.length;

  const naturalRushPois = allPois.filter((p) => p.normalRushHourTraffic && p.severityLevel === 0);

  if (alerts.length === 0) {
    const rushExplanation =
      naturalRushPois.length > 0
        ? `<div style="margin-top:5px; color:#93c5fd;">ℹ️ <strong>Saatlik Baz Filtresi Devrede:</strong> ${naturalRushPois.length} noktada trafik hızı düşük olsa da, günün bu saatindeki doğal yoğunlukla (%${naturalRushPois[0].expectedCongestionPct}) uyumlu olduğu için <strong>sahte anomali üretilmedi</strong>.</div>`
        : "";

    container.innerHTML = `
      <div style="font-size:0.73rem; color:var(--text-muted); padding:8px; background:var(--bg-card); border-radius:6px; line-height:1.4;">
        ✅ Şu anki canlı saatte şehirdeki normal baz değerlerinin (baseline) üstüne çıkan bir anomali veya yol kapaması yok.
        ${rushExplanation}
      </div>
    `;
    return;
  }

  container.innerHTML = alerts
    .map(
      (a) => `
      <div class="alert-card ${a.status === "ELEVATED" ? "elevated" : ""}" data-poi-id="${a.poiId}">
        <div class="alert-top">
          <span class="alert-title" dir="auto">${a.roadClosureActive ? "🚧" : CATEGORY_ICONS[a.category] || "📍"} ${a.poiName}</span>
          <span class="alert-z">${a.roadClosureActive ? "CANLI YOL KAPALI" : `+${a.zScore}σ`}</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 6px 0; font-size:0.68rem;">
          <span style="background:rgba(255,59,92,0.2); color:#fecdd3; border:1px solid rgba(255,59,92,0.45); padding:2px 6px; border-radius:4px; font-weight:700;">
            🔔 Bildirim Düştü: ${a.alertTriggeredAt || a.simHour}
          </span>
          <span style="background:rgba(59,130,246,0.18); color:#bfdbfe; border:1px solid rgba(59,130,246,0.4); padding:2px 6px; border-radius:4px; font-weight:600;">
            ⏳ ${a.anomalyWindow || a.simHour} (${a.anomalyDurationText || "Canlı"})
          </span>
        </div>
        <div class="alert-desc">${a.summary}</div>
        ${
          a.potentialAgendaTitle
            ? `<div class="alert-agenda-tag" dir="auto">📅 <strong>Potansiyel Gündem:</strong> ${a.potentialAgendaTitle}</div>`
            : ""
        }
        ${
          a.linkedHousingProb > 0
            ? `<div class="alert-corridor-tag" dir="auto">${a.linkedHousingType === "vip_stay" ? "🏨 VIP Konaklama:" : "🎖️ Lojman/Mahalle:"} ${a.linkedHousingName} (%${a.linkedHousingProb} olasılık, -${a.linkedLagMin} dk)</div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".alert-card").forEach((card) => {
    card.addEventListener("click", () => {
      focusOnPoi(card.dataset.poiId);
    });
  });
}

function renderFlightAlerts(flightAlerts = []) {
  const container = document.getElementById("flightAlertsContainer");
  const badge = document.getElementById("flightAlertBadgeCount");
  if (!container || !badge) return;

  badge.textContent = flightAlerts.length;

  if (flightAlerts.length === 0) {
    container.innerHTML = `
      <div style="font-size:0.73rem; color:var(--text-muted); padding:8px; background:var(--bg-card); border-radius:6px; line-height:1.4;">
        ✈️ Şu anki hava sahası taramasında aktif askeri veya VIP devlet uçağı bildirimi yok.
      </div>
    `;
    return;
  }

  container.innerHTML = flightAlerts
    .map((fa) => {
      const isVip = fa.type === "vip_state";
      const borderColor = isVip ? "rgba(245, 158, 11, 0.55)" : "rgba(168, 85, 247, 0.55)";
      const badgeBg = isVip ? "rgba(245, 158, 11, 0.22)" : "rgba(168, 85, 247, 0.22)";
      const badgeColor = isVip ? "#fde68a" : "#e9d5ff";
      const icon = isVip ? "👑✈️" : "🦅";
      const typeTag = isVip ? "VIP DEVLET UÇUŞU" : "ASKERİ HAVA OPERASYONU";

      return `
        <div class="alert-card flight-alert-card" data-flight-id="${fa.flightId || fa.id}" style="border-left: 3px solid ${isVip ? "#f59e0b" : "#a855f7"}; border-color: ${borderColor}; cursor: pointer;">
          <div class="alert-top">
            <span class="alert-title" dir="auto">${icon} ${fa.flag || ""} ${fa.callsign} — ${fa.name}</span>
            <span class="alert-z" style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${borderColor};">${typeTag}</span>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin:5px 0 6px 0; font-size:0.68rem;">
            <span style="background:rgba(255,59,92,0.22); color:#fecdd3; border:1px solid rgba(255,59,92,0.45); padding:2px 6px; border-radius:4px; font-weight:700;">
              🔔 Bildirim Düştü: ${fa.alertTriggeredAt || "Canlı"}
            </span>
            <span style="background:rgba(168,85,247,0.22); color:#e9d5ff; border:1px solid rgba(168,85,247,0.48); padding:2px 6px; border-radius:4px; font-weight:700;">
              ⏳ Uçuş Saat Aralığı: ${fa.flightWindow || "Canlı"} (${fa.flightDurationText || "Havada"})
            </span>
          </div>
          <div class="alert-desc" style="font-size:0.72rem; color:#e2e8f0; margin-bottom:4px;">
            🛫 <strong>Kalkış Üssü:</strong> ${fa.departureBase || "Askeri Hava Üssü"} &nbsp;|&nbsp; 🧭 <strong>Rota:</strong> ${fa.route}
          </div>
          <div style="font-size:0.69rem; color:#93c5fd; margin-bottom:4px;">
            📡 <strong>ADS-B (${fa.icao24}):</strong> ${(fa.altitudeFt || 0).toLocaleString()} ft irtifa • ${fa.speedKnots} knot (${Math.round((fa.speedKnots || 0) * 1.852)} km/s) • <strong style="color:#fda4af;">${fa.status}</strong>
          </div>
          <div class="alert-corridor-tag" dir="auto" style="color:#cbd5e1;">
            🎯 <strong>İstihbarat Notu:</strong> ${fa.intelNote}
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".flight-alert-card").forEach((card) => {
    card.addEventListener("click", () => {
      focusOnFlight(card.dataset.flightId);
    });
  });
}

function renderAgenda(agenda) {
  const briefBox = document.getElementById("agendaBriefBox");
  const listContainer = document.getElementById("agendaListContainer");
  const feedBadge = document.getElementById("agendaFeedBadge");

  if (!agenda) return;

  feedBadge.textContent = agenda.liveFeedActive ? "🇹🇷 OTO-ÇEVİRİ + CANLI RSS" : "🇹🇷 OTO-ÇEVİRİ + OSINT";
  briefBox.innerHTML = `<strong>🧠 Çok Dilli İstihbarat Çıkarımı (TR):</strong> ${agenda.synthesizedBrief}`;

  listContainer.innerHTML = (agenda.items || [])
    .map(
      (item) => `
      <div class="agenda-item">
        <div class="agenda-item-top">
          <span class="agenda-tag">${item.tag}</span>
          <span class="agenda-prob">${item.langBadge || "OSINT"} • %${item.protocolClosureProb}</span>
        </div>
        <div class="agenda-title" dir="auto" style="font-weight:700; color:#f8fafc;">
          <a href="${item.link || "#"}" target="_blank" rel="noopener noreferrer">🇹🇷 ${item.titleTr || item.title}</a>
        </div>
        ${
          item.originalTitle && item.originalTitle !== (item.titleTr || item.title)
            ? `<div dir="auto" style="font-size:0.68rem; color:#94a3b8; margin-top:4px; background:rgba(15,23,42,0.55); border-left:2px solid #38bdf8; padding:3px 7px; border-radius:4px;">
                 🌐 <strong>Orijinal Metin:</strong> ${item.originalTitle}
               </div>`
            : ""
        }
        ${
          item.nativeSummary
            ? `<div style="font-size:0.68rem; color:#6ee7b7; margin-top:3px; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:4px;">🔤 ${item.nativeSummary}</div>`
            : ""
        }
        <div class="agenda-meta">
          📰 ${item.source} • 🕒 ${item.pubDate}
        </div>
      </div>
    `
    )
    .join("");
}

function renderPoiList() {
  if (!currentData) return;
  const container = document.getElementById("poiListContainer");

  const filtered = currentData.pois.filter(
    (p) => selectedCategoryFilter === "all" || p.category === selectedCategoryFilter
  );

  container.innerHTML = filtered
    .map(
      (p) => `
      <div class="poi-card ${p.id === selectedPoiId ? "selected" : ""}" data-poi-id="${p.id}">
        <div class="poi-header">
          <div class="poi-name" dir="auto">${CATEGORY_ICONS[p.category] || "📍"} ${p.name}</div>
          <span class="status-badge status-${p.status}">
            ${
              p.roadClosureActive
                ? "🚧 CANLI YOL KAPALI"
                : p.status === "CRITICAL_ANOMALY"
                ? "KRİTİK ANOMALİ"
                : p.status === "ELEVATED"
                ? "NORMALİN ÜSTÜ"
                : p.normalRushHourTraffic
                ? "DOĞAL MESAİ TRAFİĞİ"
                : "NORMAL SEYİR"
            }
          </span>
        </div>
        <div class="poi-metrics">
          <div>
            Canlı / Saatlik Baz
            <strong>%${p.currentCongestionPct} <span style="font-weight:normal; color:#8fa3c7;">(Baz: %${p.expectedCongestionPct})</span></strong>
          </div>
          <div>
            Anlık / Beklenen Hız
            <strong>${p.currentSpeedKmh} km/s <span style="font-weight:normal; color:#8fa3c7;">(${p.expectedSpeedKmh} km/s)</span></strong>
          </div>
          <div>
            Baz Sapması (Z)
            <strong>${p.zScore >= 0 ? "+" : ""}${p.zScore}&sigma; (${p.deltaCongestionPct >= 0 ? "+" : ""}${p.deltaCongestionPct}%)</strong>
          </div>
        </div>
        ${
          p.anomalyWindow
            ? `<div style="margin-top:6px; padding-top:5px; border-top:1px dashed rgba(255,255,255,0.1); font-size:0.68rem; color:#fde68a; display:flex; justify-content:space-between;">
                 <span>🔔 Bildirim: <strong>${p.alertTriggeredAt}</strong></span>
                 <span>⏳ <strong>${p.anomalyWindow}</strong></span>
               </div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".poi-card").forEach((card) => {
    card.addEventListener("click", () => {
      focusOnPoi(card.dataset.poiId);
    });
  });
}

function renderHousingList() {
  if (!currentData) return;
  const container = document.getElementById("housingListContainer");

  let corridorsToShow = currentData.corridors;
  if (selectedPoiId) {
    const filtered = currentData.corridors.filter((c) => c.poiId === selectedPoiId);
    if (filtered.length > 0) corridorsToShow = filtered;
  }

  container.innerHTML = corridorsToShow
    .map((c) => {
      const meta = RES_TYPE_META[c.resType] || RES_TYPE_META.residential;
      return `
      <div class="housing-card type-${c.resType} ${c.id === selectedCorridorId ? "selected" : ""}" data-corridor-id="${c.id}">
        <div class="housing-top">
          <span class="housing-name" dir="auto">${meta.icon} ${c.resName}</span>
          <span class="prob-badge">%${c.personnelProbabilityPct} Eşleşme</span>
        </div>
        <div style="font-size:0.71rem; color:#cbd5e1;" dir="auto">
          Bağlı Hedef: <strong>${c.poiName}</strong>
        </div>
        <div style="font-size:0.68rem; color:#93c5fd; margin-top:2px;" dir="auto">
          📌 ${c.resSecurityTag || meta.badgeLabel}
        </div>
        <div class="housing-meta">
          <span>⏱️ Çıkış Kayması: -${c.lagMinutes} dk</span>
          <span>📊 Dalga r=${c.timeLagCorrelation}</span>
          <span>🛣️ ${c.roadDistanceKm} km</span>
          <span>🏷️ ${meta.badgeLabel}</span>
        </div>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll(".housing-card").forEach((card) => {
    card.addEventListener("click", () => {
      const corrId = card.dataset.corridorId;
      const corr = currentData.corridors.find((c) => c.id === corrId);
      if (corr) {
        selectedCorridorId = corr.id;
        selectedPoiId = corr.poiId;
        renderPoiList();
        renderHousingList();
        renderMapLayers(false);
        const poi = currentData.pois.find((p) => p.id === corr.poiId);
        updateCharts(poi, corr);
        map.flyToBounds(
          [
            [corr.resLat, corr.resLon],
            [corr.poiLat, corr.poiLon]
          ],
          { padding: [75, 75], duration: 0.7 }
        );
      }
    });
  });
}

async function renderMapLayers(flyToCenter = false) {
  if (!currentData) return;

  perimeterLayerGroup.clearLayers();
  poiLayerGroup.clearLayers();
  housingLayerGroup.clearLayers();
  corridorLayerGroup.clearLayers();
  if (maritimeLayerGroup) maritimeLayerGroup.clearLayers();
  if (aviationLayerGroup) aviationLayerGroup.clearLayers();

  const showPerimeters = document.getElementById("chkShowPerimeters")?.checked ?? true;
  const showLojman = document.getElementById("chkShowLojman")?.checked ?? true;
  const showVipStay = document.getElementById("chkShowVipStay")?.checked ?? true;
  const showAviation = document.getElementById("chkShowAviation")?.checked ?? true;
  const showMaritime = document.getElementById("chkShowMaritime")?.checked ?? true;
  const showCorridors = document.getElementById("chkShowCorridors")?.checked ?? true;

  if (flyToCenter && currentData.center) {
    map.flyTo([currentData.center.lat, currentData.center.lon], currentData.zoom || 12, {
      duration: 0.8
    });
  }

  // 1. Şehirdeki Tüm Lojman, VIP Konaklama ve Mahalleleri Haritada Markla
  currentData.residentialZones.forEach((zone) => {
    if ((zone.type === "lojman" || zone.type === "residential") && !showLojman) return;
    if (zone.type === "vip_stay" && !showVipStay) return;

    const meta = RES_TYPE_META[zone.type] || RES_TYPE_META.residential;

    const circle = L.circle([zone.lat, zone.lon], {
      radius: zone.radiusM || 1000,
      color: meta.color,
      weight: 2.5,
      dashArray: zone.type === "vip_stay" ? "6, 4" : null,
      fillColor: meta.color,
      fillOpacity: zone.isActiveWave ? 0.24 : 0.13
    });

    circle.bindPopup(`
      <div style="font-family:sans-serif; min-width:240px;" dir="auto">
        <div style="font-size:11px; font-weight:bold; color:#6d28d9;">${meta.icon} ${meta.badgeLabel} BÖLGESİ MARKI</div>
        <div style="margin:4px 0; font-weight:bold; font-size:13px;">${zone.name}</div>
        <div style="font-size:11px; color:#475569; margin-bottom:5px;">${zone.securityTag || ""}</div>
        <div style="font-size:12px;">
          • Personel / Heyet Olasılığı: <strong>%${zone.maxProbabilityPct}</strong><br/>
          • Birincil Bağlı Kurum: <strong>${zone.primaryPoiName}</strong><br/>
          • Sürüş / Çıkış Kayması (&Delta;t): <strong>-${zone.lagMinutes} dakika</strong><br/>
          • Çıkış Yoğunluk Artışı: <strong>%${zone.originSurgePct}</strong>
        </div>
      </div>
    `);

    circle.addTo(housingLayerGroup);

    const shortZoneName = zone.name.split("(")[0].trim();
    const badgeIcon = L.divIcon({
      className: "zone-mark-wrapper",
      html: `
        <div class="zone-mark-badge ${meta.cssClass}" style="white-space:nowrap;">
          ${meta.icon} ${zone.type === "lojman" ? "LOJMAN" : "VIP"}: ${shortZoneName} • %${zone.maxProbabilityPct}
        </div>
      `,
      iconSize: [210, 26],
      iconAnchor: [105, 13]
    });

    const labelMarker = L.marker([zone.lat, zone.lon], { icon: badgeIcon });
    labelMarker.on("click", () => circle.openPopup());
    labelMarker.addTo(housingLayerGroup);
  });

  // 2. Şehirdeki Tüm Stratejik Noktaları (Askeri, Hükümet, Belediye, Hastane) ve Google Maps Canlı Olay Baloncuklarını Çiz
  const poisToDraw = currentData.pois.filter(
    (p) => selectedCategoryFilter === "all" || p.category === selectedCategoryFilter
  );

  poisToDraw.forEach((poi) => {
    if (poi.category === "maritime" && !showMaritime && selectedCategoryFilter !== "maritime") return;
    if (poi.category === "aviation" && !showAviation && selectedCategoryFilter !== "aviation") return;

    if (showPerimeters && (poi.category === "military" || poi.category === "aviation" || poi.category === "telecom" || poi.category === "maritime" || poi.category === "government" || poi.category === "municipality" || poi.category === "hospital")) {
      const perimColor = poi.roadClosureActive
        ? "#dc2626"
        : poi.category === "military"
        ? "#e11d48"
        : poi.category === "aviation"
        ? "#8b5cf6"
        : poi.category === "telecom"
        ? "#06b6d4"
        : poi.category === "maritime"
        ? "#0ea5e9"
        : poi.category === "government"
        ? "#d97706"
        : poi.category === "municipality"
        ? "#2563eb"
        : "#059669";

      const perimCircle = L.circle([poi.lat, poi.lon], {
        radius: poi.perimeterRadiusM || 500,
        color: perimColor,
        weight: 2.3,
        dashArray: "6, 6",
        fillColor: perimColor,
        fillOpacity: poi.roadClosureActive ? 0.22 : 0.1
      });

      perimCircle.addTo(perimeterLayerGroup);
    }

    let bgColor = "#0284c7";
    let calloutClass = "callout-normal";
    let calloutTitle = `✅ ${poi.currentSpeedKmh} km/s (Normal)`;

    if (poi.roadClosureActive) {
      bgColor = "#dc2626";
      calloutClass = "callout-critical";
      calloutTitle = `⛔ YOL KAPALI / VIP • ${poi.currentSpeedKmh} km/s`;
    } else if (poi.status === "CRITICAL_ANOMALY") {
      bgColor = "#e11d48";
      calloutClass = "callout-critical";
      calloutTitle = `🚨 ANOMALİ %${poi.currentCongestionPct} (+${poi.zScore}σ)`;
    } else if (poi.status === "ELEVATED") {
      bgColor = "#d97706";
      calloutClass = "callout-elevated";
      calloutTitle = `⚠️ YÜKSEK YOĞUNLUK %${poi.currentCongestionPct}`;
    } else if (poi.normalRushHourTraffic) {
      bgColor = "#0284c7";
      calloutClass = "callout-normal";
      calloutTitle = `🚗 DOĞAL TRAFİK • ${poi.currentSpeedKmh} km/s (Baz: %${poi.expectedCongestionPct})`;
    }

    const pulseHtml =
      poi.status !== "NORMAL"
        ? `<div class="poi-marker-pulse" style="background:${bgColor};"></div>`
        : "";

    const shortName = poi.name.split("(")[0].trim();
    const timeSubHtml = poi.anomalyWindow
      ? `<div style="font-size:9px; color:#b91c1c; font-weight:700;">🔔 ${poi.alertTriggeredAt} | ⏳ ${poi.anomalyWindow}</div>`
      : "";

    const icon = L.divIcon({
      className: "custom-poi-icon",
      html: `
        <div class="poi-marker-wrap">
          <div class="gmaps-callout ${calloutClass}" style="position:absolute; bottom:34px;">
            <div class="gmaps-callout-top">${calloutTitle}</div>
            ${timeSubHtml}
            <div class="gmaps-callout-sub">${shortName}</div>
          </div>
          ${pulseHtml}
          <div class="poi-marker-core" style="background:${bgColor};">
            ${CATEGORY_ICONS[poi.category] || "📍"}
          </div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });

    const marker = L.marker([poi.lat, poi.lon], { icon });

    marker.bindPopup(`
      <div style="font-family:sans-serif; min-width:265px;" dir="auto">
        <div style="font-size:11px; text-transform:uppercase; color:#64748b;">${CATEGORY_LABELS[poi.category]}</div>
        <strong style="font-size:14px;">${poi.name}</strong>
        <div style="margin:6px 0; padding:6px 8px; border-radius:6px; background:#f1f5f9; font-size:12px;">
          Durum: <strong style="color:${poi.roadClosureActive ? "#dc2626" : "#0f172a"};">${poi.statusLabel}</strong><br/>
          ${
            poi.anomalyWindow
              ? `🔔 Bildirimin Düştüğü Saat: <strong style="color:#dc2626;">${poi.alertTriggeredAt}</strong><br/>
                 ⏳ Canlı Devam Aralığı: <strong style="color:#1d4ed8;">${poi.anomalyWindow} (${poi.anomalyDurationText})</strong><br/>`
              : ""
          }
          Canlı Saat (${poi.simHour}) Normal Baz: <strong>%${poi.expectedCongestionPct} (${poi.expectedSpeedKmh} km/s)</strong><br/>
          Şu Anki Canlı Yoğunluk: <strong style="color:${poi.severityLevel > 0 ? "#dc2626" : "#0f766e"};">%${poi.currentCongestionPct} (${poi.currentSpeedKmh} km/s)</strong><br/>
          Bazdan Sapma: <strong>${poi.deltaCongestionPct >= 0 ? "+" : ""}${poi.deltaCongestionPct}% (Z: ${poi.zScore >= 0 ? "+" : ""}${poi.zScore}&sigma;)</strong>
        </div>
        <div style="font-size:11px; color:#475569;">Protokol Caddesi: <strong>${poi.arterialName || "Ana Bulvar"}</strong></div>
      </div>
    `);

    marker.on("click", () => {
      focusOnPoi(poi.id);
    });

    marker.addTo(poiLayerGroup);
  });

  // 2.5. Canlı Gemi, Tanker & Donanma (AIS) Deniz Trafiği Katmanı
  if (showMaritime && Array.isArray(currentData.vessels) && maritimeLayerGroup) {
    currentData.vessels.forEach((v) => {
      const isNaval = v.type === "naval";
      const isTanker = v.type === "tanker";
      const shipColor = isNaval ? "#e11d48" : isTanker ? "#f59e0b" : "#0ea5e9";
      const shipEmoji = isNaval ? "⚓" : isTanker ? "🛢️" : "🚢";

      if (Array.isArray(v.trackCoords) && v.trackCoords.length >= 2) {
        const seaTrack = L.polyline(v.trackCoords, {
          color: shipColor,
          weight: 2.5,
          dashArray: "5, 6",
          opacity: 0.78
        });
        seaTrack.addTo(maritimeLayerGroup);
      }

      const shipIcon = L.divIcon({
        className: "zone-mark-wrapper",
        html: `
          <div style="background:${shipColor}; color:#fff; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:700; white-space:nowrap; border:1.5px solid #fff; box-shadow:0 2px 8px rgba(0,0,0,0.45);">
            ${shipEmoji} ${v.name} • ${v.speedKnots} kn
          </div>
        `,
        iconSize: [185, 24],
        iconAnchor: [92, 12]
      });

      const shipMarker = L.marker([v.lat, v.lon], { icon: shipIcon });
      shipMarker.bindPopup(`
        <div style="font-family:sans-serif; min-width:255px;" dir="auto">
          <div style="font-size:11px; font-weight:700; color:#0284c7;">${v.typeLabel}</div>
          <strong style="font-size:14px;">${v.flag} ${v.name}</strong>
          <div style="margin:6px 0; padding:6px 8px; border-radius:6px; background:#f0f9ff; font-size:12px; line-height:1.45;">
            • <strong>MMSI:</strong> ${v.mmsi}<br/>
            • <strong>Anlık Hız &amp; Rota:</strong> ${v.speedKnots} knot (${(v.speedKnots * 1.852).toFixed(1)} km/s) | ${v.courseDeg}&deg;<br/>
            • <strong>Deniz Durumu:</strong> <span style="color:#b91c1c; font-weight:700;">${v.status}</span><br/>
            • <strong>Varış Limanı:</strong> ${v.destination}<br/>
            • <strong>Yük / Görev:</strong> ${v.cargoInfo}<br/>
            • <strong>İstihbarat Notu:</strong> ${v.anomalyNote}
          </div>
        </div>
      `);
      shipMarker.addTo(maritimeLayerGroup);
    });
  }

  // 2.6. Canlı Havacılık, VIP Devlet Uçağı & Askeri Hava (ADS-B) Trafiği Katmanı
  flightMarkersById.clear();
  if (showAviation && Array.isArray(currentData.flights) && aviationLayerGroup) {
    currentData.flights.forEach((f) => {
      const isVip = f.type === "vip_state";
      const isMilAir = f.type === "military_air";
      const flightColor = isVip ? "#d97706" : isMilAir ? "#9333ea" : "#0284c7";
      const flightEmoji = isVip ? "👑✈️" : isMilAir ? "🦅" : "✈️";

      if (Array.isArray(f.trackCoords) && f.trackCoords.length >= 2) {
        const airTrack = L.polyline(f.trackCoords, {
          color: flightColor,
          weight: 2.5,
          dashArray: "3, 6",
          opacity: 0.82
        });
        airTrack.addTo(aviationLayerGroup);
      }

      const flightIcon = L.divIcon({
        className: "zone-mark-wrapper",
        html: `
          <div style="background:${flightColor}; color:#fff; padding:4px 9px; border-radius:10px; font-size:10px; font-weight:700; white-space:nowrap; border:1.5px solid #fff; box-shadow:0 2px 10px rgba(0,0,0,0.55); line-height:1.25; text-align:center;">
            <div>${flightEmoji} ${f.callsign} • ${(f.altitudeFt / 1000).toFixed(1)}k ft</div>
            <div style="font-size:8.5px; color:#fef08a; font-weight:600;">🔔 ${f.alertTriggeredAt || "Canlı"} | ⏳ ${f.flightWindow || ""}</div>
          </div>
        `,
        iconSize: [230, 34],
        iconAnchor: [115, 17]
      });

      const flightMarker = L.marker([f.lat, f.lon], { icon: flightIcon });
      flightMarker.bindPopup(`
        <div style="font-family:sans-serif; min-width:275px;" dir="auto">
          <div style="font-size:11px; font-weight:700; color:#7c3aed;">${f.typeLabel}</div>
          <strong style="font-size:13.5px;">${f.flag} ${f.callsign} — ${f.name}</strong>
          <div style="margin:6px 0; padding:6px 8px; border-radius:6px; background:#f5f3ff; font-size:12px; line-height:1.45;">
            • <strong>🔔 Bildirim Düştü:</strong> <span style="color:#dc2626; font-weight:700;">${f.alertTriggeredAt || "Canlı"}</span><br/>
            • <strong>⏳ Uçuş Saat Aralığı:</strong> <span style="color:#6d28d9; font-weight:700;">${f.flightWindow || "Canlı"} (${f.flightDurationText || "Havada"})</span><br/>
            • <strong>🛫 Kalkış Üssü:</strong> ${f.departureBase || "Askeri Hava Üssü"}<br/>
            • <strong>ICAO24 Transponder:</strong> ${f.icao24}<br/>
            • <strong>İrtifa &amp; Hız:</strong> ${f.altitudeFt.toLocaleString()} ft | ${f.speedKnots} kt (${Math.round(f.speedKnots * 1.852)} km/s)<br/>
            • <strong>Hava Sahası Durumu:</strong> <span style="color:#b91c1c; font-weight:700;">${f.status}</span><br/>
            • <strong>Uçuş Rotası:</strong> ${f.route}<br/>
            • <strong>İstihbarat Notu:</strong> ${f.intelNote}
          </div>
        </div>
      `);
      flightMarker.addTo(aviationLayerGroup);
      flightMarkersById.set(f.id, flightMarker);
    });
  }

  // 3. Gerçek Sokak / Karayolu Güzergahı Üzerinden Koridor Çizimi (OSRM Road Geometry)
  if (showCorridors) {
    const corridorsToDraw = currentData.corridors
      .filter((c) => {
        if (selectedCategoryFilter !== "all" && c.poiCategory !== selectedCategoryFilter) return false;
        if ((c.resType === "lojman" || c.resType === "residential") && !showLojman) return false;
        if (c.resType === "vip_stay" && !showVipStay) return false;
        return true;
      })
      .slice(0, 24);

    for (let idx = 0; idx < corridorsToDraw.length; idx++) {
      const corr = corridorsToDraw[idx];
      const isSelected = corr.id === selectedCorridorId || corr.poiId === selectedPoiId;
      const isClosure = corr.poiRoadClosure;
      const lineColor = isClosure
        ? "#dc2626"
        : corr.resType === "vip_stay"
        ? "#d97706"
        : isSelected
        ? "#7c3aed"
        : "#2563eb";

      const roadCoords =
        isSelected || idx < 6
          ? await fetchRealRoadCoordinates(corr.resLat, corr.resLon, corr.poiLat, corr.poiLon)
          : [
              [corr.resLat, corr.resLon],
              [corr.poiLat, corr.poiLon]
            ];

      const polyline = L.polyline(roadCoords, {
        color: lineColor,
        weight: isSelected ? 5 : 3.2,
        opacity: isSelected ? 0.92 : 0.65,
        className: corr.isActiveWave ? "corridor-animated-line" : ""
      });

      polyline.bindTooltip(
        `${corr.resName} ➔ ${corr.poiName} (%${corr.personnelProbabilityPct} Eşleşme | Δt: -${corr.lagMinutes} dk | r=${corr.timeLagCorrelation})`,
        { sticky: true }
      );

      polyline.on("click", () => {
        selectedCorridorId = corr.id;
        selectedPoiId = corr.poiId;
        renderPoiList();
        renderHousingList();
        renderMapLayers(false);
        const poi = currentData.pois.find((p) => p.id === corr.poiId);
        updateCharts(poi, corr);
      });

      polyline.addTo(corridorLayerGroup);
    }
  }
}

function focusOnPoi(poiId) {
  if (!currentData) return;
  const poi = currentData.pois.find((p) => p.id === poiId);
  if (!poi) return;

  selectedPoiId = poi.id;
  const topCorr = currentData.corridors.find((c) => c.poiId === poi.id) || currentData.corridors[0];
  if (topCorr) selectedCorridorId = topCorr.id;

  renderPoiList();
  renderHousingList();
  renderMapLayers(false);
  updateCharts(poi, topCorr);

  map.flyTo([poi.lat, poi.lon], 14, { duration: 0.6 });
}

function focusOnFlight(flightId) {
  if (!currentData || !Array.isArray(currentData.flights)) return;
  const flight = currentData.flights.find((f) => f.id === flightId);
  if (!flight) return;

  const chkAviation = document.getElementById("chkShowAviation");
  if (chkAviation && !chkAviation.checked) {
    chkAviation.checked = true;
    renderMapLayers(false);
  }

  map.flyTo([flight.lat, flight.lon], 10, { duration: 0.7 });
  setTimeout(() => {
    const marker = flightMarkersById.get(flight.id);
    if (marker) {
      marker.openPopup();
    }
  }, 750);
}

function updateCharts(poi, corridor) {
  if (poi) {
    document.getElementById("selectedPoiTitle").textContent = `📈 ${poi.name}`;
    document.getElementById("selectedPoiSubtitle").textContent = `${
      poi.roadClosureActive
        ? "🚧 CANLI YOL KAPAMASI | "
        : poi.normalRushHourTraffic
        ? "✅ DOĞAL SAATLİK TRAFİK | "
        : ""
    }Şu An (${poi.simHour}) Normal Baz: %${poi.expectedCongestionPct} vs. Canlı: %${poi.currentCongestionPct} (${poi.currentSpeedKmh} km/s)`;

    const ctx1 = document.getElementById("poiBaselineChart").getContext("2d");
    if (baselineChartInstance) baselineChartInstance.destroy();

    const labels = poi.hourlySeries.map((s) => s.hour);
    const expectedData = poi.hourlySeries.map((s) => s.expected);
    const observedData = poi.hourlySeries.map((s) => s.observed);
    const currentHourPrefix = poi.simHour.split(":")[0] + ":00";

    baselineChartInstance = new Chart(ctx1, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Canlı Gözlemlenen Yoğunluk (%)",
            data: observedData,
            borderColor: "#ff3b5c",
            backgroundColor: "rgba(255, 59, 92, 0.16)",
            borderWidth: 2.3,
            fill: true,
            tension: 0.32,
            pointRadius: (ctx) => (labels[ctx.dataIndex] === currentHourPrefix ? 6 : 2)
          },
          {
            label: "Günün Normal Baz Çizgisi (Baseline %)",
            data: expectedData,
            borderColor: "#00e1d9",
            borderDash: [5, 5],
            borderWidth: 1.8,
            fill: false,
            tension: 0.32,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#cbd5e1", boxWidth: 12, font: { size: 10 } }
          }
        },
        scales: {
          x: {
            ticks: { color: "#8fa3c7", font: { size: 9 }, maxTicksLimit: 8 },
            grid: { color: "rgba(255,255,255,0.04)" }
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: "#8fa3c7", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    });
  }

  if (corridor && corridor.waveTimeline) {
    document.getElementById("selectedCorridorTitle").textContent = `🌊 ${corridor.resName} ➔ Kurum Dalgası`;
    document.getElementById("selectedCorridorSubtitle").textContent = `Çıkış Kayması Δt = -${corridor.lagMinutes} dk | Korelasyon r = ${corridor.timeLagCorrelation} | Eşleşme: %${corridor.personnelProbabilityPct}`;

    const ctx2 = document.getElementById("corridorWaveChart").getContext("2d");
    if (waveChartInstance) waveChartInstance.destroy();

    const wLabels = corridor.waveTimeline.map((w) => w.offsetLabel);
    const originSeries = corridor.waveTimeline.map((w) => w.originCongestionPct);
    const poiSeries = corridor.waveTimeline.map((w) => w.poiCongestionPct);

    waveChartInstance = new Chart(ctx2, {
      type: "line",
      data: {
        labels: wLabels,
        datasets: [
          {
            label: "Lojman / Mahalle Çıkış Dalgası (%)",
            data: originSeries,
            borderColor: "#a76bff",
            backgroundColor: "rgba(167, 107, 255, 0.18)",
            borderWidth: 2.2,
            fill: true,
            tension: 0.35
          },
          {
            label: "Başkanlık / Karargah Varış & Kapanma Yoğunluğu (%)",
            data: poiSeries,
            borderColor: "#ffaa2b",
            borderWidth: 2.2,
            fill: false,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#cbd5e1", boxWidth: 12, font: { size: 10 } }
          }
        },
        scales: {
          x: {
            ticks: { color: "#8fa3c7", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.04)" }
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: "#8fa3c7", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    });
  }
}
