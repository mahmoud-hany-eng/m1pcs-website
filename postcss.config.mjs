/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    // CSS-only targets (Next's JS targets are unaffected). Safari/iOS below
    // 18 only understand the -webkit- prefixed backdrop-filter the glass
    // material depends on; autoprefixer's `defaults` query no longer
    // includes them and would strip those prefixes.
    autoprefixer: {
      overrideBrowserslist: ["defaults", "safari >= 15", "ios_saf >= 15"],
    },
  },
};

export default config;
