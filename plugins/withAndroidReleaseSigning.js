const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Uses CI-only environment variables to sign a release APK.
 * No keystore or password is ever committed to the repository.
 */
module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') return result;
    const marker = '// babyrecord-release-signing';
    if (result.modResults.contents.includes(marker)) return result;
    result.modResults.contents += `

${marker}
def babyrecordKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
if (babyrecordKeystorePath) {
    android {
        signingConfigs {
            babyrecordRelease {
                storeFile file(babyrecordKeystorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.babyrecordRelease
            }
        }
    }
}
`;
    return result;
  });
};
