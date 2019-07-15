const path = require('path');
const fs = require('fs');
const sass = require('node-sass');

const file = require('../../../lib/customized/file');
const utils = require('../../../lib/customized/utils');
const postcss = require('./postcss');

/**
 * 编译scss文件
 * @param dir
 * @param config
 * @returns {Promise<any>}
 */
exports = module.exports = function (dir, uedDir, config = null) {
    const divideBy2 = config.stylesOption && config.stylesOption.divideBy2;
    const rem = config.stylesOption && config.stylesOption.rem;

    const sassCompilationPromises = [];
    const sassList = global.sassCompileList.filter(item => item.indexOf(`/${uedDir}/`) !== -1);

    for (let i = 0; i < sassList.length; i++) {
        const _sourceFile = sassList[i];

        sassCompilationPromises.push(new Promise(async (resolve, reject) => {
            sass.render({
                file: path.join(_sourceFile, ''),
                includePaths: [path.join(__dirname, 'common-scss'), path.join(dir, uedDir, 'css/sprite')],
                outputStyle: 'compressed'
            }, async (err, result) => {
                if (err) {
                    console.log(err);
                    console.log(`${err.file} error:  ${err.message}`);

                    reject(err);
                } else {
                    const _outputPath = utils.normalizePath(_sourceFile).replace(global.srcPrefix, global.deployPrefix).replace(/\.scss$/, '.css');
                    file.mkdirRecursive(path.dirname(_outputPath));

                    fs.writeFileSync(_outputPath, result.css.toString());

                    await postcss(_outputPath, {
                        divideBy2, rem
                    });

                    resolve(result);
                }
            });
        }));
    }

    return new Promise(async (resolve, reject) => {
        try {
            const values = await Promise.all(sassCompilationPromises);
            resolve(values);
        } catch (err) {
            reject(err);
        }
    });
};