const config = {
  setupFilesAfterEnv: [
    "./test/jestCustom.js"
  ],
  verbose: false,
  testRegex: '/test/\\w+\.test\.js$',
};

export default config;
