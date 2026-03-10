import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Blob } from "node:buffer";
import type { UploadResponse } from "@gigai/shared";
import type { HttpClient } from "./http.js";
import { output, homePath } from "./output.js";

export async function upload(
  http: HttpClient,
  filePath: string,
): Promise<string> {
  const content = await readFile(filePath);
  const filename = basename(filePath);

  const formData = new FormData();
  const blob = new Blob([content]);
  formData.append("file", blob, filename);

  const res = await http.postMultipart<UploadResponse>(
    "/transfer/upload",
    formData,
  );

  output(res.id);
  return res.id;
}

export async function download(
  http: HttpClient,
  id: string,
  destPath: string,
): Promise<void> {
  const res = await http.getRaw(`/transfer/${encodeURIComponent(id)}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  output(homePath(destPath));
}
