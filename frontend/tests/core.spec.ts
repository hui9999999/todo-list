import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { recordTask } from './task-entry';

async function signup(page: Page, email: string) {
  await page.goto('/auth');
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill(email);
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('browser-test-password');
  await page.getByRole('textbox', { name: '确认密码', exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: '注册并进入工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日清单', exact: true })).toBeVisible();
}

test("注册、任务、子任务、历史、垃圾站、迁移与备份", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = "browser-" + randomUUID() + "@example.com";
  await signup(page, email);
  await recordTask(page, '准备客户汇报');
  await expect(
    page.getByRole("button", { name: "准备客户汇报", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "准备客户汇报", exact: true }).click();
  await page
    .getByRole("textbox", { name: "备注", exact: true })
    .fill("先整理客户需要的数据");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: /^清单/ })
    .click();
  const row = page.locator(".task-row").filter({ hasText: "准备客户汇报" });
  await row.getByRole("button", { name: "任务更多操作" }).click();
  await page.getByRole("menuitem", { name: "添加子任务" }).click();
  await page
    .getByRole("textbox", { name: "任务名称", exact: true })
    .fill("核对数据");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "核对数据", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "完成：准备客户汇报", exact: true })
    .click();
  await expect(
    page.getByText("请先处理所有待办或进行中的子任务，再选择父任务结果", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "完成：核对数据", exact: true })
    .click();
  await page
    .getByRole("button", { name: "完成：准备客户汇报", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "准备客户汇报", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("combobox", { name: "筛选状态" }).press("ArrowDown");
  await page.getByRole("option", { name: "全部状态", exact: true }).click();
  await page.getByRole("button", { name: "准备客户汇报", exact: true }).click();
  await expect(page.getByText("变更记录", { exact: true })).toBeVisible();
  await expect(page.locator(".history li")).toHaveCount(3);
  await page
    .getByRole("textbox", { name: "任务名称", exact: true })
    .fill("已整理的客户汇报");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  const renamed = page
    .locator(".task-row")
    .filter({ hasText: "已整理的客户汇报" });
  await renamed.getByRole("button", { name: "任务更多操作" }).click();
  await page.getByRole("menuitem", { name: "移入垃圾站（含子任务）" }).click();
  await page.getByRole("button", { name: "移入垃圾站", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已整理的客户汇报", exact: true }),
  ).not.toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: "数据管理", exact: true })
    .click();
  await page.getByRole('navigation', {name:'数据管理项目'}).getByRole('link', {name:/垃圾站/}).click();
  await expect(page.locator(".task-row")).toHaveCount(2);
  await page
    .locator(".task-row")
    .filter({ hasText: "已整理的客户汇报" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.locator(".task-row")).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("link", { name: "数据管理", exact: true })
    .click();
  await page.getByRole('navigation', {name:'数据管理项目'}).getByRole('link', {name:'备份与导入',exact:true}).click();
  await page.getByLabel("导入文件").setInputFiles({
    name: "v1.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          id: 1,
          text: "旧版失败任务",
          status: "fail",
          period: "week",
          notes: "原始备注",
        },
        { id: 2, text: "没有完成时间", status: "done" },
      ]),
    ),
  });
  await expect(
    page.getByText("2 条任务 · 0 条子任务 · 已完成 1 条 · 失败 1 条"),
  ).toBeVisible();
  await expect(
    page.getByText("第 2 条：完成日期未知，不会补造历史"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "确认导入 2 条任务", exact: true })
    .click();
  await expect(page.getByText("导入完成", { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 2.0 备份", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^todo-v2-/);
  await page
    .locator("nav")
    .getByRole("link", { name: /^清单/ })
    .click();
  await page.getByRole("combobox", { name: "筛选状态" }).press("ArrowDown");
  await page.getByRole("option", { name: "全部状态", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(4);
  await expect(page.getByText("完成日期未知", { exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "今日清单", exact: true }).hover();
  await expect(page.locator(".el-message")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.locator(testInfo.project.name === 'mobile' ? '.mobile-account' : '.account-link').click();
  await page.getByRole('navigation', { name: '账户设置分区' }).getByRole('link', { name: '账户安全' }).click();
  await page.getByRole("button", { name: "退出当前账户", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});
