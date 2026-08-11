import { expect, test } from "@playwright/test";

test("registers a new account through the real UI form", async ({ page }) => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto("/");
  await expect(
    page.getByText("Войдите, чтобы продолжить общение"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Регистрация" }).click();
  await page.getByLabel("Email").fill(`ui-${unique}@example.com`);
  await page.getByLabel("Username").fill(`ui_${unique}`);
  await page.getByLabel("Как вас зовут").fill("UI Smoke");
  await page.getByLabel("Пароль").fill("Secure12345");
  await page.getByRole("button", { name: /Создать аккаунт/ }).click();
  await expect(page.getByText("Пока нет чатов")).toBeVisible();
  const tokens = await page.evaluate(() => ({
    access: localStorage.getItem("pulse_token"),
    refresh: localStorage.getItem("pulse_refresh_token"),
  }));
  expect(tokens.access).toBeTruthy();
  expect(tokens.refresh).toBeTruthy();
});

test("silently refreshes an invalid access token using the rotated refresh token", async ({
  page,
  request,
  context,
}) => {
  const api = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:4000";
  const login = await request.post(`${api}/api/auth/login`, {
    data: { login: "max", password: "demo12345" },
  });
  expect(login.ok()).toBeTruthy();
  const { refreshToken } = await login.json();
  await context.addInitScript((token) => {
    localStorage.setItem("pulse_token", "invalid.access.token");
    localStorage.setItem("pulse_refresh_token", token);
  }, refreshToken);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Дизайн-команда/ }).first(),
  ).toBeVisible();
  const access = await page.evaluate(() => localStorage.getItem("pulse_token"));
  expect(access).not.toBe("invalid.access.token");
});

test("login token opens a chat and sends a text message", async ({
  page,
  request,
  context,
}) => {
  const api = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:4000";
  const login = await request.post(`${api}/api/auth/login`, {
    data: { login: "anna", password: "demo12345" },
  });
  expect(
    login.ok(),
    "Backend must be running and seeded with the development demo users",
  ).toBeTruthy();
  const { accessToken } = await login.json();
  await context.addInitScript(
    (token) => localStorage.setItem("pulse_token", token),
    accessToken,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: /Дизайн-команда/ })
    .first()
    .click();
  const message = `Smoke ${Date.now()}`;
  await page.getByLabel("Текст сообщения").fill(message);
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
