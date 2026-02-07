// src/lib/api.ts
import axios from "axios";

const RAW_BASE = (
  import.meta.env.VITE_API_BASE?.toString() ||
  import.meta.env.VITE_API_URL?.toString() ||
  "http://localhost:3001"
).replace(/\/+$/, "");

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
