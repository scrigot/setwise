import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const endpoint = process.env.EXPO_PUBLIC_HISTORY_URL || 'http://127.0.0.1:8795/history';
  const liveResponse = page.waitForResponse(endpoint);
  await page.goto('http://localhost:8081');
  const response = await liveResponse;
  assert.equal(response.status(), 200);
  const snapshot = await response.json();
  await page.getByText('Synced with Setwise', { exact: true }).waitFor();
  const extra = { ...snapshot.sessions[0], title: 'Refresh verification', id: 'isolated-browser-fixture', workout_date: '2026-12-01' };
  await page.route(endpoint, route => route.fulfill({ json: { ...snapshot, sessions: [...snapshot.sessions, extra] } }));
  await page.getByRole('button', { name: /^Open Refresh verification/ }).waitFor({ timeout: 25000 });
  await page.unroute(endpoint);
  await page.route(endpoint, route => route.abort());
  await page.reload();
  await page.getByText('Cannot reach Setwise.', { exact: false }).waitFor();
  await page.getByRole('button', { name: /^Open Refresh verification/ }).waitFor();
  await page.unroute(endpoint);
  await page.getByRole('button', { name: 'RETRY' }).click();
  await page.getByText('Synced with Setwise', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Open Refresh verification/ }).count(), 0);
  console.log('Live journal read, automatic update, offline restart and recovery passed.');
} finally { await browser.close(); }
