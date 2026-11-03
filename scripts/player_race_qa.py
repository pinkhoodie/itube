"""A slow archive response must not replace an already-mounted fresh-video player."""
import asyncio,os
from playwright.async_api import async_playwright
BASE=os.environ.get('ITUBE_QA_ORIGIN','http://127.0.0.1:4190').rstrip('/')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch()
  context=await browser.new_context()
  response=await context.request.post(BASE+'/login',form={'password':os.environ['ITUBE_QA_PASSWORD']},max_redirects=0)
  assert response.status==303
  delivered=asyncio.Event()
  async def slow_archive(route):
   await asyncio.sleep(3)
   await route.fulfill(status=200,content_type='application/json',body='[]')
   delivered.set()
  await context.route('**/data/videos.json',slow_archive)
  page=await context.new_page()
  await page.goto(BASE+'/#/watch/JxNCuXkSWyQ',wait_until='domcontentloaded')
  await page.locator('iframe.player').wait_for()
  assert not delivered.is_set(),'Archive must still be pending to exercise this race'
  await page.evaluate('window.originalPlayer=document.querySelector("iframe.player")')
  await delivered.wait();await page.wait_for_timeout(400)
  assert await page.evaluate('window.originalPlayer===document.querySelector("iframe.player")'),'Late source refresh remounted the active player'
  print('PASS: delayed archive response preserves the mounted fresh YouTube player')
  await browser.close()
asyncio.run(main())
