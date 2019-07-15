const imagemin = require('imagemin');
const imageminJpegtran = require('imagemin-jpegtran');
const imageminPngquant = require('imagemin-pngquant');
const imageminMozjpeg = require('imagemin-mozjpeg');
const path = require('path');
const fs = require('fs');
const utils = require('../../../lib/utils');

exports = module.exports = async function (dir) {
    const imagesDir = path.join(dir, 'images');

    if (fs.existsSync(imagesDir) && fs.readdirSync(imagesDir).length) {
        const imageMinList = utils.getAllFilesByDir(imagesDir, ['.jpg', '.png', '.jpeg']).map(item => {
            return imagemin([item], {
                destination: path.dirname(utils.normalizePath(item).replace(global.srcPrefix, global.deployPrefix)),
                plugins: [
                    imageminMozjpeg(),
                    imageminJpegtran(),
                    imageminPngquant({
                        quality: [0.7, 0.8]
                    })
                ]
            });
        });

        try {
            await Promise.all(imageMinList);
        } catch (error) {
            console.log('images min err:', error);
        }
    } else {
        console.log('can not found images');
    }
};