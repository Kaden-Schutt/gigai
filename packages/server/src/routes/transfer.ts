import type { FastifyInstance } from "fastify";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import { GigaiError, ErrorCode } from "@gigai/shared";

interface TransferEntry {
  id: string;
  path: string;
  filename: string;
  mimeType: string;
  expiresAt: number;
}

const transfers = new Map<string, TransferEntry>();
const TRANSFER_DIR = join(tmpdir(), "kon-transfers");
const TRANSFER_TTL = 60 * 60 * 1000; // 1 hour

// Cleanup expired transfers
setInterval(async () => {
  const now = Date.now();
  for (const [id, entry] of transfers) {
    if (entry.expiresAt < now) {
      transfers.delete(id);
      try { await unlink(entry.path); } catch {}
    }
  }
}, 60_000);

export async function transferRoutes(server: FastifyInstance) {
  await mkdir(TRANSFER_DIR, { recursive: true });

  server.post("/transfer/upload", async (request) => {
    const data = await request.file();
    if (!data) {
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, "No file uploaded");
    }

    const id = nanoid(16);
    const buffer = await data.toBuffer();
    const filePath = join(TRANSFER_DIR, id);

    await writeFile(filePath, buffer);

    const entry: TransferEntry = {
      id,
      path: filePath,
      filename: data.filename,
      mimeType: data.mimetype,
      expiresAt: Date.now() + TRANSFER_TTL,
    };
    transfers.set(id, entry);

    return {
      id,
      expiresAt: entry.expiresAt,
    };
  });

  server.get<{ Params: { id: string } }>("/transfer/:id", async (request, reply) => {
    const { id } = request.params;
    const entry = transfers.get(id);

    if (!entry) {
      throw new GigaiError(ErrorCode.TRANSFER_NOT_FOUND, "Transfer not found");
    }

    if (entry.expiresAt < Date.now()) {
      transfers.delete(id);
      throw new GigaiError(ErrorCode.TRANSFER_EXPIRED, "Transfer expired");
    }

    const content = await readFile(entry.path);
    reply.type(entry.mimeType).send(content);
  });
}
