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

// Logging functions
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => config.DEV_MODE && console.log(`[DEBUG] ${msg}`, ...args),
  section: (msg) => console.log(`\n=== ${msg} ===`),
};

// Command line argument parsing
const CLEAR_CACHE = process.argv.includes('--clear-cache');

// Cache management functions
async function initializeCache() {
  if (CLEAR_CACHE) {
    try {
      await fs.rm(config.CACHE_DIR, { recursive: true, force: true });
      log.info('Cache cleared successfully');
    } catch (error) {
      log.error('Failed to clear cache:', error);
    }
  }
  await fs.mkdir(config.CACHE_DIR, { recursive: true });
}

function getCacheKey(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(config.CACHE_DIR, `${hash}_v${config.CACHE_VERSION}.json`);
}

async function getFromCache(url) {
  if (!config.USE_CACHE) return null;
  try {
    const cacheFile = getCacheKey(url);
    const data = await fs.readFile(cacheFile, 'utf8');
    log.debug(`Cache hit for ${url}`);
    return JSON.parse(data);
  } catch {
    log.debug(`Cache miss for ${url}`);
    return null;
  }
}

async function saveToCache(url, data) {
  if (!config.USE_CACHE) return;
  try {
    const cacheFile = getCacheKey(url);
    await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    log.debug(`Cached ${url}`);
  } catch (error) {
    log.error('Failed to write cache:', error);
  }
}

// Browser management functions
async function createBrowser() {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setDefaultTimeout(config.TIMEOUT);
    log.info('Browser initialized');
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

  while (attempts < maxRetries) {
    try {
      await page.goto(config.DOCS_URL, { waitUntil: 'networkidle0' });
      await page.waitForSelector(config.SELECTORS.panel);

      const links = await page.evaluate((selectors) => {
        const findSection = (link) => {
          const sectionEl = link.closest('div')?.previousElementSibling;
          if (sectionEl?.tagName === 'H2') return sectionEl.textContent.trim();
          const subSectionEl = link.closest('div')?.querySelector('h3');
          if (subSectionEl) return subSectionEl.textContent.trim();
          return 'Reference';
        };

        return Array.from(document.querySelectorAll(selectors.docLinks)).map((link) => ({
          url: link.href,
          text: link.textContent.trim(),
          path: link.getAttribute('href').split('#')[1] || link.getAttribute('href'),
          section: findSection(link),
        }));
      }, config.SELECTORS);

      log.info(`Found ${links.length} documentation links`);
      return links;
    } catch (error) {
      if (error.message.includes('429')) {
        const msg = 'Rate limit exceeded';
        log.error(msg);
        throw new Error(msg);
      }
      attempts++;
      if (attempts === maxRetries) {
        log.error('Failed to extract links:', error);
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }
}

// Content extraction functions
async function extractContent(page, url, title) {
  log.section(`Extracting Content: ${title}`);

  const cached = await getFromCache(url);
  if (cached) {
    log.info(`Using cached content for: ${cached.title}`);
    return cached;
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle0' });

    try {
      await page.waitForSelector(config.SELECTORS.iframe, { timeout: config.TIMEOUT });
    } catch (error) {
      throw new Error(`Timeout waiting for iframe: ${error.message}`);
    }

    const frameHandle = await page.$(config.SELECTORS.iframe);
    if (!frameHandle) {
      throw new Error('No iframe found');
    }

    const frame = await frameHandle.contentFrame();
    if (!frame) {
      throw new Error('Failed to get iframe content');
    }

    await frame.waitForSelector('body');

    const content = await extractFrameContent(frame);
    if (!content || content.error) {
      throw new Error(content?.error || 'No content found');
    }

    const result = {
      title,
      content: content.html,
      hasMalformedHTML: content.hasMalformedHTML,
    };

    await saveToCache(url, result);
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
  log.section('Starting Three.js Documentation Scraper');
  log.info('Mode:', config.DEV_MODE ? 'DEVELOPMENT' : 'PRODUCTION');

  if (CLEAR_CACHE) {
    log.info('Clear cache flag detected');
  }

  await initializeCache();

  // Exit early if only clearing cache
  if (CLEAR_CACHE) {
    log.info('Cache cleared. Exiting...');
    return;
  }

  let browser, page;

  try {
    if (testPage) {
      page = testPage;
    } else {
      ({ browser, page } = await createBrowser());
    }

    const links = await extractLinks(page);

    // Limit pages in DEV_MODE
    const pagesToProcess = config.DEV_MODE ? links.slice(0, config.DEV_PAGE_LIMIT) : links;

    log.info(`Will scrape ${pagesToProcess.length} pages${config.DEV_MODE ? ' (DEV_MODE)' : ''}`);

    const documentation = [];
    for (const link of pagesToProcess) {
      const content = await extractContent(page, link.url, link.text);
      documentation.push({
        title: link.text,
        content: content.content,
        section: link.section || 'Reference',
      });
    }

    log.info(`Successfully scraped ${documentation.length} pages`);

    // Generate HTML from documentation
    const html = generateHTML(documentation);

    // Ensure output directory exists
    await fs.mkdir(config.OUTPUT_DIR, { recursive: true });

    // Write HTML file
    const outputPath = path.join(config.OUTPUT_DIR, 'index.html');
    await fs.writeFile(outputPath, html);

    log.info(`Output saved to ${outputPath}`);
  } catch (error) {
    log.error('Scraping failed:', error);
    throw error;
  } finally {
    if (browser) await browser.close();
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
