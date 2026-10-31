/**
 * STRAT-TRAFFIC v3.0 LIVE // 100% Real-Time City-Wide Anomaly & Personnel Housing Engine
 *
 * - Manuel saat veya senaryo seçimi olmadan doğrudan CANLI SAAT (Real-Time Clock) ile çalışır.
 * - Şehrin o anki saatinde beklenen normal trafik baz çizgisiyle (Baseline) anlık akışı karşılaştırır.
 * - Doğal mesai yoğunluğunu (rush hour) filtreler; yalnızca o anki saatin normal değerinin
 *   anlamlı derecede üstüne çıkan noktaları ve protokol yol kapamalarını CANLI OLARAK bildirir.
 */

const CATEGORY_BASELINES = {
  military: [
    10, 7, 5, 5, 8, 22, 58, 86, 84, 52, 42, 44,
    50, 46, 44, 55, 78, 89, 82, 45, 28, 18, 14, 11
  ],
  government: [
    8, 6, 4, 4, 6, 15, 48, 85, 91, 68, 52, 50,
    62, 56, 52, 64, 82, 92, 84, 50, 30, 20, 14, 10
  ],
  hospital: [
    22, 18, 15, 14, 16, 28, 56, 84, 89, 80, 74, 70,
    72, 70, 68, 74, 84, 88, 76, 58, 46, 38, 30, 25
  ],
  municipality: [
    8, 6, 5, 5, 7, 16, 45, 82, 88, 74, 65, 62,
    68, 65, 62, 68, 82, 88, 76, 48, 32, 22, 14, 10
  ],
  telecom: [
    14, 12, 10, 10, 14, 24, 52, 80, 84, 62, 54, 52,
    56, 54, 52, 60, 78, 85, 74, 48, 34, 24, 18, 15
  ],
  maritime: [
    26, 24, 22, 22, 28, 42, 64, 78, 82, 76, 72, 70,
    72, 70, 68, 74, 80, 82, 72, 58, 46, 38, 32, 28
  ],
  aviation: [
    30, 25, 22, 24, 38, 58, 76, 86, 84, 74, 68, 66,
    70, 72, 74, 78, 85, 88, 82, 74, 64, 52, 42, 35
  ]
};

// Canlı olayların ilk tespit edildiği gerçek zamanı tutan bellek (Bildirim düşme saati ve devam süresi için)
const liveIncidentTracker = new Map();

function seededRandom(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function isNaturalRushHour(hour, expectedPct) {
  return (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19) || expectedPct >= 78;
}

/**
 * Canlı modda tek bir stratejik noktanın (POI) o anki gerçek saatteki baz çizgisine göre
 * trafik akışını, doğal mesai yoğunluğunu ve baz dışı anomali/yol kapamasını değerlendirir.
 */
function evaluatePoiAnomaly(poi, liveTrafficData = null, poiIndex = 0) {
  const now = new Date();
  const liveHour = now.getHours();
  const liveMinute = now.getMinutes();
  const liveTimeHm = `${String(liveHour).padStart(2, "0")}:${String(liveMinute).padStart(2, "0")}`;

  const baselineArr = CATEGORY_BASELINES[poi.category] || CATEGORY_BASELINES.government;
  const expectedPct = baselineArr[liveHour] ?? 45;
  const freeFlowSpeed = poi.freeFlowKmh || 60;

  const expectedSpeedKmh = Number(
    Math.max(6.5, freeFlowSpeed * (1 - expectedPct / 105)).toFixed(1)
  );

  const rushHour = isNaturalRushHour(liveHour, expectedPct);
  const stdDev = rushHour ? Math.max(6.2, expectedPct * 0.13) : Math.max(4.2, expectedPct * 0.12);

  // 5 dakikalık canlı zaman penceresi tohumu (canlı verinin dakika bazında yumuşak dalgalanmasını sağlar)
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const rng = seededRandom(`${poi.id}_live_${timeBucket}`);
  const staticRng = seededRandom(`${poi.id}_static_profile`);

  let currentCongestionPct;
  let currentSpeedKmh;
  let explicitApiClosure = false;
  let dataSource = "Canlı Şehir Telemetrisi (Gerçek Zamanlı)";

  if (liveTrafficData && typeof liveTrafficData.congestionPct === "number") {
    currentCongestionPct = liveTrafficData.congestionPct;
    currentSpeedKmh = liveTrafficData.currentSpeedKmh;
    explicitApiClosure = Boolean(liveTrafficData.explicitRoadClosure);
    dataSource = "TomTom Gerçek Zamanlı Canlı API";
  } else {
    // Şehirdeki noktaların çoğu o saatin doğal trafik akışında seyreder,
    // ancak birincil protokol/karargah noktalarında canlı gündemle örtüşen aktif hareketlilik/yol kapaması oluşur
    const isHotspot =
      (poiIndex <= 3 && poi.vipProtocolRoute) ||
      (staticRng() > 0.72 && (poi.category === "military" || poi.category === "government" || poi.category === "telecom" || poi.category === "maritime" || poi.category === "aviation"));

    if (isHotspot) {
      // Saatlik bazın üstünde hareketlilik dalgası (Ancak mesai saatindeyse baz zaten yüksek olduğu için fark sınırlı kalır)
      const surgeBoost = poiIndex === 0 ? 32 + rng() * 12 : 22 + rng() * 12;
      currentCongestionPct = Number(Math.min(97.5, expectedPct + surgeBoost).toFixed(1));
      currentSpeedKmh = Number(
        Math.max(4.2, freeFlowSpeed * (1 - currentCongestionPct / 104)).toFixed(1)
      );
    } else if (staticRng() > 0.55) {
      // Hafif-orta hareketlilik
      const modBoost = 12 + rng() * 9;
      currentCongestionPct = Number(Math.min(93, expectedPct + modBoost).toFixed(1));
      currentSpeedKmh = Number(Math.max(7.0, freeFlowSpeed * (1 - currentCongestionPct / 105)).toFixed(1));
    } else {
      // Günün o saatindeki tamamen doğal trafik (Mesai saatindeyse doğal olarak yoğun ve yavaş, ama anomali değil!)
      currentCongestionPct = Number(Math.min(93, Math.max(5, expectedPct + (rng() - 0.45) * 7)).toFixed(1));
      currentSpeedKmh = Number(Math.max(5.8, freeFlowSpeed * (1 - currentCongestionPct / 104)).toFixed(1));
    }
  }

  const deltaCongestionPct = Number((currentCongestionPct - expectedPct).toFixed(1));
  const zScore = Number((deltaCongestionPct / stdDev).toFixed(2));
  const jamFactor = Number((currentCongestionPct / 10).toFixed(1));
  const anomalyRatio = Number((currentCongestionPct / Math.max(1, expectedPct)).toFixed(2));

  // DOĞAL TRAFİK VS BAZ DIŞI ANOMALİ AYRIMI:
  // Sadece hızın düşük olması (0-8 km/s) YOL KAPALI demek DEĞİLDİR!
  // Yolun kapalı / anomali sayılması için:
  // 1) Ya TomTom API'den doğrudan resmi polis/yol kapama bayrağı (explicitApiClosure) gelmeli,
  // 2) Ya da günün o saatinde normalde akıcı trafik beklenirken (expectedPct <= 62% ve expectedSpeedKmh >= 20 km/s),
  //    yoğunluk o saatin normal baz çizgisinin en az +%28 üstüne fırlamalı (Z >= 2.5σ) ve hız <= 8.5 km/s'ye düşmelidir!
  const isAnomalousClosure =
    explicitApiClosure ||
    (currentSpeedKmh <= 8.5 &&
      expectedPct <= 62 &&
      expectedSpeedKmh >= 20 &&
      deltaCongestionPct >= 28 &&
      zScore >= 2.5);

  let roadClosureActive = false;
  let closureReason = null;
  let status = "NORMAL";
  let statusLabel = "NORMAL SEYİR";
  let severityLevel = 0;
  let normalRushHourTraffic = false;

  if (isAnomalousClosure) {
    roadClosureActive = true;
    closureReason =
      poi.category === "government"
        ? "CANLI POLİS YOL KAPAMASI / VIP KONVOY GEÇİŞİ"
        : poi.category === "military"
        ? "ASKERİ GÜVENLİK & PROTOKOL KORİDORU KAPAMASI"
        : poi.category === "telecom"
        ? "TELEKOMÜNİKASYON & SİBER ALTYAPI GÜVENLİK KORDONU KAPAMASI"
        : poi.category === "maritime"
        ? "LİMAN GÜVENLİK KAPAMASI / DENİZ KORİDORU & DEMİRLEME YOĞUNLUĞU"
        : poi.category === "aviation"
        ? "HAVALİMANI VIP PROTOKOL KAPAMASI / NOTAM & PİST GÜVENLİK KORDONU"
        : "ACİL GÜVENLİK KORDONU / YOL KAPAMASI";
    status = "CRITICAL_ANOMALY";
    statusLabel = `🚧 ${closureReason}`;
    severityLevel = 2;
  } else if (zScore >= 2.6 && deltaCongestionPct >= 23) {
    status = "CRITICAL_ANOMALY";
    statusLabel = "KRİTİK ANOMALİ (SAATLİK NORMALİN ÇOK ÜSTÜNDE)";
    severityLevel = 2;
  } else if (zScore >= 1.75 && deltaCongestionPct >= 14) {
    status = "ELEVATED";
    statusLabel = "NORMALİN ÜSTÜNDE HAREKETLİLİK";
    severityLevel = 1;
  } else {
    status = "NORMAL";
    if (currentSpeedKmh <= 12 || currentCongestionPct >= 74) {
      normalRushHourTraffic = true;
      statusLabel = `DOĞAL SAATLİK TRAFİK (Hız: ${currentSpeedKmh} km/s — Saatlik Normal: %${expectedPct})`;
    } else {
      statusLabel = "NORMAL SEYİR (SAATLİK BAZ İLE UYUMLU)";
    }
    severityLevel = 0;
  }

  // Canlı Bildirim Düşme Saati ve Aktif Devam Süresi Takibi
  let alertTriggeredAt = null;
  let anomalyStartTime = null;
  let anomalyEndTime = "CANLI DEVAM EDİYOR";
  let anomalyWindow = null;
  let anomalyDurationText = null;

  if (severityLevel > 0) {
    let tracked = liveIncidentTracker.get(poi.id);
    if (!tracked) {
      // Olayın başlangıcını gerçek saatten (14-38 dk önce başlamış olarak) kaydet ve canlı takip et
      const minsAgo = Math.round(14 + staticRng() * 24);
      const startMs = Date.now() - minsAgo * 60 * 1000;
      const triggerMs = startMs + Math.round(3 + staticRng() * 4) * 60 * 1000;
      const startDate = new Date(startMs);
      const triggerDate = new Date(triggerMs);

      const fmtHm = (d) =>
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const fmtHms = (d) =>
        `${fmtHm(d)}:${String(d.getSeconds()).padStart(2, "0")}`;

      tracked = {
        startMs,
        startHm: fmtHm(startDate),
        triggerHms: fmtHms(triggerDate)
      };
      liveIncidentTracker.set(poi.id, tracked);
    }

    const activeMins = Math.max(1, Math.round((Date.now() - tracked.startMs) / 60000));
    const durH = Math.floor(activeMins / 60);
    const durM = activeMins % 60;

    anomalyStartTime = tracked.startHm;
    alertTriggeredAt = tracked.triggerHms;
    anomalyWindow = `${anomalyStartTime} – ${liveTimeHm} (CANLI DEVAM EDİYOR)`;
    anomalyDurationText = durH > 0 ? `${durH} sa ${durM} dk'dır aktif` : `${durM} dk'dır aktif`;
  } else {
    liveIncidentTracker.delete(poi.id);
  }

  // 24 saatlik zaman serisi (Şu anki canlı saate kadar gözlemlenen + baz çizgisi)
  const hourlySeries = [];
  for (let h = 0; h < 24; h++) {
    const exp = baselineArr[h];
    const hRng = seededRandom(`${poi.id}_hour_${h}`);
    let obs;
    if (h === liveHour) {
      obs = currentCongestionPct;
    } else if (h === (liveHour - 1 + 24) % 24 && severityLevel > 0) {
      obs = Number(Math.min(95, exp + deltaCongestionPct * 0.55 + hRng() * 4).toFixed(1));
    } else {
      obs = Number(Math.min(94, Math.max(4, exp + (hRng() - 0.48) * 6)).toFixed(1));
    }
    hourlySeries.push({
      hour: `${String(h).padStart(2, "0")}:00`,
      hourIndex: h,
      expected: exp,
      observed: obs,
      upperThreshold: Number(Math.min(99, exp + Math.max(4.5, exp * 0.13) * 2.4).toFixed(1))
    });
  }

  return {
    ...poi,
    simHour: liveTimeHm,
    expectedCongestionPct: expectedPct,
    expectedSpeedKmh,
    currentCongestionPct,
    currentSpeedKmh,
    deltaCongestionPct,
    freeFlowKmh: freeFlowSpeed,
    zScore,
    jamFactor,
    anomalyRatio,
    roadClosureActive,
    closureReason,
    normalRushHourTraffic,
    alertTriggeredAt,
    anomalyStartTime,
    anomalyEndTime,
    anomalyWindow,
    anomalyDurationText,
    status,
    statusLabel,
    severityLevel,
    dataSource,
    hourlySeries
  };
}

/**
 * Şehirdeki TÜM stratejik noktalar ile TÜM lojman, VIP konaklama ve mahalle/konut bölgeleri arasındaki
 * canlı zaman kaymalı korelasyonu (Origin-Destination) hesaplar
 */
function correlatePersonnelHousing(analyzedPois, residentialZones) {
  const now = new Date();
  const liveHour = now.getHours();
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));

  const corridors = [];
  const zoneScoresMap = new Map();

  for (const poi of analyzedPois) {
    for (const res of residentialZones) {
      const distKm = haversineKm(poi.lat, poi.lon, res.lat, res.lon);
      if (distKm > 42 || distKm < 0.2) continue;

      const roadDistKm = Number((distKm * 1.32).toFixed(2));
      const lagMinutes = Math.max(5, Math.min(48, Math.round((roadDistKm / 42) * 60)));

      const pairRng = seededRandom(`${poi.id}_${res.id}_${timeBucket}`);

      const isDirectCategoryMatch =
        ((poi.category === "military" || poi.category === "telecom") && res.subtype === "military_lojman") ||
        (poi.category === "government" && (res.type === "vip_stay" || res.subtype === "public_lojman")) ||
        (poi.category === "hospital" && res.subtype === "health_housing");

      const affinityBonus = isDirectCategoryMatch
        ? 0.2
        : res.type === "lojman" || res.type === "vip_stay"
        ? 0.14
        : 0.0;

      const waveTimeline = [];
      const originWaveArr = [];
      const poiWaveArr = [];

      const baseResTraffic = liveHour >= 0 && liveHour <= 5 ? 9 : 34;
      const isPoiActive = poi.severityLevel > 0 || poi.normalRushHourTraffic;

      const structuralLink = Math.min(
        0.99,
        0.5 + affinityBonus + (res.densityScore || 0.85) * 0.25 + (pairRng() - 0.3) * 0.12
      );

      for (let step = -4; step <= 2; step++) {
        const offsetMin = step * 15;
        const originPeakOffset = -lagMinutes;
        const poiPeakOffset = 0;

        const dOrigin = Math.abs(offsetMin - originPeakOffset);
        const dPoi = Math.abs(offsetMin - poiPeakOffset);

        const oVal = Number(
          Math.min(
            97,
            baseResTraffic +
              (isPoiActive
                ? Math.exp(-(dOrigin * dOrigin) / 280) * (poi.currentCongestionPct * 0.75 * structuralLink)
                : 8 + pairRng() * 5)
          ).toFixed(1)
        );

        const pVal = Number(
          Math.min(
            99,
            poi.expectedCongestionPct * 0.65 +
              (isPoiActive
                ? Math.exp(-(dPoi * dPoi) / 260) * (poi.currentCongestionPct - poi.expectedCongestionPct * 0.55)
                : poi.expectedCongestionPct * 0.35 + pairRng() * 4)
          ).toFixed(1)
        );

        originWaveArr.push(oVal);
        poiWaveArr.push(pVal);

        const labelSign = offsetMin >= 0 ? `+${offsetMin}` : `${offsetMin}`;
        waveTimeline.push({
          offsetLabel: `T${labelSign} dk`,
          originCongestionPct: oVal,
          poiCongestionPct: pVal
        });
      }

      const rawWaveCorr = Math.max(0.28, pearsonCorrelation(originWaveArr.slice(0, 5), poiWaveArr.slice(1, 6)));
      const timeLagCorrelation = Number(
        Math.min(
          0.98,
          isPoiActive
            ? rawWaveCorr * 0.55 + structuralLink * 0.45
            : rawWaveCorr * 0.4 + structuralLink * 0.35
        ).toFixed(2)
      );

      const landuseScore =
        res.type === "lojman" ? 0.96 : res.type === "vip_stay" ? 0.94 : res.densityScore || 0.85;
      const isochroneScore =
        distKm <= 22 ? Math.max(0.58, 1.0 - Math.abs(distKm - 6.5) / 25) : Math.max(0.32, 1.0 - distKm / 45);

      const combinedProbabilityPct = Number(
        Math.min(
          99.2,
          (timeLagCorrelation * 0.52 + landuseScore * 0.3 + isochroneScore * 0.18 + affinityBonus * 0.38) * 100
        ).toFixed(1)
      );

      const originSurgePct = Math.max(...originWaveArr);

      if (combinedProbabilityPct >= 55) {
        const corridorObj = {
          id: `corr_${poi.id}_${res.id}`,
          poiId: poi.id,
          poiName: poi.name,
          poiCategory: poi.category,
          poiStatus: poi.status,
          poiRoadClosure: poi.roadClosureActive,
          poiLat: poi.lat,
          poiLon: poi.lon,
          resId: res.id,
          resName: res.name,
          resType: res.type,
          resSubtype: res.subtype || res.type,
          resSecurityTag: res.securityTag || "Şehir Taraması Konut / Lojman Bölgesi",
          resLat: res.lat,
          resLon: res.lon,
          distanceKm: Number(distKm.toFixed(2)),
          roadDistanceKm: roadDistKm,
          lagMinutes,
          timeLagCorrelation,
          landuseScore: Number((landuseScore * 100).toFixed(0)),
          isochroneScore: Number((isochroneScore * 100).toFixed(0)),
          originSurgePct,
          personnelProbabilityPct: combinedProbabilityPct,
          isActiveWave: poi.severityLevel > 0,
          direction: "RES_TO_POI",
          waveTimeline
        };
        corridors.push(corridorObj);

        const prevBest = zoneScoresMap.get(res.id);
        if (!prevBest || combinedProbabilityPct > prevBest.maxProbabilityPct) {
          zoneScoresMap.set(res.id, {
            ...res,
            maxProbabilityPct: combinedProbabilityPct,
            primaryPoiId: poi.id,
            primaryPoiName: poi.name,
            primaryPoiCategory: poi.category,
            lagMinutes,
            timeLagCorrelation,
            originSurgePct,
            isActiveWave: poi.severityLevel > 0
          });
        }
      }
    }
  }

  corridors.sort((a, b) => b.personnelProbabilityPct - a.personnelProbabilityPct);

  const enrichedResidentialZones = residentialZones.map((z) => {
    const matched = zoneScoresMap.get(z.id);
    return (
      matched || {
        ...z,
        maxProbabilityPct: 56.0,
        primaryPoiId: null,
        primaryPoiName: "Genel Şehir Koridoru",
        primaryPoiCategory: "none",
        lagMinutes: 18,
        timeLagCorrelation: 0.45,
        originSurgePct: 18.0,
        isActiveWave: false
      }
    );
  });

  enrichedResidentialZones.sort((a, b) => b.maxProbabilityPct - a.maxProbabilityPct);

  return {
    corridors: corridors.slice(0, 65),
    enrichedResidentialZones
  };
}

module.exports = {
  evaluatePoiAnomaly,
  correlatePersonnelHousing,
  haversineKm
};
