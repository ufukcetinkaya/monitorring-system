import { useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";

type PingResultItem = {
  deviceName: string;
  deviceAddress: string;
  status: string;
  latencyMs: number | null;
  v1: number | null;
  v2: number | null;
  v3: number | null;
  i1: number | null;
  i2: number | null;
  i3: number | null;
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

type PlotlyTrace = {
  x: string[];
  y: Array<number | null>;
  name: string;
  mode: "lines";
  line?: {
    width?: number;
    color?: string;
    dash?: "solid" | "dot";
  };
  yaxis?: "y" | "y2";
  connectgaps?: boolean;
};

type PlotlyApi = {
  newPlot: (
    target: HTMLElement,
    data: PlotlyTrace[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<unknown>;
  purge: (target: HTMLElement) => void;
};

declare global {
  interface Window {
    L?: LeafletApi;
    Plotly?: PlotlyApi;
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

async function loadPlotly(): Promise<PlotlyApi> {
  if (window.Plotly) {
    return window.Plotly;
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-plotly="true"]',
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Plotly yüklenemedi.")),
        { once: true },
      );
      if (window.Plotly) {
        resolve();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.35.2.min.js";
    script.dataset.plotly = "true";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plotly yüklenemedi."));
    document.body.appendChild(script);
  });

  if (!window.Plotly) {
    throw new Error("Plotly başlatılamadı.");
  }

  return window.Plotly;
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
    v1:
      item.v1 ??
      item.voltage ??
      parseMetric(message, ["v1", "voltage", "volt", "voltaj", "v"]),
    v2: item.v2 ?? parseMetric(message, ["v2"]),
    v3: item.v3 ?? parseMetric(message, ["v3"]),
    i1:
      item.i1 ??
      item.current ??
      parseMetric(message, ["i1", "current", "akim", "amp", "a"]),
    i2: item.i2 ?? parseMetric(message, ["i2"]),
    i3: item.i3 ?? parseMetric(message, ["i3"]),
    voltage:
      item.voltage ??
      item.v1 ??
      parseMetric(message, ["voltage", "volt", "voltaj", "v"]),
    current:
      item.current ??
      item.i1 ??
      parseMetric(message, ["current", "akim", "amp", "a"]),
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
      <div style="font-size:12px;margin:3px 0;"><b>V1:</b> ${item.v1 ?? "-"} V</div>
      <div style="font-size:12px;margin:3px 0;"><b>V2:</b> ${item.v2 ?? "-"} V</div>
      <div style="font-size:12px;margin:3px 0;"><b>V3:</b> ${item.v3 ?? "-"} V</div>
      <div style="font-size:12px;margin:3px 0;"><b>I1:</b> ${item.i1 ?? "-"} A</div>
      <div style="font-size:12px;margin:3px 0;"><b>I2:</b> ${item.i2 ?? "-"} A</div>
      <div style="font-size:12px;margin:3px 0;"><b>I3:</b> ${item.i3 ?? "-"} A</div>
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

function getDeviceKey(item: Pick<PingResultItem, "deviceName">) {
  return item.deviceName;
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

function movingAverage(
  values: Array<number | null>,
  windowSize: number,
): Array<number | null> {
  if (windowSize <= 1) {
    return [...values];
  }

  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const windowValues = values.slice(start, index + 1).filter(
      (value): value is number => typeof value === "number",
    );

    if (windowValues.length === 0) {
      return null;
    }

    const sum = windowValues.reduce((acc, value) => acc + value, 0);
    return sum / windowValues.length;
  });
}

const FIXED_VOLTAGE_THRESHOLDS = {
  lower: 210,
  upper: 250,
};

const FIXED_CURRENT_THRESHOLDS = {
  lower: 0,
  upper: 20,
};

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
  const scientificChartRef = useRef<HTMLDivElement | null>(null);
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

          if (
            latestItem?.checkedAt === item.checkedAt &&
            latestItem?.deviceAddress === item.deviceAddress
          ) {
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

  const handleBackToMap = () => {
    if (typeof window === "undefined") {
      setDashboardView("map");
      return;
    }

    window.location.reload();
  };

  const selectedDeviceHistory =
    selectedDeviceKey !== null ? (deviceHistory[selectedDeviceKey] ?? []) : [];
  const sortedDeviceHistory = [...selectedDeviceHistory].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
  );
  const selectedDeviceLatest =
    sortedDeviceHistory[sortedDeviceHistory.length - 1] ?? null;
  const chartHistory = sortedDeviceHistory.slice(-20);
  const latestRows = [...chartHistory].reverse().slice(0, 8);

  useEffect(() => {
    if (
      !isAuthenticated ||
      dashboardView !== "charts" ||
      !scientificChartRef.current
    ) {
      return;
    }

    if (chartHistory.length === 0) {
      return;
    }

    let isMounted = true;

    const renderScientificChart = async () => {
      try {
        const plotly = await loadPlotly();
        if (!isMounted || !scientificChartRef.current) {
          return;
        }

        const labels = chartHistory.map((item) =>
          new Date(item.checkedAt).toLocaleString("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );

        const v1Values = chartHistory.map((item) => item.v1);
        const v2Values = chartHistory.map((item) => item.v2);
        const v3Values = chartHistory.map((item) => item.v3);
        const i1Values = chartHistory.map((item) => item.i1);
        const i2Values = chartHistory.map((item) => item.i2);
        const i3Values = chartHistory.map((item) => item.i3);

        const v1Ma = movingAverage(v1Values, 3);
        const i1Ma = movingAverage(i1Values, 3);

        const traces: PlotlyTrace[] = [
          {
            x: labels,
            y: v1Values,
            name: "V1",
            mode: "lines",
            line: { width: 2.3, color: "#0f766e" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: v2Values,
            name: "V2",
            mode: "lines",
            line: { width: 2, color: "#14b8a6", dash: "dot" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: v3Values,
            name: "V3",
            mode: "lines",
            line: { width: 2, color: "#0b8a59" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: v1Ma,
            name: "V1 MA(3)",
            mode: "lines",
            line: { width: 2.2, color: "#065f46", dash: "dot" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: labels.map(() => FIXED_VOLTAGE_THRESHOLDS.upper),
            name: "V ust esik",
            mode: "lines",
            line: { width: 1.3, color: "#b45309", dash: "dot" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: labels.map(() => FIXED_VOLTAGE_THRESHOLDS.lower),
            name: "V alt esik",
            mode: "lines",
            line: { width: 1.3, color: "#d97706", dash: "dot" },
            yaxis: "y",
            connectgaps: true,
          },
          {
            x: labels,
            y: i1Values,
            name: "I1",
            mode: "lines",
            line: { width: 2.3, color: "#2563eb" },
            yaxis: "y2",
            connectgaps: true,
          },
          {
            x: labels,
            y: i2Values,
            name: "I2",
            mode: "lines",
            line: { width: 2, color: "#60a5fa", dash: "dot" },
            yaxis: "y2",
            connectgaps: true,
          },
          {
            x: labels,
            y: i3Values,
            name: "I3",
            mode: "lines",
            line: { width: 2, color: "#1d4ed8" },
            yaxis: "y2",
            connectgaps: true,
          },
          {
            x: labels,
            y: i1Ma,
            name: "I1 MA(3)",
            mode: "lines",
            line: { width: 2.2, color: "#1e3a8a", dash: "dot" },
            yaxis: "y2",
            connectgaps: true,
          },
          {
            x: labels,
            y: labels.map(() => FIXED_CURRENT_THRESHOLDS.upper),
            name: "I ust esik",
            mode: "lines",
            line: { width: 1.3, color: "#7c3aed", dash: "dot" },
            yaxis: "y2",
            connectgaps: true,
          },
          {
            x: labels,
            y: labels.map(() => FIXED_CURRENT_THRESHOLDS.lower),
            name: "I alt esik",
            mode: "lines",
            line: { width: 1.3, color: "#6366f1", dash: "dot" },
            yaxis: "y2",
            connectgaps: true,
          },
        ];

        await plotly.newPlot(
          scientificChartRef.current,
          traces,
          {
            margin: { l: 54, r: 54, t: 30, b: 52 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(255,255,255,0.72)",
            font: { family: "Segoe UI, Tahoma, sans-serif", color: "#15363a" },
            legend: { orientation: "h", y: 1.15, x: 0 },
            xaxis: {
              title: "Zaman",
              showgrid: true,
              gridcolor: "rgba(44, 96, 102, 0.12)",
              tickangle: -20,
            },
            yaxis: {
              title: "Voltaj (V)",
              showgrid: true,
              gridcolor: "rgba(44, 96, 102, 0.15)",
            },
            yaxis2: {
              title: "Akim (A)",
              overlaying: "y",
              side: "right",
              showgrid: false,
            },
          },
          {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["select2d", "lasso2d"],
          },
        );
      } catch (error) {
        if (isMounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Bilimsel grafik oluşturulamadı.",
          );
        }
      }
    };

    void renderScientificChart();

    return () => {
      isMounted = false;
      if (window.Plotly && scientificChartRef.current) {
        window.Plotly.purge(scientificChartRef.current);
      }
    };
  }, [isAuthenticated, dashboardView, chartHistory]);

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
              onClick={handleBackToMap}
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

        <section className="scientific-panel" aria-label="Bilimsel trend grafigi">
          <h2>Bilimsel Trend Grafigi (MA(3) ve Sabit Esikler)</h2>
          <div ref={scientificChartRef} className="scientific-plot" />
        </section>

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
                  <th>V1 (V)</th>
                  <th>V2 (V)</th>
                  <th>V3 (V)</th>
                  <th>I1 (A)</th>
                  <th>I2 (A)</th>
                  <th>I3 (A)</th>
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
                    <td>{row.v1 ?? "-"}</td>
                    <td>{row.v2 ?? "-"}</td>
                    <td>{row.v3 ?? "-"}</td>
                    <td>{row.i1 ?? "-"}</td>
                    <td>{row.i2 ?? "-"}</td>
                    <td>{row.i3 ?? "-"}</td>
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
