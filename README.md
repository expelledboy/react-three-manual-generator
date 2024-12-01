# Three.js Manual Generator

A tool to scrape and generate a single-page, offline-friendly version of the Three.js documentation manual.

View it at: `https://expelledboy.github.io/threejs-manual-generator`

## Features

- Scrapes the entire Three.js documentation
- Preserves original styling and formatting
- Maintains code syntax highlighting
- Supports offline viewing
- Rate-limited requests to avoid server strain
- Caching system for faster development
- Development mode for quick testing

## Prerequisites

This project uses [Nix](https://nixos.org/) for development environment management. You'll need:

- Nix with flakes enabled
- `direnv` (optional, but recommended)

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/threejs-manual-generator.git
   cd threejs-manual-generator
   ```

2. Enable direnv (optional):

   ```bash
   direnv allow # sources .envrc
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Development Mode

Run with a limit of 10 pages for testing:

```bash
npm run dev
```

### Production Mode

Generate the complete documentation:

```bash
npm run prod
```

### Publishing

To build and publish to the docs branch:

```bash
just publish
```

This will:

1. Build the documentation
2. Update the LAST_UPDATED timestamp
3. Commit changes to the docs branch
4. Reset the working directory

### Other Commands

- `npm run lint` - Check code style
- `npm run lint:fix` - Fix code style issues
- `npm run format` - Format code
- `npm run test` - Run tests
- `npm run clear-cache` - Clear the cache

## Development

The project uses:

- Node.js 18
- Puppeteer for web scraping
- Jest for testing
- ESLint and Prettier for code style
- Just for task running

### Cache System

The scraper caches downloaded pages to speed up development. To clear the cache:

```bash
npm run clear-cache
```

## License

MIT
