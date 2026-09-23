// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

async function copyLegacySettings(appData, directory) {
  const legacy = path.join(appData, 'OwlSight-Prototype');
  for (const name of ['viewer-settings.json', 'color-settings.json']) {
    try {
      // Copy only known preferences. Existing new-profile settings always win.
      await fs.mkdir(directory, { recursive: true });
      await fs.copyFile(path.join(legacy, name), path.join(directory, name), constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EEXIST') {
        console.warn(`无法接续旧版设置 ${name}：${error.message}`);
      }
    }
  }
}
module.exports = { copyLegacySettings };
