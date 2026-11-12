// Expo's own Babel preset, written out so Jest also compiles the shared files outside this folder (@shared).
module.exports = function config(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
