const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// react-native-maps bestaat niet voor het web.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/lib/maps-web-stub.tsx') }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
