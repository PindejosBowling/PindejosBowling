// src/api.js — fetch wrappers for the Google Apps Script endpoint
// Extracted from app.js; shared by Pinia stores and (later) Vue components.

export const API = "https://script.google.com/macros/s/AKfycbz8sg1ZRlVaD0tXpN6GRlC1awZYu1_KhD7z5Bc88KjsTNntq1dBzAf8aHGbW0th_Tjhiw/exec";

export async function apiGet(action) {
  const r = await fetch(`${API}?action=${action}`);
  return r.json();
}

export async function apiPost(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(API, { method: 'POST', body });
      return r.json();
    } catch (e) {
      lastErr = e;
      // Brief backoff before retry (Apps Script sometimes has transient hiccups)
      if (attempt === 0) await new Promise(res => setTimeout(res, 1200));
    }
  }
  throw lastErr || new Error('Network error');
}
