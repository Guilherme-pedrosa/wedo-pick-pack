import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        await page.goto("http://localhost:8080/analise-estoque", wait_until="networkidle")
        
        # Search for the product code
        await page.get_by_placeholder("Filtrar por nome ou código...").fill("50.01.050S")
        await page.wait_for_timeout(2000)
        
        # Capture the row data
        rows = await page.query_selector_all("table tbody tr")
        for row in rows:
            text = await row.inner_text()
            print("Row content:", text.replace('\t', ' | ').replace('\n', ' | '))
            
        await browser.close()

asyncio.run(main())
