const config = {
  setupFilesAfterEnv: [
    "./test/lib/matchers.js",
    "./test/lib/misc.js",
  ],
  verbose: false,
  testRegex: '/test/\\w+\.test\.js$',
  testEnvironmentOptions: {
    esModules: true,
  },
};

export default config;
