/** v2.6-2 冒烟：启动 → 三页路由 → 主题切换 → 新建表单校验。全程不调 LLM。 */
import { expect, test } from '@playwright/test'

test('应用启动并渲染首页', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand')).toHaveText('AI 面试官')
  await expect(page.locator('.cockpit-hello')).toBeVisible()
})

test('三页路由切换渲染', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '新的一轮训练' })).toBeVisible()

  await page.goto('/bank')
  await expect(page.getByRole('heading', { name: '练习统计' })).toBeVisible()

  await page.goto('/resume')
  // 无简历时是「导入简历」表单；有简历时是「简历」视图——两者之一
  const h2 = page.locator('h2')
  await expect(h2.filter({ hasText: /简历/ }).first()).toBeVisible()

  // SPA 内点顶栏切回首页（回归 v2.6-2 路由冻结修复；NavLink 渲染为 <a>）
  await page.getByRole('link', { name: '面试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新的一轮训练' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('主题两态切换', async ({ page }) => {
  await page.goto('/')
  const root = page.locator('html')
  const before = await root.getAttribute('data-theme')
  await page.locator('.theme-btn').click()
  const after = await root.getAttribute('data-theme')
  expect(after).not.toBe(before)
  expect(['light', 'dark']).toContain(after)
  // 刷新保持
  await page.reload()
  await expect(root).toHaveAttribute('data-theme', after!)
})

test('新建表单校验：空方向报错 + 时长档预选 25', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '单场模拟（时长驱动）' })).toBeVisible()
  const dirInput = page.getByPlaceholder(/如：Java 后端、新媒体运营/)
  await dirInput.fill('')
  await page.getByRole('button', { name: /开始面试/ }).click()
  await expect(page.locator('.msg.error').filter({ hasText: '请先填写面试方向' })).toBeVisible()
  // 时长档预选默认 25
  await expect(page.getByRole('button', { name: '25 分钟（默认）' })).toHaveClass(/active/)
})
