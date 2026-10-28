import next from "@bitocard/eslint-config/next";

const config = [
  ...next,
  // This package has no pages directory; disable the rule that looks for one.
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
];

export default config;
