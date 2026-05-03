import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # We need to setup Zustand state by modifying localStorage since it's using createJSONStorage(() => sessionStorage)
        await page.goto("http://localhost:5173/")
        await page.evaluate("""
            sessionStorage.setItem('velismail-session', JSON.stringify({
                "state": {
                    "accountType": "business",
                    "navigation": {
                        "accountType": "business",
                        "activeTab": "domains",
                        "activeFolder": "inbox",
                        "selectedEmailId": null,
                        "searchQuery": "",
                        "timestamp": Date.now()
                    },
                    "lastActivity": Date.now()
                },
                "version": 0
            }));
            localStorage.setItem('velismail_token', 'dummy');
            localStorage.setItem('velismail_session', JSON.stringify({
                "id": "1",
                "email": "admin@velismail.com",
                "displayName": "Admin",
                "plan": "free",
                "accountType": "business",
                "isSetupComplete": true,
                "createdAt": "2024-01-01"
            }));
        """)

        # Now go to /business
        await page.goto("http://localhost:5173/business")
        await asyncio.sleep(2)
        await page.screenshot(path="business_page.png")

        await browser.close()

asyncio.run(main())
