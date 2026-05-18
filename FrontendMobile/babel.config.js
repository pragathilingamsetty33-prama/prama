module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@shared-web': '../FrontendWeb/src',
          },
        },
      ],
      // Required for react-native-reanimated
      'react-native-reanimated/plugin',
    ],
  };
};
