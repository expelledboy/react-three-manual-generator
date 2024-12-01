# Three.js Documentation Scraper

Scrapes the Three.js documentation into a single HTML file for Cursor AI integration. Preserves original styling, search functionality, and navigation.

## Quick Start

```bash
# Install
npm install

# Development (scrapes 10 pages)
npm run dev

# Production (scrapes all pages)
npm run prod
```

## Requirements

- Node.js >= 18.0.0

## Output

Generated file: `docs/index.html`

## Development

```bash
npm test          # Run tests
npm run lint      # Check code style
npm run format    # Format code
npm run clear-cache # Clear cached pages
```

## Structure

```
src/
  ├── scraper.js      # Main implementation
  └── scraper.test.js # Tests
```

## License

MIT
