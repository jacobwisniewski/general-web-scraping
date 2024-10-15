import {chromium} from 'playwright';
import fs from 'fs';
import csvWriter from 'csv-write-stream';
import {Page} from "@playwright/test";
import ProgressBar from 'progress';

interface Store {
  name: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  latitude: string;
  longitude: string;
}

const baseUrl = 'https://store.aldi.com.au/';

const scrapeAldiStorePage = async (page: Page): Promise<Store | null> => {
  try {
    return await page.evaluate(() => {
      const name = (document.querySelector('.Heading.Hero-heading#location-name') as HTMLElement)?.innerText.trim() || '';
      const street = (document.querySelector('.Address-line .Address-field.Address-line1') as HTMLElement)?.innerText.trim() || '';
      const suburb = (document.querySelector('.Address-line .Address-field.Address-city') as HTMLElement)?.innerText.trim() || '';
      const state = (document.querySelector('.Address-line .Address-field.Address-region') as HTMLElement)?.innerText.trim() || '';
      const postcode = (document.querySelector('.Address-line .Address-field.Address-postalCode') as HTMLElement)?.innerText.trim() || '';
      const latitude = (document.querySelector('meta[itemprop="latitude"]') as HTMLMetaElement)?.content || '';
      const longitude = (document.querySelector('meta[itemprop="longitude"]') as HTMLMetaElement)?.content || '';
      return {name, street, suburb, state, postcode, latitude, longitude};
    });
  } catch (error) {
    console.error('Error scraping store page', error);
    return null;
  }
};

(async () => {
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl);

    // Step 1: Get state URLs
    const stateUrls = await page.$$eval('.Directory-listLink', links =>
      links.map(link => ({
        url: (link as HTMLAnchorElement).href
      }))
    );

    const suburbOrStoreUrls: string[] = [];

    console.log(`Found ${stateUrls.length} states`);

    // Step 2: Loop through each state page to get suburb or store URLs
    for (const state of stateUrls) {
      console.log(`Scraping state page: ${state.url}`);
      await page.goto(state.url);

      const urls = await page.$$eval('.Directory-listLink', links =>
        links.map(link => (link as HTMLAnchorElement).href)
      );

      suburbOrStoreUrls.push(...urls);
    }

    console.log(`Found ${suburbOrStoreUrls.length} suburb or store URLs`);

    const stores: Store[] = [];
    const bar = new ProgressBar('Scraping [:bar] :percent :etas', { total: suburbOrStoreUrls.length });

    // Step 3: Loop through each suburb or store URL to scrape store data
    for (const suburbOrStoreUrl of suburbOrStoreUrls) {
      await page.goto(suburbOrStoreUrl);

      const isSingleStorePage = await page.$('h1.Heading.Hero-heading#location-name') !== null;

      if (isSingleStorePage) {
        const storeData = await scrapeAldiStorePage(page);
        storeData && stores.push(storeData);
      } else {
        const storeUrls = await page.$$eval('.Teaser-titleLink', links =>
          links.map(link => (link as HTMLAnchorElement).href)
        );

        for (const storeUrl of storeUrls) {
          await page.goto(storeUrl);
          const storeData = await scrapeAldiStorePage(page);
          storeData && stores.push(storeData);
        }
      }

      bar.tick();
    }

    console.log(`Total stores scraped: ${stores.length}`);
    console.log(stores);

    // Step 4: Write data to CSV
    const writer = csvWriter();
    const writeStream = fs.createWriteStream('aldi_locations.csv');
    writer.pipe(writeStream);
    stores.forEach(store => writer.write(store));
    writer.end();

    writeStream.on('finish', () => {
      console.log('Finished writing to CSV');
    });

    await browser.close();
  } catch (error) {
    console.error('Error during scraping', error);
  }
})();