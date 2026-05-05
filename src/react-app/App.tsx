import { useEffect, useRef, useState } from "react";
import "./App.css";

type PingResultItem = {
  deviceName: string;
  deviceAddress: string;
  status: string;
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
  lat: number;
  lon: number;
  item: PingResultItem;
};

type LeafletMapInstance = {
  remove: () => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>,
  ) => void;
};

type LeafletApi = {
  map: (
    el: HTMLElement,
    options?: Record<string, unknown>,
  ) => LeafletMapInstance;
  tileLayer: (
    url: string,
    options?: Record<string, unknown>,
  ) => {
    addTo: (target: unknown) => void;
  };
  layerGroup: () => {
    addTo: (target: unknown) => { clearLayers: () => void };
  };
  circleMarker: (
    latlng: [number, number],
    options?: Record<string, unknown>,
  ) => {
    addTo: (target: unknown) => void;
    on: (eventName: string, cb: () => void) => void;
    bindPopup: (
      html: string,
      options?: Record<string, unknown>,
    ) => { openPopup: () => void };
  };
};

declare global {
  interface Window {
    L?: LeafletApi;
  }
}

const TURKEY_BOUNDS = {
  minLat: 35.8,
  maxLat: 42.2,
  minLon: 25.5,
  maxLon: 45,
};

async function loadLeaflet(): Promise<LeafletApi> {
  if (window.L) {
    return window.L;
  }

  const styleId = "leaflet-css-cdn";
  if (!document.getElementById(styleId)) {
    const link = document.createElement("link");
    link.id = styleId;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-leaflet="true"]',
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Leaflet yüklenemedi.")),
        {
          once: true,
        },
      );
      if (window.L) {
        resolve();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.dataset.leaflet = "true";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Leaflet yüklenemedi."));
    document.body.appendChild(script);
  });

  if (!window.L) {
    throw new Error("Leaflet başlatılamadı.");
  }

  return window.L;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createPopupHtml(item: PingResultItem): string {
  const statusText = isOnlineStatus(item.status) ? "Aktif" : "Pasif";

  return `
    <div style="min-width:220px;font-family:Segoe UI,Tahoma,sans-serif;line-height:1.4;">
      <strong style="font-size:14px;">${escapeHtml(item.deviceName)}</strong>
      <div style="font-size:12px;color:#4b5563;margin:2px 0 8px;">${escapeHtml(item.deviceAddress)}</div>
      <div style="font-size:12px;margin:3px 0;"><b>Durum:</b> ${statusText}</div>
      <div style="font-size:12px;margin:3px 0;"><b>Voltaj:</b> ${item.voltage ?? "-"} V</div>
      <div style="font-size:12px;margin:3px 0;"><b>Akim:</b> ${item.current ?? "-"} A</div>
      <div style="font-size:12px;margin:3px 0;"><b>Sicaklik:</b> ${item.temperature ?? "-"} C</div>
      <div style="font-size:12px;margin:3px 0;"><b>Gecikme:</b> ${item.latencyMs ?? "-"} ms</div>
      <div style="font-size:11px;color:#6b7280;margin-top:8px;">${escapeHtml(new Date(item.checkedAt).toLocaleString("tr-TR"))}</div>
    </div>
  `;
}

function isOnlineStatus(status: string): boolean {
  const normalized = status.trim().toLocaleLowerCase("tr-TR");
  return normalized === "up" || normalized === "online";
}

function App() {
  const [pingResults, setPingResults] = useState<PingResultItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const markerLayerRef = useRef<{ clearLayers: () => void } | null>(null);

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

      return {
        id: `${item.deviceName}-${item.deviceAddress}-${item.checkedAt}-${index}`,
        lat: item.latitude,
        lon: item.longitude,
        item,
      };
    })
    .filter((point): point is MapPoint => point !== null);

  const devicesWithoutCoordinates = pingResults.length - points.length;

  const activePoint =
    points.find((point) => point.id === activePointId) ?? points[0];

  useEffect(() => {
    let isMounted = true;

    const initializeMap = async () => {
      try {
        const L = await loadLeaflet();
        if (!isMounted || !mapElementRef.current || mapRef.current) {
          return;
        }

        const map = L.map(mapElementRef.current, {
          zoomControl: true,
          attributionControl: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        map.fitBounds(
          [
            [TURKEY_BOUNDS.minLat, TURKEY_BOUNDS.minLon],
            [TURKEY_BOUNDS.maxLat, TURKEY_BOUNDS.maxLon],
          ],
          { padding: [20, 20] },
        );

        mapRef.current = map;
        markerLayerRef.current = L.layerGroup().addTo(map);
      } catch (error) {
        if (isMounted) {
          setLoadError(
            error instanceof Error ? error.message : "Harita yüklenemedi.",
          );
        }
      }
    };

    void initializeMap();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerLayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!window.L || !markerLayerRef.current) {
      return;
    }

    markerLayerRef.current.clearLayers();

    points.forEach((point) => {
      const isActive = activePoint?.id === point.id;
      const marker = window.L!.circleMarker([point.lat, point.lon], {
        radius: isActive ? 10 : 8,
        weight: isActive ? 3 : 2,
        color: "#ffffff",
        fillColor: isOnlineStatus(point.item.status) ? "#0b8a59" : "#c7473f",
        fillOpacity: 0.9,
      });

      marker.addTo(markerLayerRef.current);

      const popup = marker.bindPopup(createPopupHtml(point.item), {
        autoPan: true,
        keepInView: true,
      });

      marker.on("click", () => {
        setActivePointId(point.id);
        popup.openPopup();
      });

      if (isActive) {
        popup.openPopup();
      }
    });
  }, [points, activePoint]);

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
        <div ref={mapElementRef} className="leaflet-map" />

        {!activePoint ? (
          <aside className="telemetry-popup empty">
            Henüz veri yok. Uzak cihazdan POST ile veri gönderildiğinde burada
            görünecek.
          </aside>
        ) : null}
      </section>
    </main>
  );
}

export default App;
