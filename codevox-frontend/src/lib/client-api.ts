"use client";

import { getSession } from "next-auth/react";
import { recruitmentApiBase } from "@/lib/recruitment-api-base";

const API_BASE = () => recruitmentApiBase();

async function resolveClientApiToken(): Promise<string> {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sign in required");
  return token;
}

async function handleClientApiError(res: Response, path: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw new Error(`API ${res.status} ${path}: ${text}`);
}

export async function authedFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const token = await resolveClientApiToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const url = `${API_BASE()}${path}`;
  try {
    return await fetch(url, { ...init, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      throw new Error(
        `Cannot reach API at ${API_BASE()} (${path}). Is the Nest backend running on that URL, and is CORS_ORIGIN allowing this frontend?`,
      );
    }
    throw err instanceof Error ? err : new Error(msg);
  }
}

export async function clientApiGet<T>(path: string): Promise<T> {
  const res = await authedFetch(path, {});
  if (!res.ok) await handleClientApiError(res, path);
  return (await res.json()) as T;
}

export async function clientApiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleClientApiError(res, path);
  return (await res.json()) as T;
}

export async function clientApiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleClientApiError(res, path);
  return (await res.json()) as T;
}

export async function clientApiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleClientApiError(res, path);
  return (await res.json()) as T;
}

export async function clientApiDelete(path: string): Promise<void> {
  const res = await authedFetch(path, { method: "DELETE" });
  if (!res.ok) await handleClientApiError(res, path);
}
