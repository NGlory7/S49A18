# STRAT-TRAFFIC // LIVE GEO-OSINT VIEWER

> **This project was made only for my personal fantasies. I just love to watch.**

---

## Overview / Genel Bakış

**STRAT-TRAFFIC** is a lightweight, zero-dependency real-time Geo-OSINT & urban traffic telemetry dashboard that visualizes publicly available map layers, open-source infrastructure nodes, and live news feeds on a single interactive map.

**STRAT-TRAFFIC**, tamamen halka açık harita katmanlarını, açık kaynaklı kritik altyapı noktalarını ve çok dilli canlı haber akışlarını tek bir interaktif harita üzerinde birleştiren, sıfır bağımlılıklı (zero-dependency) bir gerçek zamanlı izleme arayüzüdür.

---

## Key Features / Özellikler

- **Nationwide Strategic & Infrastructure Mapping (Ülke Geneli Haritalama):**
  - Displays publicly documented strategic locations across **Israel (`IL`)** and **Iran (`IR`)** in a unified nationwide view:
    - `📡` **Telecommunications & Cyber Infrastructure:** Satellite ground stations, submarine fiber-optic cable landing stations, national IXP/data centers, and main radio/broadcast towers.
    - `✈️` **Airports, VIP State Terminals & Live Military Flight Alerts (ADS-B):** International airports, VIP presidential/government terminals (Ben Gurion, Ramon, Haifa, Herzliya, Tehran IKA, Mehrabad VIP Pavilion, Isfahan, Tabriz, Shiraz, Mashhad, Bandar Abbas), and dedicated **live military & VIP flight notifications** displaying trigger timestamps (`HH:MM:SS`), active flight time windows (`HH:MM – HH:MM`), departure airbases, `ICAO24` transponders, altitude (`ft`), speed (`kt`), and flight tracks.
    - `⚓` **Maritime Ports, Naval Terminals & Live AIS Ship Traffic:** Major container ports, crude oil/LNG tanker terminals (Haifa, Ashdod, Eilat, Ashkelon, Bandar Abbas, Kharg Island, Chabahar, Jask, Assaluyeh, Strait of Hormuz), OpenSeaMap seamarks, and live vessel/tanker/naval patrol telemetry (`MMSI`, speed in `knots`, course, and shipping lane tracks).
    - `🛡️` **Military & Strategic Installations:** Airbases, naval bases, missile defense sites, and command headquarters.
    - `🏛️` **Government Complexes:** Ministries, parliaments, and executive complexes.
    - `🏢` **Municipalities & Local Administrations:** Major city halls and provincial headquarters.
    - `🏥` **Hospitals & Medical Centers:** Major trauma and regional medical campuses.
    - `🎖️` **Open-Source Staff Quarters (Lojmanlar):** Publicly mapped military/staff housing zones and barracks.
    - `🏨` **VIP & Diplomatic Zones:** Embassies, diplomatic residences, and state guesthouses.
- **Hourly Baseline vs. Live Traffic Comparison (Saatlik Normal Baz Karşılaştırması):**
  - Filters out natural rush-hour slowdowns (`07:00–09:00` and `16:00–19:00`) by comparing current flow against the expected 24-hour baseline curve ($Z = \frac{x - \mu}{\sigma}$).
  - Highlights only anomalous traffic surges or protocol road closures along with trigger timestamps and active duration windows.
- **Multi-Script Live News & Automatic Translation (Çok Dilli Canlı Gündem & Otomatik Çeviri):**
  - Scans public Google News RSS feeds in **Hebrew (`עברית`)**, **Persian (`فارسی`)**, **Arabic (`العربية`)**, **English (`EN`)**, and **Turkish (`TR`)** in real time and automatically translates foreign headlines into readable Turkish while preserving the original script below.
- **Google Maps Live Traffic & Real Road Routing:**
  - Built-in Google Maps Live Traffic tile layer (`google_traffic`, `google_hybrid`, `google_standard`, `dark_osint`) and real street-level corridor routing via public OSRM.

---

## Run Locally / Lokal Kurulum ve Çalıştırma

This project uses **100% native Node.js** (`node:http`, `node:fs`, `node:path`, `fetch`) and requires **no `npm install` or external packages** and **no API keys** to run out of the box.

Projeyi çalıştırmak için herhangi bir kütüphane kurulumuna (`npm install`) veya zorunlu API anahtarına ihtiyaç yoktur. Doğrudan **Node.js (v18+)** ile her bilgisayarda çalışır:

```bash
# 1. Clone the repository / Repoyu klonlayın
git clone https://github.com/NGlory7/S49A18.git
cd S49A18

# 2. Start the server / Sunucuyu başlatın
node server.js
# or / veya
npm start
```

Then open your browser at / Tarayıcınızda açın:

```text
http://localhost:8080
```

*(Optional / İsteğe Bağlı)*: You can change the port via `PORT=3000 node server.js` or provide a free TomTom Traffic Flow API key from the `⚙️ API` button in the UI if you want external numerical speed sensor polling.

---

## Data Sources & Disclaimer / Veri Kaynakları ve Beyan

- **100% Public Open-Source Data:** All coordinates, map layers, road geometries, and news headlines are fetched dynamically from publicly accessible services (**OpenStreetMap Overpass API**, **Nominatim**, **OSRM**, **Google Maps Public Traffic Tiles**, and **Google News Public RSS**).
- **No Private or Classified Data:** This repository contains no private credentials, no personal data, and no restricted information.
- *This project was made only for my personal fantasies. I just love to watch.*
