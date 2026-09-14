// Metro in a pnpm workspace: watch the repo root so the brand fonts in packages/compose resolve,
// and look in this package's node_modules first, then the root's.
//
// Hierarchical lookup stays ON, unlike the usual monorepo snippet. That advice is written for
// hoisted layouts, where every package sits in one flat node_modules and walking the tree is
// waste. pnpm's layout is the opposite: each package keeps its own dependencies beside it, so
// disabling the walk makes a package's private deps unresolvable (whatwg-fetch, reached only
// from inside @expo/metro-runtime, is the one that catches it).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(workspaceRoot, "node_modules")];

module.exports = config;
