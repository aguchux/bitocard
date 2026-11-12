// The Facebook SDK needs its app ID from the moment the app starts, so it is linked only into builds that have one
// (app.config.ts adds its plugin then).
const facebook = Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_CLIENT_TOKEN);

module.exports = {
  dependencies: facebook ? {} : { 'react-native-fbsdk-next': { platforms: { android: null, ios: null } } },
};
