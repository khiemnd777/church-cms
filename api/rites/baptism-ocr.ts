import { resolve } from "node:path";
import { Binary, type ClientSession, ObjectId } from "mongodb";
import { z } from "zod";
import { AppError, requireCondition } from "../errors";
import { objectId, parse } from "../http-validation";
import type { Database } from "../infrastructure/database";
import { businessDay } from "../members/dates";
import { daySchema, idSchema } from "../members/validation";
import type { RiteGrant } from "./models";
import type { Rites } from "./service";
import { personInput, type RiteCommand } from "./validation";

export const baptismImageLimit = 5 * 1024 * 1024;
const cell = z.strictObject({
  text: z.string().trim().normalize("NFC").max(200),
  score: z.number().min(0).max(1),
});
const row = z.tuple([cell, cell, cell, cell]);
const workerReply = z.strictObject({
  status: z.enum(["ok", "layout"]),
  rows: z.array(row).max(20),
  elapsed: z.number().nonnegative(),
});
type ScanRows = z.infer<typeof workerReply>["rows"];
export type BaptismOcrRunner = (bytes: Uint8Array) => Promise<unknown>;

export function localBaptismRunner(): BaptismOcrRunner | undefined {
  const python = process.env.CHURCH_P74_PYTHON;
  const models = process.env.CHURCH_P74_MODELS;
  if (process.platform !== "darwin" || !python || !models) return;
  const worker = resolve("tools/baptism-ocr/worker.py");
  const family = process.env.CHURCH_P74_MODEL_FAMILY || "v6";
  if (family !== "v5" && family !== "v6" && family !== "vi") return;
  return async (bytes) => {
    const task = Bun.spawn(
      [
        "/usr/bin/sandbox-exec",
        "-p",
        "(version 1) (allow default) (deny network*)",
        resolve(python),
        worker,
        resolve(models),
        "--family",
        family,
      ],
      {
        stdin: new Blob([new Uint8Array(bytes)]),
        stdout: "pipe",
        stderr: "ignore",
        env: {
          PATH: "/usr/bin:/bin",
          PYTHONDONTWRITEBYTECODE: "1",
          OMP_NUM_THREADS: "2",
          PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
        },
      },
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      task.kill(9);
    }, 30_000);
    try {
      const reader = task.stdout.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireCondition(size <= 128 * 1024, 503, "BAPTISM_OCR_UNAVAILABLE");
        chunks.push(value);
      }
      const code = await task.exited;
      requireCondition(!timedOut, 503, "BAPTISM_OCR_TIMEOUT");
      requireCondition(code === 0, 503, "BAPTISM_OCR_UNAVAILABLE");
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new AppError(503, "BAPTISM_OCR_UNAVAILABLE");
      }
    } finally {
      clearTimeout(timeout);
      if (task.exitCode === null) task.kill(9);
      await task.exited;
    }
  };
}

interface ImportSession {
  _id: ObjectId;
  churchId: ObjectId;
  actorId: ObjectId;
  image: Binary;
  type: "image/jpeg" | "image/png";
  rows: ScanRows;
  recorded: Record<string, string>;
  expiresAt: Date;
}
const input = z.strictObject({
  memberId: idSchema,
  date: daySchema.nullable(),
  place: z.string().trim().normalize("NFC").min(1).max(200).nullable(),
  officiant: personInput.nullable(),
  preview: z.string().max(100).nullable(),
});

function proposedDate(raw: string) {
  const numeric = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const written = raw.trim().match(/^(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})$/iu);
  const parts = numeric ?? written;
  if (!parts) return null;
  const iso = `${parts[3]}-${parts[2]?.padStart(2, "0")}-${parts[1]?.padStart(2, "0")}`;
  return daySchema.safeParse(iso).success ? iso : null;
}

export class BaptismOcr {
  private active = false;
  constructor(
    private db: Database,
    private rites: Rites,
    private run: BaptismOcrRunner | undefined,
    private now: () => Date,
  ) {}
  get enabled() {
    return !!this.run;
  }
  private get sessions() {
    return this.db.db.collection<ImportSession>("rite_baptism_ocr");
  }
  private filter(g: RiteGrant, id: string) {
    return {
      _id: objectId(id),
      churchId: g.churchId,
      actorId: g.actorId,
      expiresAt: { $gt: this.now() },
    };
  }
  private async session(g: RiteGrant, id: string, tx: ClientSession, image = false) {
    const d = await this.sessions.findOne(this.filter(g, id), {
      session: tx,
      ...(image ? {} : { projection: { image: 0 } }),
    });
    requireCondition(d, 404, "BAPTISM_OCR_EXPIRED");
    return d;
  }
  private dto(d: ImportSession) {
    return {
      id: d._id.toHexString(),
      expiresAt: d.expiresAt.toISOString(),
      rows: d.rows.map((cells, i) => ({
        index: i,
        cells,
        date: cells[1].score >= 0.85 ? proposedDate(cells[1].text) : null,
        recordedId: d.recorded[String(i)] ?? null,
      })),
    };
  }
  async scan(g: RiteGrant, type: ImportSession["type"], read: () => Promise<Uint8Array>) {
    const runner = this.run;
    requireCondition(runner, 503, "BAPTISM_OCR_UNAVAILABLE");
    requireCondition(!this.active, 409, "BAPTISM_OCR_BUSY");
    this.active = true;
    try {
      const bytes = await read();
      const { default: sharp } = await import("sharp");
      let normalized: Buffer;
      try {
        const image = sharp(bytes, {
          limitInputPixels: 20_000_000,
          failOn: "warning",
        }).autoOrient();
        const metadata = await image.metadata();
        requireCondition(
          metadata.format === (type === "image/png" ? "png" : "jpeg") &&
            (metadata.pages ?? 1) === 1,
          422,
          "BAPTISM_OCR_IMAGE",
        );
        normalized = await (type === "image/png" ? image.png() : image.jpeg()).toBuffer();
      } catch {
        throw new AppError(422, "BAPTISM_OCR_IMAGE");
      }
      requireCondition(normalized.byteLength <= baptismImageLimit, 413, "FILE_LIMIT");
      const result = workerReply.safeParse(await runner(normalized));
      requireCondition(result.success, 503, "BAPTISM_OCR_UNAVAILABLE");
      requireCondition(
        result.data.status === "ok" && result.data.rows.length > 0,
        422,
        "BAPTISM_OCR_LAYOUT",
      );
      return await this.db.transaction(async (tx) => {
        await g.fence(tx);
        const d: ImportSession = {
          _id: new ObjectId(),
          churchId: g.churchId,
          actorId: g.actorId,
          image: new Binary(normalized),
          type,
          rows: result.data.rows,
          recorded: {},
          expiresAt: new Date(this.now().getTime() + 24 * 60 * 60 * 1000),
        };
        await this.sessions.insertOne(d, { session: tx });
        return this.dto(d);
      });
    } finally {
      this.active = false;
    }
  }
  async image(g: RiteGrant, id: string) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.session(g, id, tx, true);
      return { bytes: new Uint8Array(d.image.value()), type: d.type };
    });
  }
  private command(raw: unknown): RiteCommand {
    const b = parse(input, raw);
    requireCondition(!b.date || b.date <= businessDay(this.now()), 422, "RITE_FUTURE_HISTORY");
    return {
      state: "recorded",
      reason: "Đối soát từ ảnh sổ Báp-têm",
      record: {
        historical: true,
        date: b.date,
        note: null,
        payload: {
          kind: "baptism",
          person: { source: "member", memberId: b.memberId },
          officiant: b.officiant,
          place: b.place,
        },
      },
      baptismAfter: { status: "baptized", date: b.date, place: b.place },
      preview: b.preview,
    };
  }
  private async readRow(g: RiteGrant, id: string, index: number) {
    return this.db.readSnapshot(g.churchId.toHexString(), async (tx) => {
      await g.fence(tx);
      const d = await this.session(g, id, tx);
      requireCondition(d.rows[index], 404, "NOT_FOUND");
      return d.recorded[String(index)] ?? null;
    });
  }
  async preview(g: RiteGrant, id: string, index: number, raw: unknown) {
    const body = this.command(raw);
    const payload = body.record.payload;
    requireCondition(payload.kind === "baptism", 422, "INVALID_REQUEST");
    const already = await this.readRow(g, id, index);
    const existing = already ?? (await this.rites.recordedBaptism(g, payload.person.memberId));
    if (existing) return { existing, preview: null };
    return { existing: null, preview: await this.rites.preview(g, null, body, null) };
  }
  async record(
    g: RiteGrant,
    id: string,
    index: number,
    raw: unknown,
    key: string | null,
    requestId: string,
  ) {
    const body = this.command(raw);
    const guard: RiteGrant = {
      ...g,
      fence: async (tx) => {
        await g.fence(tx);
        const d = await this.session(g, id, tx);
        requireCondition(d.rows[index], 404, "NOT_FOUND");
      },
    };
    return this.rites.save(
      guard,
      null,
      body,
      key,
      null,
      requestId,
      async (tx, riteId) => {
        const path = `recorded.${index}`;
        const linked = await this.sessions.updateOne(
          { ...this.filter(g, id), [path]: { $exists: false } },
          { $set: { [path]: riteId.toHexString() } },
          { session: tx },
        );
        requireCondition(linked.matchedCount === 1, 409, "BAPTISM_OCR_ROW_RECORDED");
      },
      `/baptism-ocr/${id}/${index}`,
    );
  }
}
