import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # Navigate to home and setup localStorage based on what we see in the code
        await page.goto("http://localhost:5173/")
        await page.evaluate("localStorage.setItem('velismail_token', 'dummy'); localStorage.setItem('velismail_session', JSON.stringify({\"id\":\"1\",\"email\":\"admin@velismail.com\",\"name\":\"Admin\",\"role\":\"admin\"}))")

        # Now go to dashboard
        await page.goto("http://localhost:5173/dashboard")
        await asyncio.sleep(2)
        await page.screenshot(path="dashboard_auth_final.png")

        await browser.close()

asyncio.run(main())
