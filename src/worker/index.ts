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
    v1: toNumberOrNull(row.v1 ?? row.V1),
    v2: toNumberOrNull(row.v2 ?? row.V2),
    v3: toNumberOrNull(row.v3 ?? row.V3),
    i1: toNumberOrNull(row.i1 ?? row.I1),
    i2: toNumberOrNull(row.i2 ?? row.I2),
    i3: toNumberOrNull(row.i3 ?? row.I3),
    voltage: toNumberOrNull(row.voltage ?? row.v1 ?? row.V1),
    current: toNumberOrNull(row.current ?? row.i1 ?? row.I1),
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

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

app.post("/api/login", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    userName?: string;
    user_name?: string;
    password?: string;
    passwd?: string;
  } | null;

  if (!body) {
    return c.json({ error: "Gecersiz JSON payload." }, 400);
  }

  const userName = (body.userName ?? body.user_name ?? "").trim();
  const password = (body.password ?? body.passwd ?? "").trim();

  if (!userName || !password) {
    return c.json({ error: "user_name ve password zorunludur." }, 400);
  }

  const hashedPassword = await sha256Hex(password);

  try {
    const schemaQuery = await c.env.RECTIFIER_DB.prepare(
      `SELECT user_name
       FROM rectifier_db.user_list
       WHERE user_name = ?
         AND lower(passwd) = lower(?)
       LIMIT 1`,
    )
      .bind(userName, hashedPassword)
      .first<{ user_name: string }>();

    if (schemaQuery?.user_name) {
      return c.json({ ok: true, userName: schemaQuery.user_name });
    }
  } catch {
    // Schema-qualified query may fail depending on D1 setup.
  }

  try {
    const fallbackQuery = await c.env.RECTIFIER_DB.prepare(
      `SELECT user_name
       FROM user_list
       WHERE user_name = ?
         AND lower(passwd) = lower(?)
       LIMIT 1`,
    )
      .bind(userName, hashedPassword)
      .first<{ user_name: string }>();

    if (!fallbackQuery?.user_name) {
      return c.json({ error: "Kullanici adi veya sifre hatali." }, 401);
    }

    return c.json({ ok: true, userName: fallbackQuery.user_name });
  } catch {
    return c.json({ error: "Kullanici dogrulamasi yapilamadi." }, 500);
  }
});

app.get("/api/ping-results", async (c) => {
  try {
    const snakeCaseResult = await c.env.RECTIFIER_DB.prepare(
      `SELECT
        device_name,
        device_address,
        status,
        latency_ms,
        v1,
        v2,
        v3,
        i1,
        i2,
        i3,
        v1 AS voltage,
        i1 AS current,
        temperature,
        latitude,
        longitude,
        checked_at,
        message
      FROM rectifier_db.device_logs
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
          V1 AS v1,
          V2 AS v2,
          V3 AS v3,
          I1 AS i1,
          I2 AS i2,
          I3 AS i3,
          V1 AS voltage,
          I1 AS current,
          temperature,
          latitude,
          longitude,
          checkedAt,
          message
        FROM device_logs
        ORDER BY checkedAt DESC
        LIMIT 200`,
      ).all();

      return c.json({
        items: (camelCaseResult.results ?? []).map(mapDeviceDataRow),
      });
    } catch {
      try {
        const schemaCamelCaseResult = await c.env.RECTIFIER_DB.prepare(
          `SELECT
            deviceName,
            deviceAddress,
            status,
            latencyMs,
            V1 AS v1,
            V2 AS v2,
            V3 AS v3,
            I1 AS i1,
            I2 AS i2,
            I3 AS i3,
            V1 AS voltage,
            I1 AS current,
            temperature,
            latitude,
            longitude,
            checkedAt,
            message
          FROM rectifier_db.device_logs
          ORDER BY checkedAt DESC
          LIMIT 200`,
        ).all();

        return c.json({
          items: (schemaCamelCaseResult.results ?? []).map(mapDeviceDataRow),
        });
      } catch {
        return c.json(
          { error: "device_logs tablosundan veri okunamadı." },
          500,
        );
      }
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
    latencyMs?: number | string | null;
    V1?: number | string | null;
    V2?: number | string | null;
    V3?: number | string | null;
    I1?: number | string | null;
    I2?: number | string | null;
    I3?: number | string | null;
    voltage?: number | string | null;
    current?: number | string | null;
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

  const item = {
    deviceName,
    deviceAddress,
    status,
    latencyMs: toNumberOrNull(body.latencyMs),
    V1: toNumberOrNull(body.V1 ?? body.voltage),
    V2: toNumberOrNull(body.V2),
    V3: toNumberOrNull(body.V3),
    I1: toNumberOrNull(body.I1 ?? body.current),
    I2: toNumberOrNull(body.I2),
    I3: toNumberOrNull(body.I3),
    temperature: toNumberOrNull(body.temperature),
    latitude: toNumberOrNull(body.latitude),
    longitude: toNumberOrNull(body.longitude),
    checkedAt: body.checkedAt ?? new Date().toISOString(),
    message:
      body.message?.trim() ||
      (status === "up" ? "Erişilebilir" : "Erişilemiyor"),
  };

  try {
    await c.env.RECTIFIER_DB.prepare(
      `INSERT INTO rectifier_db.device_logs (
        deviceName,
        deviceAddress,
        status,
        latencyMs,
        V1,
        V2,
        V3,
        I1,
        I2,
        I3,
        temperature,
        latitude,
        longitude,
        message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        item.deviceName,
        item.deviceAddress,
        item.status,
        item.latencyMs,
        item.V1,
        item.V2,
        item.V3,
        item.I1,
        item.I2,
        item.I3,
        item.temperature,
        item.latitude,
        item.longitude,
        item.message,
      )
      .run();
  } catch {
    try {
      await c.env.RECTIFIER_DB.prepare(
        `INSERT INTO device_logs (
          deviceName,
          deviceAddress,
          status,
          latencyMs,
          V1,
          V2,
          V3,
          I1,
          I2,
          I3,
          temperature,
          latitude,
          longitude,
          message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          item.deviceName,
          item.deviceAddress,
          item.status,
          item.latencyMs,
          item.V1,
          item.V2,
          item.V3,
          item.I1,
          item.I2,
          item.I3,
          item.temperature,
          item.latitude,
          item.longitude,
          item.message,
        )
        .run();
    } catch {
      try {
        await c.env.RECTIFIER_DB.prepare(
          `INSERT INTO rectifier_db.device_logs (
            device_name,
            device_address,
            status,
            latency_ms,
            v1,
            v2,
            v3,
            i1,
            i2,
            i3,
            temperature,
            latitude,
            longitude,
            message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            item.deviceName,
            item.deviceAddress,
            item.status,
            item.latencyMs,
            item.V1,
            item.V2,
            item.V3,
            item.I1,
            item.I2,
            item.I3,
            item.temperature,
            item.latitude,
            item.longitude,
            item.message,
          )
          .run();
      } catch {
        return c.json(
          { error: "rectifier_db.device_logs tablosuna veri yazılamadı." },
          500,
        );
      }
    }
  }

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
        item.V1,
        item.I1,
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
          item.V1,
          item.I1,
          item.temperature,
          item.latitude,
          item.longitude,
          item.checkedAt,
          item.message,
        )
        .run();
    } catch {}
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
