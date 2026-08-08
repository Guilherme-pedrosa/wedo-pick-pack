import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        await page.goto("http://localhost:8080/analise-estoque", wait_until="networkidle")
        
        # Wait for the table to load
        await page.wait_for_selector("table tbody tr")
        
        # Try to find the search input by class or type since placeholder failed
        inputs = await page.query_selector_all("input")
        for inp in inputs:
            p = await inp.get_attribute("placeholder")
            if p and "Filtrar" in p:
                await inp.fill("50.01.050S")
                break
        
        await page.wait_for_timeout(3000)
        
        # Capture the row data
        rows = await page.query_selector_all("table tbody tr")
        if not rows:
             print("No rows found for 50.01.050S")
        for row in rows:
            text = await row.inner_text()
            print("Row content:", text.replace('\t', ' | ').replace('\n', ' | '))
            
        await browser.close()

asyncio.run(main())
