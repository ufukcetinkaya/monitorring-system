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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function latToMercator(lat: number): number {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

function toMapXY(lat: number, lon: number): { x: number; y: number } {
  const clampedLon = clamp(lon, TURKEY_BOUNDS.minLon, TURKEY_BOUNDS.maxLon);
  const clampedLat = clamp(lat, TURKEY_BOUNDS.minLat, TURKEY_BOUNDS.maxLat);

  const x =
    ((clampedLon - TURKEY_BOUNDS.minLon) /
      (TURKEY_BOUNDS.maxLon - TURKEY_BOUNDS.minLon)) *
    100;

  const top = latToMercator(TURKEY_BOUNDS.maxLat);
  const bottom = latToMercator(TURKEY_BOUNDS.minLat);
  const current = latToMercator(clampedLat);
  const y = ((top - current) / (top - bottom)) * 100;

  return {
    x: clamp(x, 2, 98),
    y: clamp(y, 2, 98),
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

  const points: MapPoint[] = pingResults
    .map((item, index) => {
      if (
        typeof item.latitude !== "number" ||
        typeof item.longitude !== "number"
      ) {
        return null;
      }

      const mapped = toMapXY(item.latitude, item.longitude);

      return {
        id: `${item.deviceName}-${item.deviceAddress}-${item.checkedAt}-${index}`,
        x: mapped.x,
        y: mapped.y,
        item,
      };
    })
    .filter((point): point is MapPoint => point !== null);

  const devicesWithoutCoordinates = pingResults.length - points.length;

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
          {devicesWithoutCoordinates > 0 ? (
            <span className="ingest-url">
              Koordinat eksik cihaz: {devicesWithoutCoordinates}
            </span>
          ) : null}
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
