import { expect, test } from "@playwright/test";

async function seedLogin(request:any,context:any,loginName:string){
  const api=process.env.PLAYWRIGHT_API_URL??"http://localhost:4000";
  const response=await request.post(`${api}/api/auth/login`,{data:{login:loginName,password:"demo12345"}});
  expect(response.ok()).toBeTruthy();const{accessToken,refreshToken}=await response.json();
  await context.addInitScript(({access,refresh}:{access:string;refresh:string})=>{localStorage.setItem("pulse_token",access);localStorage.setItem("pulse_refresh_token",refresh)},{access:accessToken,refresh:refreshToken});
}

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

test("creates a group and a direct chat through the real UI",async({page,request,context})=>{
  await seedLogin(request,context,"leo");await page.goto("/");
  await page.getByLabel("Создать группу").click();
  let dialog=page.getByRole("dialog",{name:"Новый чат"});
  await dialog.getByRole("tab",{name:"Группа"}).click();
  const groupName=`UI Group ${Date.now()}`;
  await dialog.getByLabel("Название группы").fill(groupName);
  await dialog.getByLabel("Найти пользователя").fill("anna@example.com");
  await dialog.getByRole("button",{name:/@anna/}).click();
  await dialog.getByRole("button",{name:"Создать группу"}).click();
  await expect(page.getByRole("heading",{name:groupName})).toBeVisible();

  await page.getByLabel("Создать группу").click();
  dialog=page.getByRole("dialog",{name:"Новый чат"});
  await dialog.getByLabel("Найти пользователя").fill("max");
  await dialog.getByRole("button",{name:/@max/}).click();
  await dialog.getByRole("button",{name:"Начать общение"}).click();
  await expect(page.getByRole("dialog",{name:"Новый чат"})).toBeHidden();
});

test("uploads an image through MinIO and opens the viewer",async({page,request,context})=>{
  await seedLogin(request,context,"anna");await page.goto("/");
  await page.getByRole("button",{name:/Дизайн-команда/}).first().click();
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  await page.locator('input[type="file"]:not([accept])').setInputFiles({name:"smoke-upload.png",mimeType:"image/png",buffer:png});
  await expect(page.getByText("smoke-upload.png")).toBeVisible();
  await page.getByRole("button",{name:"Отправить"}).click();
  const image=page.locator('img[alt="smoke-upload.png"]');await expect(image).toBeVisible();await image.click();
  await expect(page.getByRole("dialog",{name:/smoke-upload.png/})).toBeVisible();await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:/smoke-upload.png/})).toBeHidden();
});

test("renders the in-app push permission banner without prompting on load",async({page,request,context})=>{
  await seedLogin(request,context,"max");await page.goto("/");
  await expect(page.getByLabel("Настройки уведомлений")).toBeVisible();
  await expect(page.getByText("Включить уведомления?")).toBeVisible({timeout:10_000});
});
