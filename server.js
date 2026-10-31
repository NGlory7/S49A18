/**
 * STRAT-TRAFFIC v3.0 LIVE // 100% Real-Time Full-City OSINT, Agenda & Personnel Housing Server
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const { evaluatePoiAnomaly, correlatePersonnelHousing } = require("./src/engine/anomalyEngine");
const {
  COUNTRIES_AND_CITIES,
  isWithinIsraelOrIran,
  discoverFullCityZones,
  getLiveMaritimeVessels,
  getLiveAviationFlights,
  fetchTomTomFlow
} = require("./src/services/geoService");
const { fetchLiveAgendaAndMeetings } = require("./src/services/agendaService");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function findCityConfig(countryCode, cityId) {
  const country = COUNTRIES_AND_CITIES[countryCode];
  if (country) {
    const found = country.cities.find((c) => c.id === cityId);
    if (found) return { countryName: country.name, ...found };
  }
  for (const [cCode, cObj] of Object.entries(COUNTRIES_AND_CITIES)) {
    const found = cObj.cities.find((c) => c.id === cityId);
    if (found) return { countryCode: cCode, countryName: cObj.name, ...found };
  }
  return {
    countryCode: "IL",
    countryName: "İsrail — Ülke Geneli (ישראל)",
    id: "il_all",
    name: "🇮🇱 İSRAİL ÜLKE GENELİ (Tüm Askeri, Telekom, Hükümet, Lojman & VIP)",
    lat: 31.8500,
    lon: 34.9200,
    radiusM: 180000,
    zoom: 8
  };
}

async function handleAnalyzeApi(reqUrl, res) {
  const country = reqUrl.searchParams.get("country") || "IL";
  const city = reqUrl.searchParams.get("city") || (country === "IR" ? "ir_all" : "il_all");
  const latParam = reqUrl.searchParams.get("lat");
  const lonParam = reqUrl.searchParams.get("lon");
  const customName = reqUrl.searchParams.get("customName") || "";
  const tomtomKey = reqUrl.searchParams.get("tomtomKey") || "";

  const now = new Date();
  const liveClockStr = now.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const liveHourHm = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  let center;
  let radiusM = 15000;
  let regionName;
  let targetCityId = city;
  let targetZoom = 8;

  if (
    latParam !== null &&
    lonParam !== null &&
    latParam !== "" &&
    lonParam !== "" &&
    isWithinIsraelOrIran(parseFloat(latParam), parseFloat(lonParam))
  ) {
    const lat = parseFloat(latParam);
    const lon = parseFloat(lonParam);
    center = { lat, lon };
    regionName = customName
      ? `${customName} [İsrail/İran Canlı Taraması]`
      : `Dinamik Bölge Taraması (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    targetCityId = customName ? customName.toLowerCase() : "dynamic";
    targetZoom = 12;
  } else {
    const cityCfg = findCityConfig(country, city);
    center = { lat: cityCfg.lat, lon: cityCfg.lon };
    radiusM = cityCfg.radiusM || 15000;
    regionName = `${cityCfg.name}`;
    targetCityId = cityCfg.id;
    targetZoom = cityCfg.zoom || 8;
  }

  // Eşzamanlı olarak:
  // 1) Seçilen şehirdeki TÜM bölgeleri (Overpass OSM + Tam Şehir Keşif Motoru) tara
  // 2) O şehirdeki çok dilli canlı haber/görüşme/gündem akışını çek
  const [cityDiscovery, agenda] = await Promise.all([
    discoverFullCityZones(targetCityId, center.lat, center.lon, radiusM),
    fetchLiveAgendaAndMeetings(targetCityId, regionName)
  ]);

  const rawPois = cityDiscovery.pois;
  const rawResidential = cityDiscovery.residential;

  let sourceMode = `Ülke Geneli Açık Kaynak Keşfi (${rawPois.length} Askeri/Telekom/Kamu Tesisi, ${rawResidential.length} Lojman/VIP Bölgesi) + Çok Dilli RSS`;

  // Her POI için canlı saat bazlı anomali ve trafik değerlendirmesi
  const analyzedPois = [];
  for (let i = 0; i < rawPois.length; i++) {
    const poi = rawPois[i];
    let liveData = null;
    if (tomtomKey.trim() && i < 12) {
      liveData = await fetchTomTomFlow(poi.lat, poi.lon, tomtomKey.trim());
      if (liveData) {
        sourceMode = `TomTom Canlı Trafik API + Tam Şehir OSM (${rawPois.length} Nokta)`;
      }
    }
    const evaluated = evaluatePoiAnomaly(poi, liveData, i);
    analyzedPois.push(evaluated);
  }

  // Tüm şehirdeki Lojman, VIP Konaklama ve Mahallelerin korelasyonu
  const { corridors, enrichedResidentialZones } = correlatePersonnelHousing(
    analyzedPois,
    rawResidential
  );

  const topAgendaTitle =
    agenda && agenda.items && agenda.items.length > 0
      ? agenda.items[0].title
      : "Üst Düzey Protokol / Güvenlik Görüşmesi";

  // Sadece saatlik normal bazın üstüne çıkan CANLI anomali & yol kapatma bildirimleri
  const alerts = analyzedPois
    .filter((p) => p.severityLevel > 0)
    .sort((a, b) => (b.roadClosureActive ? 1 : 0) - (a.roadClosureActive ? 1 : 0) || b.zScore - a.zScore)
    .map((p, idx) => {
      const topCorridor = corridors.find((c) => c.poiId === p.id);
      const matchedAgendaItem =
        agenda.items[idx % Math.max(1, agenda.items.length)] || agenda.items[0] || null;

      return {
        id: `alert_${p.id}`,
        poiId: p.id,
        poiName: p.name,
        category: p.category,
        status: p.status,
        statusLabel: p.statusLabel,
        roadClosureActive: p.roadClosureActive,
        closureReason: p.closureReason,
        simHour: p.simHour,
        alertTriggeredAt: p.alertTriggeredAt,
        anomalyStartTime: p.anomalyStartTime,
        anomalyEndTime: p.anomalyEndTime,
        anomalyWindow: p.anomalyWindow,
        anomalyDurationText: p.anomalyDurationText,
        expectedCongestionPct: p.expectedCongestionPct,
        currentCongestionPct: p.currentCongestionPct,
        currentSpeedKmh: p.currentSpeedKmh,
        zScore: p.zScore,
        arterialName: p.arterialName || "Ana Protokol Arteri",
        linkedHousingName: topCorridor ? topCorridor.resName : "Tespit Ediliyor",
        linkedHousingType: topCorridor ? topCorridor.resType : "lojman",
        linkedHousingProb: topCorridor ? topCorridor.personnelProbabilityPct : 0,
        linkedLagMin: topCorridor ? topCorridor.lagMinutes : 18,
        potentialAgendaTitle: matchedAgendaItem ? matchedAgendaItem.title : topAgendaTitle,
        potentialAgendaTag: matchedAgendaItem ? matchedAgendaItem.tag : "CANLI GÜNDEM",
        summary: p.roadClosureActive
          ? `${p.arterialName} üzerinde anlık hız ${p.currentSpeedKmh} km/s seviyesine düştü (${p.closureReason}). ${
              topCorridor
                ? `Kapanmadan ${topCorridor.lagMinutes} dk önce ${topCorridor.resName} bölgesinde çıkış dalgası (%${topCorridor.personnelProbabilityPct} eşleşme) tespit edildi.`
                : ""
            }`
          : `${p.name} çevresinde şu an (${p.simHour}) saatlik normal %${p.expectedCongestionPct} yerine %${p.currentCongestionPct} yoğunluk var (Z: +${p.zScore}σ).`
      };
    });

  const criticalCount = analyzedPois.filter((p) => p.status === "CRITICAL_ANOMALY").length;
  const roadClosureCount = analyzedPois.filter((p) => p.roadClosureActive).length;
  const elevatedCount = analyzedPois.filter((p) => p.status === "ELEVATED").length;
  const maxZScore = analyzedPois.reduce((max, p) => Math.max(max, p.zScore), 0);
  const vessels = getLiveMaritimeVessels(targetCityId);
  const flights = getLiveAviationFlights(targetCityId);

  const flightAlerts = flights.map((f) => ({
    id: `falert_${f.id}`,
    flightId: f.id,
    callsign: f.callsign,
    icao24: f.icao24,
    name: f.name,
    flag: f.flag,
    type: f.type,
    typeLabel: f.typeLabel,
    departureBase: f.departureBase || "Askeri Hava Üssü",
    route: f.route,
    status: f.status,
    altitudeFt: f.altitudeFt,
    speedKnots: f.speedKnots,
    alertTriggeredAt: f.alertTriggeredAt || liveClockStr,
    flightStartTime: f.flightStartTime || liveHourHm,
    flightWindow: f.flightWindow || `${liveHourHm} – ${liveHourHm} (CANLI HAVADA)`,
    flightDurationText: f.flightDurationText || "Canlı uçuşta",
    intelNote: f.intelNote,
    lat: f.lat,
    lon: f.lon
  }));

  return sendJson(res, 200, {
    timestamp: now.toISOString(),
    liveClockStr,
    regionName,
    center,
    zoom: targetZoom,
    simHour: liveHourHm,
    sourceMode,
    summary: {
      totalPois: analyzedPois.length,
      criticalCount,
      roadClosureCount,
      elevatedCount,
      maxZScore,
      detectedHousingCount: enrichedResidentialZones.length,
      activeCorridorsCount: corridors.filter((c) => c.isActiveWave).length,
      vesselCount: vessels.length,
      flightCount: flights.length,
      flightAlertCount: flightAlerts.length
    },
    agenda,
    pois: analyzedPois,
    residentialZones: enrichedResidentialZones,
    corridors,
    vessels,
    flights,
    flightAlerts,
    alerts
  });
}

async function handleGeocodeApi(reqUrl, res) {
  const q = reqUrl.searchParams.get("q") || "";
  if (!q.trim()) {
    return sendJson(res, 400, { error: "İsrail veya İran içinde bir şehir/bölge adı giriniz." });
  }
  try {
    // Yalnızca İsrail (il) ve İran (ir) sınırları içinde arama yapılır; Türkiye dahil diğer ülkeler kapalıdır.
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=il,ir&limit=1&q=${encodeURIComponent(
      q.trim()
    )}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "StratTrafficOSINT/3.2",
        "Accept-Language": "tr,en,he,fa,ar"
      }
    });
    if (resp.ok) {
      const arr = await resp.json();
      if (arr && arr.length > 0) {
        return sendJson(res, 200, {
          found: true,
          name: arr[0].display_name.split(",").slice(0, 2).join(", "),
          lat: parseFloat(arr[0].lat),
          lon: parseFloat(arr[0].lon)
        });
      }
    }
  } catch (_) {}
  return sendJson(res, 200, { found: false });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (reqUrl.pathname === "/api/countries") {
      return sendJson(res, 200, COUNTRIES_AND_CITIES);
    }

    if (reqUrl.pathname === "/api/analyze") {
      return await handleAnalyzeApi(reqUrl, res);
    }

    if (reqUrl.pathname === "/api/geocode") {
      return await handleGeocodeApi(reqUrl, res);
    }

    let safePath = path.normalize(reqUrl.pathname).replace(/^(\.\.[\/\\])+/, "");
    if (safePath === "/" || safePath === "\\") {
      safePath = "/index.html";
    }

    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Dosya bulunamadı");
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
      });
      res.end(content);
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Sunucu hatası" });
  }
});

server.listen(PORT, () => {
  console.log(`\n========================================================================`);
  console.log(`STRAT-TRAFFIC v3.0 LIVE // TAM ŞEHİR CANLI TARAMA & İSTİHBARAT AKTİF`);
  console.log(`Arayüz Adresi: http://localhost:${PORT}`);
  console.log(`========================================================================\n`);
});
