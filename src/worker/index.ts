import { Hono } from "hono";
type WorkerBindings = Env & {
  RECTIFIER_DB: D1Database;
  API_INGEST_TOKEN?: string;
};

const app = new Hono<{ Bindings: WorkerBindings }>();

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

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function mapDeviceDataRow(row: Record<string, unknown>): PingResultItem {
  const status = row.status === "up" ? "up" : "down";

  return {
    deviceName: String(row.device_name ?? row.deviceName ?? "Bilinmeyen Cihaz"),
    deviceAddress: String(
      row.device_address ?? row.deviceAddress ?? "Bilinmeyen Adres",
    ),
    status,
    latencyMs: toNumberOrNull(row.latency_ms ?? row.latencyMs),
    voltage: toNumberOrNull(row.voltage),
    current: toNumberOrNull(row.current),
    temperature: toNumberOrNull(row.temperature),
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    checkedAt: String(
      row.checked_at ?? row.checkedAt ?? new Date().toISOString(),
    ),
    message: String(row.message ?? ""),
  };
}

function getProvidedToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

function requireIngestToken(c: {
  req: { header: (name: string) => string | undefined };
  env: WorkerBindings;
}) {
  const expectedToken = c.env.API_INGEST_TOKEN?.trim();

  if (!expectedToken) {
    return new Response(
      JSON.stringify({ error: "Sunucu token ayarı eksik." }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const bearerToken = getProvidedToken(c.req.header("authorization"));
  const apiTokenHeader = c.req.header("x-api-token")?.trim();
  const providedToken = bearerToken ?? apiTokenHeader;

  if (!providedToken || providedToken !== expectedToken) {
    return new Response(JSON.stringify({ error: "Yetkisiz istek." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return null;
}

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

app.get("/api/ping-results", async (c) => {
  try {
    const snakeCaseResult = await c.env.RECTIFIER_DB.prepare(
      `SELECT
        device_name,
        device_address,
        status,
        latency_ms,
        voltage,
        current,
        temperature,
        latitude,
        longitude,
        checked_at,
        message
      FROM device_datas
      ORDER BY checked_at DESC
      LIMIT 200`,
    ).all();

    return c.json({
      items: (snakeCaseResult.results ?? []).map(mapDeviceDataRow),
    });
  } catch {
    try {
      const camelCaseResult = await c.env.RECTIFIER_DB.prepare(
        `SELECT
          deviceName,
          deviceAddress,
          status,
          latencyMs,
          voltage,
          current,
          temperature,
          latitude,
          longitude,
          checkedAt,
          message
        FROM device_datas
        ORDER BY checkedAt DESC
        LIMIT 200`,
      ).all();

      return c.json({
        items: (camelCaseResult.results ?? []).map(mapDeviceDataRow),
      });
    } catch {
      return c.json({ error: "device_datas tablosundan veri okunamadı." }, 500);
    }
  }
});

app.post("/api/messages", async (c) => {
  const unauthorizedResponse = requireIngestToken(c);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const body = (await c.req.json().catch(() => null)) as {
    content?: string;
    sender?: string;
  } | null;

  if (!body) {
    return c.json({ error: "Geçersiz JSON payload." }, 400);
  }

  const content = body.content?.trim();
  const sender = body.sender?.trim();

  if (!content || !sender) {
    return c.json({ error: "content ve sender zorunludur." }, 400);
  }

  try {
    const result = await c.env.RECTIFIER_DB.prepare(
      "INSERT INTO messages (content, sender) VALUES (?, ?)",
    )
      .bind(content, sender)
      .run();

    return c.json(
      {
        ok: true,
        id: result.meta.last_row_id,
        stored: { content, sender },
      },
      201,
    );
  } catch {
    return c.json({ error: "Mesaj veritabanına yazılamadı." }, 500);
  }
});

app.post("/api/ping-results", async (c) => {
  const unauthorizedResponse = requireIngestToken(c);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const body = (await c.req.json().catch(() => null)) as {
    deviceName?: string;
    deviceAddress?: string;
    status?: "up" | "down";
    latencyMs?: number | null;
    voltage?: number | null;
    current?: number | null;
    temperature?: number | null;
    latitude?: number | null;
    longitude?: number | null;
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
    voltage: typeof body.voltage === "number" ? body.voltage : null,
    current: typeof body.current === "number" ? body.current : null,
    temperature: typeof body.temperature === "number" ? body.temperature : null,
    latitude: typeof body.latitude === "number" ? body.latitude : null,
    longitude: typeof body.longitude === "number" ? body.longitude : null,
    checkedAt: body.checkedAt ?? new Date().toISOString(),
    message:
      body.message?.trim() ||
      (status === "up" ? "Erişilebilir" : "Erişilemiyor"),
  };

  try {
    await c.env.RECTIFIER_DB.prepare(
      `INSERT INTO device_datas (
        device_name,
        device_address,
        status,
        latency_ms,
        voltage,
        current,
        temperature,
        latitude,
        longitude,
        checked_at,
        message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        item.deviceName,
        item.deviceAddress,
        item.status,
        item.latencyMs,
        item.voltage,
        item.current,
        item.temperature,
        item.latitude,
        item.longitude,
        item.checkedAt,
        item.message,
      )
      .run();
  } catch {
    try {
      await c.env.RECTIFIER_DB.prepare(
        `INSERT INTO device_datas (
          deviceName,
          deviceAddress,
          status,
          latencyMs,
          voltage,
          current,
          temperature,
          latitude,
          longitude,
          checkedAt,
          message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          item.deviceName,
          item.deviceAddress,
          item.status,
          item.latencyMs,
          item.voltage,
          item.current,
          item.temperature,
          item.latitude,
          item.longitude,
          item.checkedAt,
          item.message,
        )
        .run();
    } catch {
      return c.json({ error: "device_datas tablosuna veri yazılamadı." }, 500);
    }
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
