#!/usr/bin/env node
import { main } from '../packages/cursor-bridge-host/lib/installer.mjs';

main().catch((err) => {
  console.error(`\nInstall failed: ${err.message}`);
  process.exit(1);
});
