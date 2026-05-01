// src/App.tsx

import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import cloudflareLogo from "./assets/Cloudflare_Logo.svg";
import honoLogo from "./assets/hono.svg";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState("unknown");
  const [pingResults, setPingResults] = useState<
    Array<{
      deviceName: string;
      deviceAddress: string;
      status: "up" | "down";
      latencyMs: number | null;
      checkedAt: string;
      message: string;
    }>
  >([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const fetchPingResults = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch("/api/ping-results");
      if (!response.ok) {
        throw new Error("Ping sonuçları alınamadı.");
      }

      const data = (await response.json()) as {
        items: Array<{
          deviceName: string;
          deviceAddress: string;
          status: "up" | "down";
          latencyMs: number | null;
          checkedAt: string;
          message: string;
        }>;
      };

      setPingResults(data.items ?? []);
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

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
        <a href="https://hono.dev/" target="_blank">
          <img src={honoLogo} className="logo cloudflare" alt="Hono logo" />
        </a>
        <a href="https://workers.cloudflare.com/" target="_blank">
          <img
            src={cloudflareLogo}
            className="logo cloudflare"
            alt="Cloudflare logo"
          />
        </a>
      </div>
      <h1>Vite + React + Hono + Cloudflare</h1>
      <div className="card">
        <button
          onClick={() => setCount((count: number) => count + 1)}
          aria-label="increment"
        >
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <div className="card">
        <button
          onClick={() => {
            fetch("/api/")
              .then((res) => res.json() as Promise<{ name: string }>)
              .then((data) => setName(data.name));
          }}
          aria-label="get name"
        >
          Name from API is: {name}
        </button>
        <p>
          Edit <code>worker/index.ts</code> to change the name
        </p>
      </div>
      <div className="card">
        <h2>Uzaktaki Cihaz Ping Durumu</h2>
        <button
          onClick={() => {
            void fetchPingResults();
          }}
          aria-label="refresh ping results"
          disabled={isLoading}
        >
          {isLoading ? "Yükleniyor..." : "Sonuçları Yenile"}
        </button>

        {loadError ? <p className="ping-error">Hata: {loadError}</p> : null}

        <div className="ping-result" aria-live="polite">
          {pingResults.length === 0 ? (
            <p className="ping-line">
              Henüz uzaktaki cihazdan ping sonucu gelmedi.
            </p>
          ) : (
            pingResults.map(
              (item: (typeof pingResults)[number], index: number) => (
                <p
                  key={`${item.deviceName}-${item.deviceAddress}-${item.checkedAt}-${index}`}
                  className="ping-line"
                >
                  {item.deviceName} | {item.deviceAddress} | Durum:{" "}
                  {item.status} | Gecikme: {item.latencyMs ?? "-"} ms | Mesaj:{" "}
                  {item.message} | Zaman:{" "}
                  {new Date(item.checkedAt).toLocaleString("tr-TR")}
                </p>
              ),
            )
          )}
        </div>
      </div>
      <p className="read-the-docs">Click on the logos to learn more</p>
    </>
  );
}

export default App;
