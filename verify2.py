import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Create a new context and set a dummy auth state if needed, or we can just mock it in localstorage
        context = await browser.new_context()
        page = await context.new_page()

        # Go to a lightweight page on the same domain to set localStorage
        await page.goto("http://localhost:5173/")
        await page.evaluate("localStorage.setItem('auth-storage', JSON.stringify({state: {token: 'dummy', user: {id: 1, email: 'admin@yourcompany.com', role: 'admin'}}, version: 0}))")

        # Now go to dashboard
        await page.goto("http://localhost:5173/dashboard")
        await asyncio.sleep(2)
        await page.screenshot(path="dashboard_auth.png")

        await browser.close()

asyncio.run(main())
