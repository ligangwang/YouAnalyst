#!/usr/bin/env bash
set -euo pipefail

# Hosted runners can stall on the Azure Ubuntu mirror before tests even start.
sudo sed -i 's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
printf 'Acquire::http::Timeout "15";\nAcquire::https::Timeout "15";\nAcquire::Retries "2";\n' | sudo tee /etc/apt/apt.conf.d/99-playwright-download-timeouts >/dev/null
if ! timeout --kill-after=15s 180s npx playwright install --with-deps --only-shell chromium; then
  # GitHub images already include browser libraries. Validate them by launching
  # the exact Playwright binary; missing libraries still fail the release gate.
  npx playwright install --only-shell chromium
  node --input-type=module -e "import { chromium } from '@playwright/test'; const browser = await chromium.launch(); await browser.close();"
fi
