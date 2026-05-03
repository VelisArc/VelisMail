import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # Navigate to home and setup localStorage based on what we see in the code
        await page.goto("http://localhost:5173/")
        await page.evaluate("localStorage.setItem('auth-storage', JSON.stringify({\"state\":{\"user\":{\"id\":\"1\",\"email\":\"admin@velismail.com\",\"name\":\"Admin\",\"role\":\"admin\",\"created_at\":\"2024-01-01\"},\"token\":\"dummy\"},\"version\":0}))")

        # Now go to dashboard
        await page.goto("http://localhost:5173/dashboard")
        await asyncio.sleep(2)
        await page.screenshot(path="dashboard_auth_real.png")

        await browser.close()

asyncio.run(main())
