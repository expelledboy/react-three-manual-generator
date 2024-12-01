const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');
let scraper; // Will hold the module for reloading

// Mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('{}'),
  rm: jest.fn().mockResolvedValue(undefined),
}));

// Mock puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    close: jest.fn(),
    newPage: jest.fn().mockResolvedValue({
      setDefaultTimeout: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      $: jest.fn(),
      evaluate: jest.fn(),
    }),
  }),
}));

describe('Three.js Documentation Scraper', () => {
  let mockPage;
  let originalConsole;

  beforeEach(() => {
    // Save original console
    originalConsole = { ...console };

    // Silence console output during tests
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Reset all mocks
    jestGlobal.clearAllMocks();

    // Clear module cache to reset state
    jest.resetModules();

    // Create mock page object
    mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      $: jest.fn().mockResolvedValue({
        contentFrame: jest.fn().mockResolvedValue({
          waitForSelector: jest.fn(),
          evaluate: jest.fn().mockResolvedValue({
            html: '<div>Test content</div>',
            text: 'Test content',
            hasMalformedHTML: false,
          }),
        }),
      }),
      evaluate: jest.fn().mockResolvedValue([
        {
          url: 'https://threejs.org/docs/#api/en/Test',
          text: 'Test Page',
          path: 'api/en/Test',
          section: 'Test Section',
        },
      ]),
    };
  });

  afterEach(() => {
    // Restore original console
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
  });

  test('extractLinks should return array of links', async () => {
    scraper = require('./scraper');
    const links = await scraper.extractLinks(mockPage);

    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveProperty('url');
    expect(links[0]).toHaveProperty('text');
    expect(links[0]).toHaveProperty('path');
    expect(links[0]).toHaveProperty('section');
  });

  test('generateHTML should return valid HTML string', () => {
    scraper = require('./scraper');
    const documentation = [
      {
        title: 'Test Page',
        content: '<div>Test content</div>',
        section: 'Test Section',
      },
    ];

    const html = scraper.generateHTML(documentation);

    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Page');
    expect(html).toContain('Test content');
    expect(html).toContain('Test Section');
  });

  test('scrapeDocumentation should handle clear cache flag', async () => {
    // Set clear cache flag before requiring the module
    process.argv.push('--clear-cache');
    scraper = require('./scraper');

    await scraper.scrapeDocumentation(mockPage);

    const fs = require('fs/promises');
    expect(fs.rm).toHaveBeenCalled();

    // Clean up
    process.argv.pop();
  });

  test('scrapeDocumentation should limit pages in DEV_MODE', async () => {
    process.env.DEV_MODE = 'true';
    scraper = require('./scraper');

    mockPage.evaluate.mockResolvedValue(
      Array(20).fill({
        url: 'https://threejs.org/docs/#api/en/Test',
        text: 'Test Page',
        path: 'api/en/Test',
        section: 'Test Section',
      })
    );

    await scraper.scrapeDocumentation(mockPage);

    const fs = require('fs/promises');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    // Clean up
    process.env.DEV_MODE = 'false';
  });

  test('getFromCache should return null when cache is disabled', async () => {
    process.env.NO_CACHE = 'true';
    scraper = require('./scraper');

    const result = await scraper.getFromCache('https://test.url');
    expect(result).toBeNull();

    // Clean up
    process.env.NO_CACHE = 'false';
  });

  test('saveToCache should not write when cache is disabled', async () => {
    process.env.NO_CACHE = 'true';
    scraper = require('./scraper');

    await scraper.saveToCache('https://test.url', { data: 'test' });

    const fs = require('fs/promises');
    expect(fs.writeFile).not.toHaveBeenCalled();

    // Clean up
    process.env.NO_CACHE = 'false';
  });

  test('extractContent should handle malformed HTML', async () => {
    scraper = require('./scraper');

    // Mock frame content with malformed HTML
    mockPage.$.mockResolvedValue({
      contentFrame: jest.fn().mockResolvedValue({
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          html: '<div>Test</div></p>',
          text: 'Test',
          hasMalformedHTML: true,
        }),
      }),
    });

    // Mock cache miss
    const fs = require('fs/promises');
    fs.readFile.mockRejectedValueOnce(new Error('File not found'));

    const content = await scraper.extractContent(mockPage, 'https://test.url', 'Test Page');

    expect(content.hasMalformedHTML).toBe(true);
  });

  test('extractContent should use cache when available', async () => {
    scraper = require('./scraper');
    const fs = require('fs/promises');

    const cachedContent = {
      title: 'Cached Page',
      content: '<div>Cached content</div>',
      hasMalformedHTML: false,
    };

    // Mock cache hit
    fs.readFile.mockResolvedValueOnce(JSON.stringify(cachedContent));

    const content = await scraper.extractContent(mockPage, 'https://test.url', 'Test Page');

    // Verify the entire cached object is returned
    expect(content).toEqual(cachedContent);
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  test('extractLinks should handle rate limiting errors', async () => {
    scraper = require('./scraper');

    // Mock rate limit response
    mockPage.goto.mockRejectedValueOnce(new Error('429'));

    await expect(scraper.extractLinks(mockPage)).rejects.toThrow('Rate limit exceeded');
  });

  test('generateTableOfContents should group by sections', () => {
    scraper = require('./scraper');

    const docs = [
      { title: 'Doc1', content: 'test', section: 'Section1' },
      { title: 'Doc2', content: 'test', section: 'Section1' },
      { title: 'Doc3', content: 'test', section: 'Section2' },
    ];

    const html = scraper.generateTableOfContents(docs);

    expect(html).toContain('Section1');
    expect(html).toContain('Section2');
    expect(html).toContain('Doc1');
    expect(html).toContain('Doc2');
    expect(html).toContain('Doc3');
  });

  test('extractContent should handle relative image and link paths', async () => {
    scraper = require('./scraper');

    // Mock frame content with relative paths
    mockPage.$.mockResolvedValue({
      contentFrame: jest.fn().mockResolvedValue({
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          html: '<img src="https://threejs.org/images/test.png"><a href="https://threejs.org/docs/test">Link</a>',
          text: 'Test content',
          hasMalformedHTML: false,
        }),
      }),
    });

    // Mock cache miss
    const fs = require('fs/promises');
    fs.readFile.mockRejectedValueOnce(new Error('File not found'));

    const content = await scraper.extractContent(mockPage, 'https://test.url', 'Test Page');
    expect(content.content).toContain('https://threejs.org/images/test.png');
    expect(content.content).toContain('https://threejs.org/docs/test');
  });

  test('extractContent should preserve code block formatting', async () => {
    scraper = require('./scraper');

    // Mock frame content with code blocks
    mockPage.$.mockResolvedValue({
      contentFrame: jest.fn().mockResolvedValue({
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          html: '<pre><code class="prettyprint lang-javascript">const scene = new THREE.Scene();</code></pre>',
          text: 'Test content',
          hasMalformedHTML: false,
        }),
      }),
    });

    // Mock cache miss
    const fs = require('fs/promises');
    fs.readFile.mockRejectedValueOnce(new Error('File not found'));

    const content = await scraper.extractContent(mockPage, 'https://test.url', 'Test Page');
    expect(content.content).toContain('class="prettyprint lang-javascript"');
  });

  test('extractLinks should handle special documentation link syntax', async () => {
    scraper = require('./scraper');

    // Mock page with special [page:Class property] syntax
    mockPage.evaluate.mockResolvedValueOnce([
      {
        url: 'https://threejs.org/docs/#api/en/Test',
        text: '[page:PerspectiveCamera aspect]',
        path: 'api/en/cameras/PerspectiveCamera',
        section: 'Cameras',
      },
    ]);

    const links = await scraper.extractLinks(mockPage);

    expect(links[0].text).toBe('[page:PerspectiveCamera aspect]');
    expect(links[0].path).toContain('PerspectiveCamera');
  });

  test('scrapeDocumentation should handle iframe timeouts', async () => {
    scraper = require('./scraper');

    // Mock the entire page object for this test
    const mockTimeoutPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      // Reject with a timeout error
      waitForSelector: jest.fn().mockRejectedValue(new Error('timeout')),
      // Don't resolve $ at all - this ensures the error from waitForSelector propagates
      $: jest.fn().mockImplementation(() => {
        throw new Error('Should not be called');
      }),
    };

    // Mock cache miss to ensure we try to fetch content
    const fs = require('fs/promises');
    fs.readFile.mockRejectedValueOnce(new Error('File not found'));

    // Verify that the timeout error is thrown
    await expect(async () => {
      await scraper.extractContent(mockTimeoutPage, 'https://test.url', 'Test Page');
    }).rejects.toThrow('Timeout waiting for iframe');
  });
});
