import { useEffect, useState } from "react";
import "./App.css";

type PingResultItem = {
  deviceName: string;
  deviceAddress: string;
  status: "up" | "down";
  latencyMs: number | null;
  voltage: number | null;
  current: number | null;
  temperature: number | null;
  latitude: number | null;
  longitude: number | null;
  checkedAt: string;
  message: string;
};

type MapPoint = {
  id: string;
  x: number;
  y: number;
  item: PingResultItem;
};

const TURKEY_BOUNDS = {
  minLat: 35.8,
  maxLat: 42.2,
  minLon: 25.5,
  maxLon: 45,
};

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  istanbul: { lat: 41.0082, lon: 28.9784 },
  ankara: { lat: 39.9334, lon: 32.8597 },
  izmir: { lat: 38.4237, lon: 27.1428 },
  bursa: { lat: 40.195, lon: 29.06 },
  antalya: { lat: 36.8969, lon: 30.7133 },
  adana: { lat: 37.0, lon: 35.3213 },
  konya: { lat: 37.8713, lon: 32.4846 },
  kayseri: { lat: 38.7225, lon: 35.4875 },
  trabzon: { lat: 41.0015, lon: 39.7178 },
  gaziantep: { lat: 37.0662, lon: 37.3833 },
  samsun: { lat: 41.2867, lon: 36.33 },
  van: { lat: 38.4891, lon: 43.4089 },
  diyarbakir: { lat: 37.9144, lon: 40.2306 },
  eskisehir: { lat: 39.7767, lon: 30.5206 },
  mersin: { lat: 36.8, lon: 34.6333 },
};

function hashCode(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function toMapXY(lat: number, lon: number): { x: number; y: number } {
  const x =
    ((lon - TURKEY_BOUNDS.minLon) /
      (TURKEY_BOUNDS.maxLon - TURKEY_BOUNDS.minLon)) *
    100;
  const y =
    (1 -
      (lat - TURKEY_BOUNDS.minLat) /
        (TURKEY_BOUNDS.maxLat - TURKEY_BOUNDS.minLat)) *
    100;

  return {
    x: Math.min(96, Math.max(4, x)),
    y: Math.min(90, Math.max(12, y)),
  };
}

function inferCoordinates(item: PingResultItem): { lat: number; lon: number } {
  if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    return { lat: item.latitude, lon: item.longitude };
  }

  const lowerName = item.deviceName.toLocaleLowerCase("tr-TR");
  const namedCity = Object.entries(CITY_COORDS).find(([city]) =>
    lowerName.includes(city),
  );

  if (namedCity) {
    return { lat: namedCity[1].lat, lon: namedCity[1].lon };
  }

  const seed = hashCode(`${item.deviceName}-${item.deviceAddress}`);
  const latRatio = (seed % 1000) / 1000;
  const lonRatio = ((seed / 1000) % 1000) / 1000;

  return {
    lat:
      TURKEY_BOUNDS.minLat +
      latRatio * (TURKEY_BOUNDS.maxLat - TURKEY_BOUNDS.minLat),
    lon:
      TURKEY_BOUNDS.minLon +
      lonRatio * (TURKEY_BOUNDS.maxLon - TURKEY_BOUNDS.minLon),
  };
}

function parseMetric(text: string, aliases: string[]): number | null {
  const normalized = text.replace(",", ".").toLocaleLowerCase("tr-TR");
  const aliasPattern = aliases.join("|");
  const regex = new RegExp(
    `(?:${aliasPattern})\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)`,
  );
  const match = normalized.match(regex);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function withDerivedTelemetry(item: PingResultItem): PingResultItem {
  const message = item.message ?? "";

  return {
    ...item,
    voltage:
      item.voltage ?? parseMetric(message, ["voltage", "volt", "voltaj", "v"]),
    current:
      item.current ?? parseMetric(message, ["current", "akim", "amp", "a"]),
    temperature:
      item.temperature ??
      parseMetric(message, ["temperature", "sicaklik", "temp", "c"]),
  };
}

function App() {
  const [pingResults, setPingResults] = useState<PingResultItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activePointId, setActivePointId] = useState<string | null>(null);

  const publicIngestUrl = (() => {
    if (typeof window === "undefined") {
      return "https://ufukcetinkaya.com.tr/api/ping-results";
    }

    const host = window.location.host;
    const isLocalHost =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("0.0.0.0");

    if (isLocalHost) {
      return `${window.location.origin}/api/ping-results`;
    }

    return `https://${host}/api/ping-results`;
  })();

  const fetchPingResults = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch(publicIngestUrl);
      if (!response.ok) {
        throw new Error("Ping sonuçları alınamadı.");
      }

      const data = (await response.json()) as { items: PingResultItem[] };

      setPingResults((data.items ?? []).map(withDerivedTelemetry));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Sonuçlar alınırken hata oluştu.";
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPingResults();
    const timer = setInterval(() => {
      void fetchPingResults();
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const points: MapPoint[] = pingResults.map((item, index) => {
    const location = inferCoordinates(item);
    const mapped = toMapXY(location.lat, location.lon);

    return {
      id: `${item.deviceName}-${item.deviceAddress}-${item.checkedAt}-${index}`,
      x: mapped.x,
      y: mapped.y,
      item,
    };
  });

  const activePoint =
    points.find((point) => point.id === activePointId) ?? points[0];

  const osmEmbedUrl =
    "https://www.openstreetmap.org/export/embed.html?bbox=25.5%2C35.8%2C45%2C42.2&layer=mapnik";

  return (
    <main className="dashboard">
      <header className="hero">
        <p className="hero-kicker">Rectifier Telemetry Grid</p>
        <h1>Turkiye Geneli Uzak Cihaz Izleme</h1>
        <p className="hero-subtitle">
          Uzak cihazdan gelen voltaj, akim ve sicaklik verileri harita uzerinde
          canli popup ile izlenir.
        </p>
        <div className="hero-actions">
          <button
            onClick={() => {
              void fetchPingResults();
            }}
            aria-label="refresh device telemetry"
            disabled={isLoading}
          >
            {isLoading ? "Yukleniyor..." : "Veriyi Yenile"}
          </button>
          <span className="ingest-url">POST URL: {publicIngestUrl}</span>
        </div>
        {loadError ? <p className="ping-error">Hata: {loadError}</p> : null}
      </header>

      <section className="map-panel" aria-label="Turkiye cihaz haritasi">
        <iframe
          title="OpenStreetMap Turkiye"
          className="osm-map"
          src={osmEmbedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />

        <a
          className="osm-attribution"
          href="https://www.openstreetmap.org/#map=6/39.0/35.0"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>

        {points.map((point) => (
          <button
            key={point.id}
            type="button"
            className={`device-dot ${point.item.status === "up" ? "is-up" : "is-down"} ${activePoint?.id === point.id ? "is-active" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            onClick={() => setActivePointId(point.id)}
            aria-label={`${point.item.deviceName} cihazini sec`}
          >
            <span>{point.item.deviceName.slice(0, 2).toUpperCase()}</span>
          </button>
        ))}

        {activePoint ? (
          <aside className="telemetry-popup" role="status" aria-live="polite">
            <h2>{activePoint.item.deviceName}</h2>
            <p className="popup-meta">{activePoint.item.deviceAddress}</p>
            <p
              className={`popup-status ${activePoint.item.status === "up" ? "up" : "down"}`}
            >
              Durum: {activePoint.item.status === "up" ? "Aktif" : "Pasif"}
            </p>
            <div className="metric-grid">
              <div>
                <span>Voltaj</span>
                <strong>{activePoint.item.voltage ?? "-"} V</strong>
              </div>
              <div>
                <span>Akim</span>
                <strong>{activePoint.item.current ?? "-"} A</strong>
              </div>
              <div>
                <span>Sicaklik</span>
                <strong>{activePoint.item.temperature ?? "-"} C</strong>
              </div>
              <div>
                <span>Gecikme</span>
                <strong>{activePoint.item.latencyMs ?? "-"} ms</strong>
              </div>
            </div>
            <p className="popup-meta">
              Son Guncelleme:{" "}
              {new Date(activePoint.item.checkedAt).toLocaleString("tr-TR")}
            </p>
            <p className="popup-message">{activePoint.item.message}</p>
          </aside>
        ) : (
          <aside className="telemetry-popup empty">
            Henüz veri yok. Uzak cihazdan POST ile veri gönderildiğinde burada
            görünecek.
          </aside>
        )}
      </section>
    </main>
  );
}

export default App;
