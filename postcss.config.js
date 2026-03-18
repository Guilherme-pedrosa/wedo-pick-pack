import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const resolveFromProject = (pkg) => {
  const resolvedPath = require.resolve(pkg, { paths: [process.cwd()] });
  return require(resolvedPath);
};

const tailwindcss = resolveFromProject("tailwindcss");
const autoprefixer = resolveFromProject("autoprefixer");

export default {
  plugins: [tailwindcss, autoprefixer],
};
