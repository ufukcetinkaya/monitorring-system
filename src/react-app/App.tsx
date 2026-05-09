import { useEffect, useRef, useState, type FormEvent } from "react";
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

type DashboardView = "map" | "charts";

type MetricKey = "voltage" | "current" | "temperature" | "latencyMs";

type LeafletMapInstance = {
  remove: () => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>,
  ) => void;
};

type LeafletMouseEvent = {
  originalEvent?: {
    preventDefault?: () => void;
  };
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
    on: (eventName: string, cb: (event?: LeafletMouseEvent) => void) => void;
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

function getDeviceKey(
  item: Pick<PingResultItem, "deviceName" | "deviceAddress">,
) {
  return `${item.deviceName}::${item.deviceAddress}`;
}

function formatMetricValue(value: number | null, unit: string): string {
  if (typeof value !== "number") {
    return "-";
  }

  return `${value.toFixed(2)} ${unit}`;
}

function buildChartPoints(
  values: Array<number | null>,
  width: number,
  height: number,
  padding: number,
): string {
  const validValues = values.filter(
    (value): value is number => typeof value === "number",
  );

  if (validValues.length < 2) {
    return "";
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const domain = max - min || 1;
  const step =
    values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      if (typeof value !== "number") {
        return null;
      }

      const x = padding + index * step;
      const normalizedY = (value - min) / domain;
      const y = height - padding - normalizedY * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");
}

function createMetricTitle(key: MetricKey): string {
  if (key === "voltage") {
    return "Voltaj";
  }

  if (key === "current") {
    return "Akim";
  }

  if (key === "temperature") {
    return "Sicaklik";
  }

  return "Gecikme";
}

function createMetricUnit(key: MetricKey): string {
  if (key === "voltage") {
    return "V";
  }

  if (key === "current") {
    return "A";
  }

  if (key === "temperature") {
    return "C";
  }

  return "ms";
}

function createMetricColor(key: MetricKey): string {
  if (key === "voltage") {
    return "#1f8a70";
  }

  if (key === "current") {
    return "#1976d2";
  }

  if (key === "temperature") {
    return "#d97706";
  }

  return "#a21caf";
}

function createMetricValues(
  history: PingResultItem[],
  key: MetricKey,
): Array<number | null> {
  return history.map((item) => item[key]);
}

function formatTimeTick(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createTickIndexes(length: number): number[] {
  if (length <= 1) {
    return [0];
  }

  const indexes = [0, Math.floor((length - 1) / 2), length - 1];
  return Array.from(new Set(indexes));
}

function MetricChartCard({
  title,
  unit,
  color,
  values,
  labels,
}: {
  title: string;
  unit: string;
  color: string;
  values: Array<number | null>;
  labels: string[];
}) {
  const width = 420;
  const height = 190;
  const padding = 24;
  const chartPoints = buildChartPoints(values, width, height, padding);
  const tickIndexes = createTickIndexes(labels.length);
  const step =
    labels.length > 1 ? (width - padding * 2) / (labels.length - 1) : 0;
  const latestValue =
    [...values]
      .reverse()
      .find((value): value is number => typeof value === "number") ?? null;

  return (
    <article className="metric-card">
      <header>
        <h3>{title}</h3>
        <p>{formatMetricValue(latestValue, unit)}</p>
      </header>

      {chartPoints ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title} zaman grafigi`}
        >
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            className="chart-axis"
          />
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={height - padding}
            className="chart-axis"
          />
          <polyline
            points={chartPoints}
            stroke={color}
            className="chart-line"
          />
          {tickIndexes.map((index) => (
            <text
              key={`${title}-${index}`}
              x={padding + index * step}
              y={height - 6}
              textAnchor="middle"
              className="chart-tick"
            >
              {formatTimeTick(labels[index] ?? "")}
            </text>
          ))}
        </svg>
      ) : (
        <p className="chart-empty">Grafik icin yeterli veri yok.</p>
      )}
    </article>
  );
}

const AUTH_SESSION_KEY = "monitoring_auth_session";

function getStoredAuthSession(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(AUTH_SESSION_KEY) === "1";
}

function setStoredAuthSession(isAuthenticated: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  if (isAuthenticated) {
    window.sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    return;
  }

  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(getStoredAuthSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [pingResults, setPingResults] = useState<PingResultItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [dashboardView, setDashboardView] = useState<DashboardView>("map");
  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string | null>(
    null,
  );
  const [deviceHistory, setDeviceHistory] = useState<
    Record<string, PingResultItem[]>
  >({});
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const markerLayerRef = useRef<{ clearLayers: () => void } | null>(null);
  const isRefreshingMarkersRef = useRef(false);

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

  useEffect(() => {
    setStoredAuthSession(isAuthenticated);
  }, [isAuthenticated]);

  const fetchPingResults = async () => {
    setLoadError("");

    try {
      const response = await fetch(publicIngestUrl);
      if (!response.ok) {
        throw new Error("Ping sonuçları alınamadı.");
      }

      const data = (await response.json()) as { items: PingResultItem[] };
      const normalizedItems = (data.items ?? []).map(withDerivedTelemetry);

      setPingResults(normalizedItems);
      setDeviceHistory((previousHistory) => {
        const nextHistory = { ...previousHistory };

        normalizedItems.forEach((item) => {
          const key = getDeviceKey(item);
          const series = nextHistory[key] ?? [];
          const latestItem = series[series.length - 1];

          if (latestItem?.checkedAt === item.checkedAt) {
            return;
          }

          nextHistory[key] = [...series, item].slice(-80);
        });

        return nextHistory;
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Sonuçlar alınırken hata oluştu.";
      setLoadError(message);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || dashboardView !== "map") {
      return;
    }

    void fetchPingResults();
    const timer = setInterval(() => {
      void fetchPingResults();
    }, 5000);

    return () => clearInterval(timer);
  }, [isAuthenticated, dashboardView]);

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
    points.find((point) => point.id === activePointId) ?? null;

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

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
  }, [isAuthenticated]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      dashboardView !== "map" ||
      !window.L ||
      !markerLayerRef.current
    ) {
      return;
    }

    isRefreshingMarkersRef.current = true;
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

      marker.on("contextmenu", (event) => {
        event?.originalEvent?.preventDefault?.();
        setSelectedDeviceKey(getDeviceKey(point.item));
        setDashboardView("charts");
      });

      marker.on("popupclose", () => {
        if (isRefreshingMarkersRef.current) {
          return;
        }
        setActivePointId(null);
      });

      if (isActive) {
        popup.openPopup();
      }
    });

    isRefreshingMarkersRef.current = false;
  }, [isAuthenticated, dashboardView, points, activePoint]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedUsername = username.trim();
    const normalizedPassword = password.trim();

    if (!normalizedUsername || !normalizedPassword) {
      setAuthError("Lutfen kullanici adi ve sifre giriniz.");
      return;
    }

    setAuthError("");
    setIsAuthenticating(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_name: normalizedUsername,
          password: normalizedPassword,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setAuthError(data.error ?? "Giris yapilamadi.");
        return;
      }

      setIsAuthenticated(true);
      setPassword("");
    } catch {
      setAuthError("Sunucuya ulasilamadi. Lutfen tekrar deneyiniz.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUsername("");
    setPassword("");
    setAuthError("");
    setPingResults([]);
    setLoadError("");
    setActivePointId(null);
    setDashboardView("map");
    setSelectedDeviceKey(null);
    setDeviceHistory({});
  };

  const selectedDeviceHistory =
    selectedDeviceKey !== null ? (deviceHistory[selectedDeviceKey] ?? []) : [];
  const selectedDeviceLatest =
    selectedDeviceHistory[selectedDeviceHistory.length - 1] ?? null;
  const chartHistory = selectedDeviceHistory.slice(-20);
  const latestRows = [...chartHistory].reverse().slice(0, 8);

  const metrics: MetricKey[] = [
    "voltage",
    "current",
    "temperature",
    "latencyMs",
  ];

  if (dashboardView === "charts" && selectedDeviceLatest) {
    return (
      <main className="dashboard charts-dashboard">
        <header className="hero charts-hero">
          <div className="charts-top-actions">
            <button
              onClick={() => setDashboardView("map")}
              aria-label="haritaya don"
              className="hero-back"
            >
              Haritaya Don
            </button>
            <button
              onClick={handleLogout}
              aria-label="logout from device monitor"
              className="hero-logout"
            >
              Cikis Yap
            </button>
          </div>

          <p className="hero-kicker">Device Trend Dashboard</p>
          <h1>{selectedDeviceLatest.deviceName} Grafikleri</h1>
          <p className="hero-subtitle">
            {selectedDeviceLatest.deviceAddress} cihazinin son{" "}
            {chartHistory.length} olcumunden uretilen trend grafigi.
          </p>
          <div className="hero-actions">
            <span className="ingest-url">
              Son guncelleme:{" "}
              {new Date(selectedDeviceLatest.checkedAt).toLocaleString("tr-TR")}
            </span>
          </div>
        </header>

        <section className="charts-grid" aria-label="Cihaz metrik grafikleri">
          {metrics.map((metric) => (
            <MetricChartCard
              key={metric}
              title={createMetricTitle(metric)}
              unit={createMetricUnit(metric)}
              color={createMetricColor(metric)}
              values={createMetricValues(chartHistory, metric)}
              labels={chartHistory.map((item) => item.checkedAt)}
            />
          ))}
        </section>

        <section
          className="recent-table-panel"
          aria-label="Son olcumler tablosu"
        >
          <h2>Son Olcumler</h2>
          <div className="recent-table-wrap">
            <table className="recent-table">
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Voltaj (V)</th>
                  <th>Akim (A)</th>
                  <th>Sicaklik (C)</th>
                  <th>Gecikme (ms)</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {latestRows.map((row) => (
                  <tr key={`${row.deviceAddress}-${row.checkedAt}`}>
                    <td>{new Date(row.checkedAt).toLocaleString("tr-TR")}</td>
                    <td>{row.voltage ?? "-"}</td>
                    <td>{row.current ?? "-"}</td>
                    <td>{row.temperature ?? "-"}</td>
                    <td>{row.latencyMs ?? "-"}</td>
                    <td>{isOnlineStatus(row.status) ? "Aktif" : "Pasif"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-screen" aria-label="Kullanici giris sayfasi">
        <section className="auth-card">
          <p className="auth-kicker">Device Control Portal</p>
          <h1>Cihaz İzleme Girişi</h1>
          <p className="auth-subtitle">
            Kullanıcı adı ve şifrenizle giriş yaparak cihaz izleme paneline
            ulaşın.
          </p>

          <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="username">Kullanıcı Adı</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="kullanıcı adı"
            />

            <label htmlFor="password">Şifre</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="şifre"
            />

            {authError ? <p className="auth-error">{authError}</p> : null}

            <button type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Doğrulanıyor..." : "Giriş Yap"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="hero">
        <button
          onClick={handleLogout}
          aria-label="logout from device monitor"
          className="hero-logout"
        >
          Çıkış Yap
        </button>
        <p className="hero-kicker">Rectifier Telemetry Grid</p>
        <h1>Türkiye Geneli Uzak Cihaz İzleme</h1>
        <p className="hero-subtitle">
          Uzak cihazdan gelen voltaj, akım ve sıcaklık verileri harita üzerinde
          canlı popup ile izlenir.
        </p>
        <div className="hero-actions">
          <span className="ingest-url">
            Noktaya sag tik: ilgili cihazin grafik sayfasini acar.
          </span>
          {devicesWithoutCoordinates > 0 ? (
            <span className="ingest-url">
              Koordinat eksik cihaz: {devicesWithoutCoordinates}
            </span>
          ) : null}
        </div>
        {loadError ? <p className="ping-error">Hata: {loadError}</p> : null}
      </header>

      <section className="map-panel" aria-label="Türkiye cihaz haritası">
        <div ref={mapElementRef} className="leaflet-map" />

        {points.length === 0 ? (
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
