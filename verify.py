import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Check Home page footer
        await page.goto("http://localhost:5173")
        await asyncio.sleep(2)
        # scroll to bottom
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(1)
        await page.screenshot(path="home_footer.png")

        # Check Login page logo
        await page.goto("http://localhost:5173/login")
        await asyncio.sleep(2)
        await page.screenshot(path="login_page.png")

        # Check Dashboard page
        # To check the dashboard we might need to be logged in.
        # But maybe we can just access it or capture what's available
        await page.goto("http://localhost:5173/dashboard")
        await asyncio.sleep(2)
        await page.screenshot(path="dashboard_page.png")

        await browser.close()

asyncio.run(main())
