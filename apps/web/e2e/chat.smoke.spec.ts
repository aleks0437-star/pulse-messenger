import { expect, test } from '@playwright/test';

test('login token opens a chat and sends a text message', async ({ page, request, context }) => {
  const api = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
  const login = await request.post(`${api}/api/auth/login`, { data: { login: 'anna', password: 'demo12345' } });
  expect(login.ok(), 'Backend must be running and seeded with the development demo users').toBeTruthy();
  const { accessToken } = await login.json();
  await context.addInitScript(token => localStorage.setItem('pulse_token', token), accessToken);
  await page.goto('/');
  await page.getByRole('button', { name: /Дизайн-команда/ }).first().click();
  const message = `Smoke ${Date.now()}`;
  await page.getByLabel('Текст сообщения').fill(message);
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
