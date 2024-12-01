/**
 * Three.js Documentation Scraper
 * =============================
 *
 * @purpose
 * Scrapes the Three.js documentation to create a single, offline-friendly HTML file.
 * Preserves original styling, structure, and code formatting while maintaining
 * proper navigation and search functionality.
 *
 * @keyFacts
 * - Three.js docs use iframes for content loading
 * - Documentation is split across 300+ pages
 * - DEV_MODE processes only 10 pages for testing
 * - Each page has its own HTML structure and navigation
 * - Code blocks use Google's prettify for syntax highlighting
 * - Styling is controlled by page.css and main.css
 * - Dark/light mode support is built into the CSS
 * - Content is dynamically loaded based on URL hash
 * - Table of contents is hierarchically structured
 * - Links use [page:Class property] syntax
 * - Code examples are embedded in iframes
 * - Font stack: Inter for text, Roboto Mono for code
 * - Responsive design breakpoints at 640px and 1700px
 *
 * @developmentJourney
 * 1. Initial Approach
 *    Attempt: Basic HTML scraping with direct URL access
 *    Failed: Missed iframe content and dynamic loading
 *    Solution: Implemented iframe content extraction
 *
 * 2. Link Discovery
 *    Attempt: Fixed list of documentation links
 *    Failed: Missed many pages and new additions
 *    Solution: Dynamic link extraction from navigation
 *
 * 3. Content Formatting
 *    Attempt: Custom CSS styling
 *    Failed: Inconsistent with Three.js look and feel
 *    Solution: Using Three.js's page.css directly
 *
 * 4. Code Blocks
 *    Attempt: Basic <pre><code> tags
 *    Failed: Lost syntax highlighting and formatting
 *    Solution: Integrated Google Prettify with Three.js's theme
 *
 * 5. Navigation
 *    Attempt: Simple list of links
 *    Failed: Lost hierarchical structure
 *    Solution: Preserved Three.js's panel layout and section organization
 *
 * 6. Error Handling
 *    Attempt: Basic try/catch blocks
 *    Failed: Silent failures and timeouts
 *    Solution: Comprehensive logging and timeout handling
 *
 * 7. Testing
 *    Attempt: Basic URL tests
 *    Failed: Didn't catch content issues
 *    Solution: Mock-based testing with content validation
 *
 * 8. Link Processing
 *    Attempt: Simple text replacement
 *    Failed: Broke code examples and inline formatting
 *    Solution: Context-aware link parsing with regex
 *
 * 9. Cache Management
 *    Attempt: Simple file caching
 *    Failed: Stale content and memory issues
 *    Solution: Versioned cache with clear command
 *
 * 10. HTML Structure
 *     Attempt: Single page layout
 *     Failed: Lost Three.js's navigation UX
 *     Solution: Preserved panel-based layout
 *
 * 11. Development Mode
 *     Attempt: Full processing during development
 *     Failed: Too slow for iterative development
 *     Solution: Added 10-page limit in DEV_MODE
 *
 * Current Challenges:
 * - Some code blocks lose formatting in complex cases
 * - Special link syntax ([page:Class property]) needs better parsing
 *
 * Key Insights:
 * - Three.js's documentation is highly interactive
 * - Original styling is crucial for readability
 * - Navigation structure affects usability
 * - Caching is essential for development
 * - Testing needs to cover content quality
 * - Error handling must be comprehensive
 * - Performance vs completeness tradeoffs
 * - Documentation structure is hierarchical
 * - Link syntax is documentation-specific
 * - Mobile support requires special handling
 */

const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { setTimeout } = global;
const { Buffer } = require('node:buffer');

// Configuration object
const config = {
  DEV_MODE: process.env.DEV_MODE === 'true',
  DEV_PAGE_LIMIT: 10,
  BASE_URL: 'https://threejs.org',
  DOCS_URL: 'https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene',
  TIMEOUT: 30000,
  OUTPUT_DIR: 'docs',
  CACHE_DIR: '.cache',
  USE_CACHE: process.env.NO_CACHE !== 'true',
  CACHE_VERSION: '1',
  SELECTORS: {
    panel: '#panel',
    docLinks: '#panel a[href*="/en/"]',
    iframe: 'iframe',
    content: {
      manual: '.manual-content',
      fallback: 'body > *:not(script):not(link):not(style):not(#button)',
    },
  },
};

// Enhance logging functions
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
  section: (msg) => console.log(`\n=== ${msg} ===`),
  perf: (msg, startTime) => console.log(`[PERF] ${msg}: ${Date.now() - startTime}ms`),
};

// Command line argument parsing
const CLEAR_CACHE = process.argv.includes('--clear-cache');

// Cache management functions
async function initializeCache() {
  log.debug('Initializing cache system');
  if (CLEAR_CACHE) {
    try {
      log.debug('Attempting to clear cache directory');
      await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
      log.info('Cache cleared successfully');
    } catch (error) {
      log.error('Failed to clear cache:', error);
    }
  }
  log.debug(`Ensuring cache directory exists: ${config.CACHE_DIR}`);
  await fs.mkdir(config.CACHE_DIR, { recursive: true });
}

function getCacheKey(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const cacheKey = path.join(config.CACHE_DIR, `${hash}_v${config.CACHE_VERSION}.json`);
  log.debug(`Generated cache key for ${url}: ${cacheKey}`);
  return cacheKey;
}

async function getFromCache(url) {
  if (!config.USE_CACHE) {
    log.debug('Cache disabled, skipping cache lookup');
    return null;
  }
  try {
    const cacheFile = getCacheKey(url);
    log.debug(`Attempting to read cache file: ${cacheFile}`);
    const data = await fs.readFile(cacheFile, 'utf8');
    log.debug(`Cache hit for ${url} (${Buffer.byteLength(data, 'utf8')} bytes)`);
    return JSON.parse(data);
  } catch (error) {
    log.debug(`Cache miss for ${url}: ${error.code}`);
    return null;
  }
}

async function saveToCache(url, data) {
  if (!config.USE_CACHE) {
    log.debug('Cache disabled, skipping cache save');
    return;
  }
  try {
    const cacheFile = getCacheKey(url);
    const jsonData = JSON.stringify(data, null, 2);
    log.debug(`Writing ${Buffer.byteLength(jsonData, 'utf8')} bytes to cache for ${url}`);
    await fs.writeFile(cacheFile, jsonData);
    log.debug(`Successfully cached ${url}`);
  } catch (error) {
    log.error(`Failed to write cache for ${url}:`, error);
  }
}

// Browser management functions
async function createBrowser() {
  log.debug('Initializing Puppeteer browser');
  try {
    const startTime = Date.now();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    log.debug('Setting page timeout:', config.TIMEOUT);
    await page.setDefaultTimeout(config.TIMEOUT);
    log.perf('Browser initialization completed', startTime);
    return { browser, page };
  } catch (error) {
    log.error('Failed to initialize browser:', error);
    throw error;
  }
}

// Link extraction functions
async function extractLinks(page) {
  const maxRetries = 2;
  let attempts = 0;
  log.debug(`Starting link extraction (max retries: ${maxRetries})`);

  while (attempts < maxRetries) {
    try {
      const startTime = Date.now();
      log.debug(`Navigating to docs URL: ${config.DOCS_URL}`);
      await page.goto(config.DOCS_URL, { waitUntil: 'networkidle0' });
      log.debug('Waiting for panel selector');
      await page.waitForSelector(config.SELECTORS.panel);
      log.perf('Page navigation completed', startTime);

      log.debug('Evaluating page for documentation links');
      const links = await page.evaluate((selectors) => {
        const findSection = (link) => {
          const sectionEl = link.closest('div')?.previousElementSibling;
          if (sectionEl?.tagName === 'H2') return sectionEl.textContent.trim();
          const subSectionEl = link.closest('div')?.querySelector('h3');
          if (subSectionEl) return subSectionEl.textContent.trim();
          return 'Reference';
        };

        const links = Array.from(document.querySelectorAll(selectors.docLinks));
        console.debug(`Found ${links.length} raw links`);

        return links.map((link) => ({
          url: link.href,
          text: link.textContent.trim(),
          path: link.getAttribute('href').split('#')[1] || link.getAttribute('href'),
          section: findSection(link),
        }));
      }, config.SELECTORS);

      log.debug(`Link extraction details:
        Total links: ${links.length}
        Unique sections: ${new Set(links.map((l) => l.section)).size}
        External links: ${links.filter((l) => !l.url.includes(config.BASE_URL)).length}
      `);

      log.perf('Link extraction completed', startTime);
      return links;
    } catch (error) {
      if (error.message.includes('429')) {
        const msg = 'Rate limit exceeded';
        log.error(msg);
        throw new Error(msg);
      }
      attempts++;
      log.debug(`Link extraction attempt ${attempts} failed: ${error.message}`);
      if (attempts === maxRetries) {
        log.error('Failed to extract links after all retries:', error);
        throw error;
      }
      log.debug(`Waiting 1000ms before retry ${attempts + 1}`);
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }
}

// Content extraction functions
async function extractContent(page, url, title) {
  const startTime = Date.now();
  log.section(`Extracting Content: ${title}`);
  log.debug(`Processing URL: ${url}`);

  const cached = await getFromCache(url);
  if (cached) {
    log.debug(
      `Using cached content for: ${cached.title} (${Buffer.byteLength(cached.content, 'utf8')} bytes)`
    );
    return cached;
  }

  try {
    log.debug(`Navigating to page: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0' });

    try {
      log.debug('Waiting for iframe to appear');
      await page.waitForSelector(config.SELECTORS.iframe, { timeout: config.TIMEOUT });
    } catch (error) {
      throw new Error(`Timeout waiting for iframe: ${error.message}`);
    }

    log.debug('Looking for iframe element');
    const frameHandle = await page.$(config.SELECTORS.iframe);
    if (!frameHandle) {
      throw new Error('No iframe found');
    }

    log.debug('Getting iframe content frame');
    const frame = await frameHandle.contentFrame();
    if (!frame) {
      throw new Error('Failed to get iframe content');
    }

    log.debug('Waiting for iframe body');
    await frame.waitForSelector('body');

    log.debug('Extracting content from frame');
    const content = await extractFrameContent(frame);
    if (!content || content.error) {
      throw new Error(content?.error || 'No content found');
    }

    const result = {
      title,
      content: content.html,
      hasMalformedHTML: content.hasMalformedHTML,
    };

    log.debug(`Content extraction stats:
      Content size: ${Buffer.byteLength(content.html, 'utf8')} bytes
      Text length: ${content.text.length} characters
      Has malformed HTML: ${content.hasMalformedHTML}
    `);

    await saveToCache(url, result);
    log.perf(`Content extraction completed for ${title}`, startTime);
    return result;
  } catch (error) {
    log.error(`Failed to extract content from ${url}:`, error);
    throw error;
  }
}

async function extractFrameContent(frame) {
  const result = await frame.evaluate((config) => {
    const findContent = () => {
      let content = document.querySelector(config.SELECTORS.content.manual);
      if (content) return content;

      const elements = document.querySelectorAll(config.SELECTORS.content.fallback);
      if (elements.length > 0) {
        content = document.createElement('div');
        elements.forEach((el) => content.appendChild(el.cloneNode(true)));
        return content;
      }
      return null;
    };

    const processCodeBlocks = (content) => {
      content.querySelectorAll('pre, code').forEach((el) => {
        if (el.tagName === 'PRE') {
          const code = el.querySelector('code') || el;
          const language = code.className?.match(/language-(\w+)/)?.[1] || 'javascript';
          code.className = `prettyprint lang-${language}`;
          code.style.whiteSpace = 'pre';
        } else if (el.tagName === 'CODE' && !el.parentElement.matches('pre')) {
          el.className = 'inline';
          el.style.whiteSpace = 'pre';
        }
      });
    };

    const fixRelativePaths = (content) => {
      content.querySelectorAll('img, a').forEach((el) => {
        if (el.src?.startsWith('/')) {
          el.src = `${config.BASE_URL}${el.src}`;
        }
        if (el.href?.startsWith('/')) {
          el.href = `${config.BASE_URL}${el.href}`;
        }
      });
    };

    const content = findContent();
    if (!content) {
      return { error: 'No content found' };
    }

    // Process content before getting HTML
    processCodeBlocks(content);
    fixRelativePaths(content);

    // Check for malformed HTML
    const malformedPatterns = ['</div></p>', '<p></div>', '<div></p>'];
    const hasMalformedHTML = malformedPatterns.some((pattern) =>
      content.innerHTML.includes(pattern)
    );

    return {
      html: content.innerHTML,
      text: content.textContent,
      hasMalformedHTML,
    };
  }, config);

  return result;
}

// Add these functions before generateHTML
function generateHeader() {
  return `
    <div id="header">
      <h1><a href="${config.BASE_URL}">three.js</a></h1>
      <div id="sections">
        <span class="selected">docs</span>
      </div>
      <div id="expandButton"></div>
    </div>
  `;
}

function generateSearch() {
  return `
    <div id="inputWrapper">
      <input type="text" id="filterInput" placeholder="Search" autocorrect="off" autocapitalize="off" spellcheck="false" />
      <div id="clearSearchButton"></div>
    </div>
  `;
}

function generateTableOfContents(documentation) {
  const sections = documentation.reduce((acc, doc) => {
    const section = doc.section || 'Reference';
    if (!acc[section]) acc[section] = [];
    acc[section].push(doc);
    return acc;
  }, {});

  return Object.entries(sections)
    .map(
      ([section, docs]) => `
      <h2>${section}</h2>
      <div class="subsection">
        <ul>
          ${docs
            .map(
              (doc) => `
            <li>
              <a href="#${encodeURIComponent(doc.title)}">${doc.title}</a>
            </li>
          `
            )
            .join('')}
        </ul>
      </div>
    `
    )
    .join('');
}

function generateContent(documentation) {
  return documentation
    .map(
      (doc) => `
      <div class="manual" id="${encodeURIComponent(doc.title)}">
        ${doc.content}
      </div>
    `
    )
    .join('');
}

function generateScript() {
  return `
    <script>
      // Panel functionality
      const panel = document.getElementById('panel');
      const expandButton = document.getElementById('expandButton');
      const panelScrim = document.getElementById('panelScrim');
      const filterInput = document.getElementById('filterInput');
      const clearSearchButton = document.getElementById('clearSearchButton');

      expandButton.onclick = function(event) {
        event.preventDefault();
        panel.classList.toggle('open');
      };

      panelScrim.onclick = function(event) {
        event.preventDefault();
        panel.classList.toggle('open');
      };

      filterInput.onfocus = function() {
        panel.classList.add('searchFocused');
      };

      filterInput.onblur = function() {
        if (filterInput.value === '') {
          panel.classList.remove('searchFocused');
        }
      };

      clearSearchButton.onclick = function() {
        filterInput.value = '';
        filterInput.focus();
      };
    </script>
  `;
}

// HTML generation functions
function generateHTML(documentation) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        ${generateHead()}
      </head>
      <body>
        ${generateBody(documentation)}
      </body>
    </html>
  `;
}

function generateHead() {
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0">
    <title>Three.js Documentation</title>
    <link rel="shortcut icon" href="${config.BASE_URL}/files/favicon_white.ico" media="(prefers-color-scheme: dark)"/>
    <link rel="shortcut icon" href="${config.BASE_URL}/files/favicon.ico" media="(prefers-color-scheme: light)" />
    <link rel="stylesheet" type="text/css" href="${config.BASE_URL}/docs/page.css">
    <script src="https://cdn.jsdelivr.net/gh/google/code-prettify@master/loader/run_prettify.js"></script>
  `;
}

function generateBody(documentation) {
  return `
    <div id="panel">
      ${generateHeader()}
      <div id="panelScrim"></div>
      <div id="contentWrapper">
        ${generateSearch()}
        <div id="content">
          ${generateTableOfContents(documentation)}
        </div>
      </div>
    </div>
    <div id="viewer">
      ${generateContent(documentation)}
    </div>
    ${generateScript()}
  `;
}

// Main scraping function
async function scrapeDocumentation(testPage) {
  const totalStartTime = Date.now();
  log.section('Starting Three.js Documentation Scraper');
  log.info('Mode:', config.DEV_MODE ? 'DEVELOPMENT' : 'PRODUCTION');
  log.debug(`Configuration:
    DEV_MODE: ${config.DEV_MODE}
    DEV_PAGE_LIMIT: ${config.DEV_PAGE_LIMIT}
    TIMEOUT: ${config.TIMEOUT}ms
    USE_CACHE: ${config.USE_CACHE}
    CACHE_VERSION: ${config.CACHE_VERSION}
  `);

  if (CLEAR_CACHE) {
    log.info('Clear cache flag detected');
  }

  await initializeCache();

  if (CLEAR_CACHE) {
    log.info('Cache cleared. Exiting...');
    return;
  }

  let browser, page;

  try {
    if (testPage) {
      log.debug('Using provided test page');
      page = testPage;
    } else {
      log.debug('Creating new browser instance');
      ({ browser, page } = await createBrowser());
    }

    const linkStartTime = Date.now();
    const links = await extractLinks(page);
    log.perf('Link extraction total time', linkStartTime);

    const pagesToProcess = config.DEV_MODE ? links.slice(0, config.DEV_PAGE_LIMIT) : links;
    log.debug(
      `Processing ${pagesToProcess.length} pages${config.DEV_MODE ? ' (limited by DEV_MODE)' : ''}`
    );

    const documentation = [];
    let processedCount = 0;
    const contentStartTime = Date.now();

    for (const link of pagesToProcess) {
      const pageStartTime = Date.now();
      const content = await extractContent(page, link.url, link.text);
      documentation.push({
        title: link.text,
        content: content.content,
        section: link.section || 'Reference',
      });
      processedCount++;
      log.debug(
        `Progress: ${processedCount}/${pagesToProcess.length} pages (${Math.round((processedCount / pagesToProcess.length) * 100)}%)`
      );
      log.perf(`Page processing time for ${link.text}`, pageStartTime);
    }

    log.perf('Content extraction total time', contentStartTime);
    log.debug(`Documentation assembly stats:
      Total pages: ${documentation.length}
      Total sections: ${new Set(documentation.map((d) => d.section)).size}
      Average content size: ${Math.round(documentation.reduce((acc, doc) => acc + Buffer.byteLength(doc.content, 'utf8'), 0) / documentation.length)} bytes
    `);

    const htmlStartTime = Date.now();
    const html = generateHTML(documentation);
    log.perf('HTML generation time', htmlStartTime);

    log.debug(`Ensuring output directory exists: ${config.OUTPUT_DIR}`);
    await fs.mkdir(config.OUTPUT_DIR, { recursive: true });

    const outputPath = path.join(config.OUTPUT_DIR, 'index.html');
    log.debug(`Writing output file: ${outputPath} (${Buffer.byteLength(html, 'utf8')} bytes)`);
    await fs.writeFile(outputPath, html);

    log.info(`Output saved to ${outputPath}`);
    log.perf('Total execution time', totalStartTime);
  } catch (error) {
    log.error('Scraping failed:', error);
    throw error;
  } finally {
    if (browser) {
      log.debug('Closing browser');
      await browser.close();
    }
  }
}

// Export functions for testing
module.exports = {
  scrapeDocumentation,
  extractLinks,
  extractContent,
  generateHTML,
  generateHeader,
  generateSearch,
  generateTableOfContents,
  generateContent,
  generateScript,
  getFromCache,
  saveToCache,
  config,
};

// Run scraper if file is executed directly
if (require.main === module) {
  scrapeDocumentation().catch(() => process.exit(1));
}
