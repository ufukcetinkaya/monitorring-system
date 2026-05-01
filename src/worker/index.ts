import { Hono } from "hono";
const app = new Hono<{ Bindings: Env }>();

type PingResultItem = {
  deviceName: string;
  deviceAddress: string;
  status: "up" | "down";
  latencyMs: number | null;
  checkedAt: string;
  message: string;
};

const pingResults: PingResultItem[] = [];
const MAX_PING_RESULTS = 100;

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

app.get("/api/ping-results", (c) => {
  return c.json({ items: pingResults });
});

app.post("/api/ping-results", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    deviceName?: string;
    deviceAddress?: string;
    status?: "up" | "down";
    latencyMs?: number | null;
    checkedAt?: string;
    message?: string;
  } | null;

  if (!body) {
    return c.json({ error: "Geçersiz JSON payload." }, 400);
  }

  const deviceName = body.deviceName?.trim();
  const deviceAddress = body.deviceAddress?.trim();
  const status = body.status;

  if (!deviceName || !deviceAddress) {
    return c.json({ error: "deviceName ve deviceAddress zorunludur." }, 400);
  }

  if (status !== "up" && status !== "down") {
    return c.json({ error: 'status alanı "up" veya "down" olmalıdır.' }, 400);
  }

  const item: PingResultItem = {
    deviceName,
    deviceAddress,
    status,
    latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : null,
    checkedAt: body.checkedAt ?? new Date().toISOString(),
    message:
      body.message?.trim() ||
      (status === "up" ? "Erişilebilir" : "Erişilemiyor"),
  };

  pingResults.unshift(item);
  if (pingResults.length > MAX_PING_RESULTS) {
    pingResults.length = MAX_PING_RESULTS;
  }

  return c.json({ ok: true, stored: item }, 201);
});

app.post("/api/ping", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    command?: string;
    deviceName?: string;
    deviceAddress?: string;
    targetUrl?: string;
  } | null;

  if (!body || body.command !== "ping") {
    return c.json(
      {
        error: 'Geçersiz komut. Beklenen payload: { "command": "ping" }',
      },
      400,
    );
  }

  const deviceName = body.deviceName?.trim() || "Uzak Cihaz";
  const deviceAddress =
    body.deviceAddress?.trim() ||
    body.targetUrl?.trim() ||
    "1.1.1.1/cdn-cgi/trace";

  const normalizedAddress = /^https?:\/\//i.test(deviceAddress)
    ? deviceAddress
    : `http://${deviceAddress}`;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedAddress);
  } catch {
    return c.json({ error: "Geçersiz cihaz adresi formatı." }, 400);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return c.json(
      { error: "targetUrl yalnızca http veya https olabilir." },
      400,
    );
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "HEAD",
      cf: { cacheTtl: 0 },
    });

    if (!response.ok) {
      return c.json({ error: "Ping hedefinden geçerli yanıt alınamadı." }, 502);
    }

    const latencyMs = Date.now() - startedAt;

    return c.json({
      ok: true,
      result: "PONG",
      deviceName,
      deviceAddress,
      targetUrl: parsedUrl.toString(),
      statusCode: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return c.json({ error: "Ping sırasında ağ hatası oluştu." }, 502);
  }
});

export default app;
