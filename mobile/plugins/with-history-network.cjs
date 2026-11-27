// The cleartext HTTP hop runs inside Tailscale's encrypted device tunnel.
const { withAndroidManifest, withDangerousMod, withInfoPlist } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
const historyUrl = process.env.EXPO_PUBLIC_HISTORY_URL;
const server = historyUrl ? new URL(historyUrl).hostname : null;
module.exports = function withHistoryNetwork(config) {
  if (!server || new URL(historyUrl).protocol !== 'http:') return config;
  if (!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(server)) {
    throw new Error('Cleartext history access is supported only over a Tailscale IPv4 address.');
  }
  config = withInfoPlist(config, value => {
    const ats = value.modResults.NSAppTransportSecurity ??= {};
    const exceptions = ats.NSExceptionDomains ??= {};
    exceptions[server] = { NSExceptionAllowsInsecureHTTPLoads: true };
    return value;
  });
  config = withAndroidManifest(config, value => {
    value.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/setwise_history_network';
    return value;
  });
  return withDangerousMod(config, ['android', async value => {
    const dir = path.join(value.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'setwise_history_network.xml'),
      '<network-security-config><domain-config cleartextTrafficPermitted="true"><domain>' + server + '</domain></domain-config></network-security-config>');
    return value;
  }]);
};
