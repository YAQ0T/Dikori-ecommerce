// src/lib/api.ts
import axios from "axios";

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");
const envBase =
  import.meta.env.VITE_API_BASE?.toString().trim() ||
  import.meta.env.VITE_API_URL?.toString().trim() ||
  "";

const RAW_BASE = trimTrailingSlashes(
  envBase ||
    (import.meta.env.PROD ? window.location.origin : "http://localhost:3001")
);

let parsedBase: URL;
try {
  parsedBase = new URL(RAW_BASE);
} catch {
  throw new Error(
    `Invalid API base URL "${RAW_BASE}". Set VITE_API_BASE to an absolute URL.`
  );
}

if (import.meta.env.PROD && parsedBase.protocol !== "https:") {
  throw new Error(
    `In production, VITE_API_BASE must use HTTPS. Received: ${parsedBase.href}`
  );
}

export const API_BASE = `${RAW_BASE}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
  timeout: 15000,
});

export const setApiToken = (token?: string | null) => {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
};

export const authHeaders = (token?: string) =>
  token ? { Authorization: `Bearer ${token}` } : {};

export async function handle<T>(
  p: Promise<{ data: T }>
): Promise<[T | null, string | null]> {
  try {
    const { data } = await p;
    return [data, null];
  } catch (e: any) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      "حدث خطأ";
    return [null, msg];
  }
}
