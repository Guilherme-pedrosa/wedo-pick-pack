import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # Simple navigation, we assume no auth is needed for local dev
        await page.goto("http://localhost:8080/analise-estoque")
        await page.wait_for_timeout(5000) # Wait for queries
        
        # Search
        inputs = await page.query_selector_all("input")
        for inp in inputs:
            p = await inp.get_attribute("placeholder")
            if p and "Filtrar" in p:
                await inp.fill("50.01.050S")
                await page.keyboard.press("Enter")
                break
        
        await page.wait_for_timeout(3000)
        
        os.makedirs("/tmp/browser/inventory", exist_ok=True)
        await page.screenshot(path="/tmp/browser/inventory/final_check.png")
        
        rows = await page.query_selector_all("table tbody tr")
        for row in rows:
            text = await row.inner_text()
            print("Row content:", text.replace('\t', ' | ').replace('\n', ' | '))
            
        await browser.close()

asyncio.run(main())
