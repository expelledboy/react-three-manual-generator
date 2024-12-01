[private]
default:
    @just --list

test:
	npm test

ci:
	npm run lint
	npm run format
	npm test

[private]
reset:
	npm run clear-cache

# Run the production build and publish to docs branch
publish: reset
    git diff --exit-code
    npm run prod
    echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" > LAST_UPDATED
    git add docs LAST_UPDATED
    git commit -m "docs: update documentation $(date -u +"%Y-%m-%d")"
    git push origin HEAD:docs -f
    git reset --hard origin/main
